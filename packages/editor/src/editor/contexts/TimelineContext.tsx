import type {
	TimelineElement,
	TimelineAsset,
} from "core/dsl/types";
import {
	DEFAULT_TIMELINE_SETTINGS,
	type TimelineSettings,
} from "core/editor/timelineLoader";
import type { TimelineCommandSnapshot } from "core/editor/command/types";
import {
	createTrackLockedMap,
	resolveMovedChildrenTracks,
	resolveTrackPlacementWithStoredAssignments,
} from "core/editor/command/move";
import { pruneAudioTrackStates } from "core/editor/command/postProcess";
import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import {
	createContext,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore, type Mutate, type StoreApi } from "zustand/vanilla";
import { useTimelineStoreApi } from "@/editor/runtime/EditorRuntimeProvider";
import { clampFrame } from "@/utils/timecode";
import { getAudioContext } from "../audio/audioEngine";
import type {
	DropTarget,
	ExtendedDropTarget,
	TimelineTrack,
} from "../timeline/types";
import { findAttachments } from "../utils/attachments";
import {
	type AudioTrackControlStateMap,
	getAudioTrackControlState,
} from "../utils/audioTrackState";
import { finalizeTimelineElements } from "../utils/mainTrackMagnet";
import type { SnapPoint } from "../utils/snap";
import { getPixelsPerFrame } from "../utils/timelineScale";
import {
	MAX_TIMELINE_SCALE,
	MIN_TIMELINE_SCALE,
} from "../utils/timelineZoom";
import { updateElementTime } from "../utils/timelineTime";
import {
	findAvailableTrack,
	getDropTarget,
	getElementRole,
	getStoredTrackAssignments,
	getTrackFromY,
	getYFromTrack,
	resolveDropTargetForRole,
} from "../utils/trackAssignment";
import { MAIN_TRACK_ID, reconcileTracks } from "../utils/trackState";
import { resolveTimelineElementRole } from "../utils/resolveRole";

// Ghost 元素状态类型
export interface DragGhostState {
	elementId: string;
	element: TimelineElement;
	// 屏幕坐标（用于 fixed 定位）
	screenX: number;
	screenY: number;
	width: number;
	height: number;
	// 克隆的元素节点（用于渲染半透明影子）
	clonedNode: HTMLElement | null;
}

// 自动滚动配置
export interface AutoScrollConfig {
	/** 边缘检测阈值（像素） */
	edgeThreshold: number;
	/** 最大滚动速度（像素/帧） */
	maxSpeed: number;
}

export const DEFAULT_AUTO_SCROLL_CONFIG: AutoScrollConfig = {
	edgeThreshold: 80,
	maxSpeed: 12,
};

const DEFAULT_FPS = 30;
const TIMELINE_PADDING_LEFT = 48;
const normalizeFps = (value: number): number => {
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_FPS;
	return Math.round(value);
};

const cloneAudioSettings = (
	audio: TimelineSettings["audio"] | undefined,
): TimelineSettings["audio"] => {
	const defaultAudio = DEFAULT_TIMELINE_SETTINGS.audio;
	const compressor = {
		...defaultAudio.compressor,
		...(audio?.compressor ?? {}),
	};
	return {
		exportSampleRate: audio?.exportSampleRate ?? defaultAudio.exportSampleRate,
		exportBlockSize: audio?.exportBlockSize ?? defaultAudio.exportBlockSize,
		masterGainDb: Number.isFinite(audio?.masterGainDb ?? NaN)
			? (audio?.masterGainDb as number)
			: defaultAudio.masterGainDb,
		compressor: {
			enabled: compressor.enabled ?? defaultAudio.compressor.enabled,
			thresholdDb: Number.isFinite(compressor.thresholdDb)
				? compressor.thresholdDb
				: defaultAudio.compressor.thresholdDb,
			ratio: Number.isFinite(compressor.ratio)
				? compressor.ratio
				: defaultAudio.compressor.ratio,
			kneeDb: Number.isFinite(compressor.kneeDb)
				? compressor.kneeDb
				: defaultAudio.compressor.kneeDb,
			attackMs: Number.isFinite(compressor.attackMs)
				? compressor.attackMs
				: defaultAudio.compressor.attackMs,
			releaseMs: Number.isFinite(compressor.releaseMs)
				? compressor.releaseMs
				: defaultAudio.compressor.releaseMs,
			makeupGainDb: Number.isFinite(compressor.makeupGainDb)
				? compressor.makeupGainDb
				: defaultAudio.compressor.makeupGainDb,
		},
	};
};

const createAssetId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `asset-${crypto.randomUUID()}`;
	}
	return `asset-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

export interface TimelineStore {
	fps: number;
	timelineScale: number;
	currentTime: number;
	previewTime: number | null; // hover 时的临时预览时间
	previewAxisEnabled: boolean; // 预览轴是否启用
	elements: TimelineElement[];
	assets: TimelineAsset[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	historyPast: TimelineHistorySnapshot[];
	historyFuture: TimelineHistorySnapshot[];
	historyLimit: number;
	canvasSize: { width: number; height: number };
	isPlaying: boolean;
	isExporting: boolean; // 导出时暂停预览更新
	exportTime: number | null; // 导出用时间帧
	seekEpoch: number; // 用户主动 seek 计数
	isDragging: boolean; // 是否正在拖拽元素
	selectedIds: string[]; // 当前选中的元素 ID 列表
	primarySelectedId: string | null; // 主选中元素 ID
	// 吸附相关状态
	snapEnabled: boolean;
	activeSnapPoint: SnapPoint | null;
	// 层叠关联相关状态
	autoAttach: boolean;
	// 主轨波纹编辑模式
	rippleEditingEnabled: boolean;
	audioSettings: TimelineSettings["audio"];
	// 拖拽目标指示状态
	activeDropTarget: ExtendedDropTarget | null;
	// 拖拽 Ghost 状态
	dragGhosts: DragGhostState[];
	// 自动滚动状态
	autoScrollSpeed: number; // -1 到 1，负数向左，正数向右，0 停止
	autoScrollSpeedY: number; // 垂直滚动速度，负数向上，正数向下
	// 时间线滚动位置
	scrollLeft: number;
	// 时间线可滚动最大值
	timelineMaxScrollLeft: number;
	// 时间线可视区域宽度（不含左侧轨道列）
	timelineViewportWidth: number;
	// 版本号（用于命令计划重基线）
	revision: number;
	setFps: (fps: number) => void;
	setCurrentTime: (time: number) => void;
	seekTo: (time: number) => void;
	setPreviewTime: (time: number | null) => void;
	setPreviewAxisEnabled: (enabled: boolean) => void;
	setElements: (
		elements:
			| TimelineElement[]
			| ((prev: TimelineElement[]) => TimelineElement[]),
		options?: { history?: boolean },
	) => void;
	setAssets: (
		assets:
			| TimelineAsset[]
			| ((prev: TimelineAsset[]) => TimelineAsset[]),
		options?: { history?: boolean },
	) => void;
	setTracks: (
		tracks: TimelineTrack[] | ((prev: TimelineTrack[]) => TimelineTrack[]),
	) => void;
	undo: () => void;
	redo: () => void;
	resetHistory: () => void;
	setTrackHidden: (trackId: string, hidden: boolean) => void;
	toggleTrackHidden: (trackId: string) => void;
	setTrackLocked: (trackId: string, locked: boolean) => void;
	toggleTrackLocked: (trackId: string) => void;
	setTrackMuted: (trackId: string, muted: boolean) => void;
	toggleTrackMuted: (trackId: string) => void;
	setTrackSolo: (trackId: string, solo: boolean) => void;
	toggleTrackSolo: (trackId: string) => void;
	setAudioTrackLocked: (trackIndex: number, locked: boolean) => void;
	toggleAudioTrackLocked: (trackIndex: number) => void;
	setAudioTrackMuted: (trackIndex: number, muted: boolean) => void;
	toggleAudioTrackMuted: (trackIndex: number) => void;
	setAudioTrackSolo: (trackIndex: number, solo: boolean) => void;
	toggleAudioTrackSolo: (trackIndex: number) => void;
	setCanvasSize: (size: { width: number; height: number }) => void;
	getCurrentTime: () => number;
	getDisplayTime: () => number; // 返回 previewTime ?? currentTime
	getRenderTime: () => number;
	getElements: () => TimelineElement[];
	getAssets: () => TimelineAsset[];
	getCanvasSize: () => { width: number; height: number };
	play: () => void;
	pause: () => void;
	togglePlay: () => void;
	setIsExporting: (isExporting: boolean) => void;
	setExportTime: (time: number | null) => void;
	setIsDragging: (isDragging: boolean) => void;
	setSelectedElementId: (id: string | null) => void;
	setSelectedIds: (ids: string[], primaryId?: string | null) => void;
	// 吸附相关方法
	setSnapEnabled: (enabled: boolean) => void;
	setActiveSnapPoint: (point: SnapPoint | null) => void;
	// 层叠关联相关方法
	setAutoAttach: (enabled: boolean) => void;
	// 主轨波纹编辑模式方法
	setRippleEditingEnabled: (enabled: boolean) => void;
	setAudioSettings: (audioSettings: TimelineSettings["audio"]) => void;
	// 拖拽目标指示方法
	setActiveDropTarget: (target: ExtendedDropTarget | null) => void;
	// 拖拽 Ghost 方法
	setDragGhosts: (ghosts: DragGhostState[]) => void;
	// 自动滚动方法
	setAutoScrollSpeed: (speed: number) => void;
	setAutoScrollSpeedY: (speed: number) => void;
	// 滚动位置方法
	setScrollLeft: (scrollLeft: number) => void;
	setTimelineMaxScrollLeft: (maxScrollLeft: number) => void;
	setTimelineViewportWidth: (width: number) => void;
	setTimelineScale: (
		scale: number,
		options?: {
			anchorOffsetPx?: number;
			preserveOriginWhenAnchorAfterContentEnd?: boolean;
		},
	) => void;
	getElementById: (id: string) => TimelineElement | null;
	getAssetById: (id: string) => TimelineAsset | null;
	findAssetByUri: (uri: string) => TimelineAsset | null;
	ensureAssetByUri: (params: {
		uri: string;
		kind: TimelineAsset["kind"];
		name?: string;
	}) => string;
	updateAssetMeta: (
		assetId: string,
		updater: (
			prev: TimelineAsset["meta"] | undefined,
		) => TimelineAsset["meta"] | undefined,
		options?: { history?: boolean },
	) => void;
	getRevision: () => number;
	getCommandSnapshot: () => TimelineCommandSnapshot;
	applyCommandSnapshot: (
		snapshot: TimelineCommandSnapshot,
		options?: { history?: boolean },
	) => void;
}

export type TimelineStoreApi = Mutate<
	StoreApi<TimelineStore>,
	[["zustand/subscribeWithSelector", never]]
>;

interface TimelineHistorySnapshot {
	elements: TimelineElement[];
	assets: TimelineAsset[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	rippleEditingEnabled: boolean;
}

const HISTORY_LIMIT = 100;

const trimHistory = (
	history: TimelineHistorySnapshot[],
	limit: number,
): TimelineHistorySnapshot[] => {
	if (history.length <= limit) return history;
	return history.slice(history.length - limit);
};

const buildHistorySnapshot = (state: {
	elements: TimelineElement[];
	assets: TimelineAsset[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	rippleEditingEnabled: boolean;
}): TimelineHistorySnapshot => {
	// 使用不可变快照复用元素/轨道引用，避免深拷贝占用内存
	return {
		elements: state.elements,
		assets: state.assets,
		tracks: state.tracks,
		audioTrackStates: state.audioTrackStates,
		rippleEditingEnabled: state.rippleEditingEnabled,
	};
};

const reconcileSelection = (
	elements: TimelineElement[],
	selectedIds: string[],
	primarySelectedId: string | null,
): { selectedIds: string[]; primarySelectedId: string | null } => {
	if (selectedIds.length === 0) {
		return { selectedIds: [], primarySelectedId: null };
	}
	const existingIds = new Set(elements.map((el) => el.id));
	const nextSelected = selectedIds.filter((id) => existingIds.has(id));
	if (nextSelected.length === 0) {
		return { selectedIds: [], primarySelectedId: null };
	}
	const nextPrimary =
		primarySelectedId && nextSelected.includes(primarySelectedId)
			? primarySelectedId
			: nextSelected[nextSelected.length - 1];
	return { selectedIds: nextSelected, primarySelectedId: nextPrimary };
};

const pruneSelectionForTrackLock = (
	state: {
		elements: TimelineElement[];
		selectedIds: string[];
		primarySelectedId: string | null;
	},
	trackIndex: number,
): { selectedIds: string[]; primarySelectedId: string | null } => {
	const indexById = new Map(
		state.elements.map((el) => [el.id, el.timeline.trackIndex ?? 0]),
	);
	const nextSelected = state.selectedIds.filter(
		(id) => indexById.get(id) !== trackIndex,
	);
	const nextPrimary =
		state.primarySelectedId && nextSelected.includes(state.primarySelectedId)
			? state.primarySelectedId
			: (nextSelected[nextSelected.length - 1] ?? null);
	return { selectedIds: nextSelected, primarySelectedId: nextPrimary };
};

const resolveStartPlaybackPatch = (
	state: Pick<TimelineStore, "currentTime" | "previewTime" | "elements">,
): Pick<TimelineStore, "isPlaying" | "currentTime" | "previewTime"> => {
	const timelineEndFrame = resolveTimelineEndFrame(state.elements);
	if (state.currentTime >= timelineEndFrame) {
		return {
			isPlaying: false,
			currentTime: timelineEndFrame,
			previewTime: null,
		};
	}
	return {
		isPlaying: true,
		currentTime: state.currentTime,
		previewTime: null,
	};
};

const resolveRenderDisplayTime = (params: {
	displayTime: number;
	elements: TimelineElement[];
}): number => {
	const { displayTime, elements } = params;
	const timelineEndFrame = resolveTimelineEndFrame(elements);
	if (timelineEndFrame <= 0) return displayTime;
	if (displayTime !== timelineEndFrame) return displayTime;
	return Math.max(0, timelineEndFrame - 1);
};

export const createTimelineStore = (): TimelineStoreApi => {
	const timelineStore = createStore<TimelineStore>()(
		subscribeWithSelector((set, get) => ({
			fps: DEFAULT_FPS,
			timelineScale: 1,
			currentTime: 0,
			previewTime: null,
			previewAxisEnabled: true,
			elements: [],
			assets: [],
			tracks: [
				{
					id: MAIN_TRACK_ID,
					role: "clip",
					hidden: false,
					locked: false,
					muted: false,
					solo: false,
				},
			],
			audioTrackStates: {},
			historyPast: [],
			historyFuture: [],
			historyLimit: HISTORY_LIMIT,
			canvasSize: { width: 1920, height: 1080 },
			isPlaying: false,
			isExporting: false,
			exportTime: null,
			seekEpoch: 0,
			isDragging: false,
			selectedIds: [],
			primarySelectedId: null,
			// 吸附相关状态初始值
			snapEnabled: true,
			activeSnapPoint: null,
			// 层叠关联相关状态初始值
			autoAttach: true,
			// 主轨波纹编辑模式初始值
			rippleEditingEnabled: false,
		audioSettings: cloneAudioSettings(DEFAULT_TIMELINE_SETTINGS.audio),
		// 拖拽目标指示状态初始值
		activeDropTarget: null,
		// 拖拽 Ghost 状态初始值
		dragGhosts: [],
		// 自动滚动状态初始值
		autoScrollSpeed: 0,
		autoScrollSpeedY: 0,
		// 滚动位置初始值
		scrollLeft: 0,
		timelineMaxScrollLeft: 0,
		timelineViewportWidth: 0,
		revision: 0,
		getElementById: (id: string) => {
			return get().elements.find((element) => element.id === id) ?? null;
		},
		getAssetById: (id: string) => {
			return get().assets.find((source) => source.id === id) ?? null;
		},
		findAssetByUri: (uri: string) => {
			return get().assets.find((source) => source.uri === uri) ?? null;
		},
		ensureAssetByUri: ({ uri, kind, name }) => {
			let resolvedId: string | null = null;
			set((state) => {
				const existed = state.assets.find((asset) => asset.uri === uri);
				if (existed) {
					resolvedId = existed.id;
					return state;
				}
				const nextAsset: TimelineAsset = {
					id: createAssetId(),
					uri,
					kind,
					...(name ? { name } : {}),
				};
				resolvedId = nextAsset.id;
				return {
					assets: [...state.assets, nextAsset],
				};
			});
			if (!resolvedId) {
				throw new Error("failed to ensure asset");
			}
			return resolvedId;
		},
		updateAssetMeta: (assetId, updater, options) => {
			set((state) => {
				let didChange = false;
				const nextAssets = state.assets.map((asset) => {
					if (asset.id !== assetId) return asset;
					const nextMeta = updater(asset.meta);
					if (nextMeta === asset.meta) {
						return asset;
					}
					didChange = true;
					return {
						...asset,
						meta: nextMeta,
					};
				});
				if (!didChange) return state;
				if (options?.history === false) {
					return {
						assets: nextAssets,
					};
				}
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					assets: nextAssets,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setFps: (fps: number) => {
			set({ fps: normalizeFps(fps) });
		},

		setTimelineScale: (
			scale: number,
			options?: {
				anchorOffsetPx?: number;
				preserveOriginWhenAnchorAfterContentEnd?: boolean;
			},
		) => {
			set((state) => {
				const parsedScale = Number.isFinite(scale) ? scale : 1;
				const nextScale = Math.min(
					MAX_TIMELINE_SCALE,
					Math.max(MIN_TIMELINE_SCALE, parsedScale),
				);
				const prevRatio = getPixelsPerFrame(state.fps, state.timelineScale);
				const nextRatio = getPixelsPerFrame(state.fps, nextScale);
				if (
					!Number.isFinite(prevRatio) ||
					prevRatio <= 0 ||
					!Number.isFinite(nextRatio) ||
					nextRatio <= 0
				) {
					if (state.timelineScale === nextScale) return state;
					return { timelineScale: nextScale };
				}

				const viewportWidth = Math.max(0, state.timelineViewportWidth);
				const anchorBase = Number.isFinite(options?.anchorOffsetPx ?? NaN)
					? (options?.anchorOffsetPx as number)
					: viewportWidth / 2;
				const anchorOffsetPx = Math.min(
					Math.max(anchorBase, 0),
					Math.max(0, viewportWidth),
				);
				const currentScrollLeft = Math.max(0, state.scrollLeft);
				const timeAtAnchor = Math.max(
					0,
					(currentScrollLeft + anchorOffsetPx - TIMELINE_PADDING_LEFT) /
						prevRatio,
				);
				const shouldPreserveOrigin =
					options?.preserveOriginWhenAnchorAfterContentEnd &&
					currentScrollLeft <= 0.5 &&
					timeAtAnchor > resolveTimelineEndFrame(state.elements);
				const rawNextScrollLeft = shouldPreserveOrigin
					? 0
					: Math.max(
							0,
							timeAtAnchor * nextRatio +
								TIMELINE_PADDING_LEFT -
								anchorOffsetPx,
						);
				const nextScrollLeft = Number.isFinite(rawNextScrollLeft)
					? rawNextScrollLeft
					: state.scrollLeft;
				if (
					state.timelineScale === nextScale &&
					state.scrollLeft === nextScrollLeft
				) {
					return state;
				}
				return {
					timelineScale: nextScale,
					scrollLeft: nextScrollLeft,
				};
			});
		},

		setCurrentTime: (time: number) => {
			const { currentTime, isExporting } = get();
			if (isExporting) return; // 导出期间冻结时间轴
			const nextTime = clampFrame(time);
			if (currentTime !== nextTime) {
				set({ currentTime: nextTime });
			}
		},
		seekTo: (time: number) => {
			set((state) => {
				if (state.isExporting) return state;
				const nextTime = clampFrame(time);
				if (state.currentTime === nextTime) return state;
				return {
					currentTime: nextTime,
					seekEpoch: state.seekEpoch + 1,
				};
			});
		},

		setPreviewTime: (time: number | null) => {
			set((state) => {
				if (state.isExporting) {
					return state; // 导出期间忽略 hover 预览
				}
				if (!state.previewAxisEnabled) {
					if (state.previewTime === null) return state;
					return { previewTime: null };
				}
				const nextPreview = time === null ? null : clampFrame(time);
				if (state.previewTime === nextPreview) return state;
				return { previewTime: nextPreview };
			});
		},
		setPreviewAxisEnabled: (enabled: boolean) => {
			set((state) => {
				if (state.previewAxisEnabled === enabled) return state;
				return {
					previewAxisEnabled: enabled,
					previewTime: enabled ? state.previewTime : null,
				};
			});
		},

		setElements: (
			elements:
				| TimelineElement[]
				| ((prev: TimelineElement[]) => TimelineElement[]),
			options?: { history?: boolean },
		) => {
			set((state) => {
				const nextElements =
					typeof elements === "function" ? elements(state.elements) : elements;
				if (state.elements === nextElements) return state;
				if (options?.history === false) {
					return {
						elements: nextElements,
					};
				}
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					elements: nextElements,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setAssets: (
			assets:
				| TimelineAsset[]
				| ((prev: TimelineAsset[]) => TimelineAsset[]),
			options?: { history?: boolean },
		) => {
			set((state) => {
				const nextSources =
					typeof assets === "function" ? assets(state.assets) : assets;
				if (state.assets === nextSources) return state;
				if (options?.history === false) {
					return {
						assets: nextSources,
					};
				}
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					assets: nextSources,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setTracks: (
			tracks: TimelineTrack[] | ((prev: TimelineTrack[]) => TimelineTrack[]),
		) => {
			set((state) => {
				const nextTracks =
					typeof tracks === "function" ? tracks(state.tracks) : tracks;
				if (state.tracks === nextTracks) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		undo: () => {
			set((state) => {
				if (state.historyPast.length === 0) {
					if (!state.isPlaying) return state;
					return { isPlaying: false };
				}
				const previous = state.historyPast[state.historyPast.length - 1];
				const nextPast = state.historyPast.slice(0, -1);
				const nextFuture = [
					buildHistorySnapshot(state),
					...state.historyFuture,
				];
				const selection = reconcileSelection(
					previous.elements,
					state.selectedIds,
					state.primarySelectedId,
				);
				return {
					elements: previous.elements,
					assets: previous.assets,
					tracks: previous.tracks,
					audioTrackStates: previous.audioTrackStates,
					rippleEditingEnabled: previous.rippleEditingEnabled,
					historyPast: nextPast,
					historyFuture: nextFuture,
					selectedIds: selection.selectedIds,
					primarySelectedId: selection.primarySelectedId,
					isPlaying: false,
				};
			});
		},

		redo: () => {
			set((state) => {
				if (state.historyFuture.length === 0) {
					if (!state.isPlaying) return state;
					return { isPlaying: false };
				}
				const next = state.historyFuture[0];
				const nextFuture = state.historyFuture.slice(1);
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				const selection = reconcileSelection(
					next.elements,
					state.selectedIds,
					state.primarySelectedId,
				);
				return {
					elements: next.elements,
					assets: next.assets,
					tracks: next.tracks,
					audioTrackStates: next.audioTrackStates,
					rippleEditingEnabled: next.rippleEditingEnabled,
					historyPast: nextPast,
					historyFuture: nextFuture,
					selectedIds: selection.selectedIds,
					primarySelectedId: selection.primarySelectedId,
					isPlaying: false,
				};
			});
		},

		resetHistory: () => {
			set({
				historyPast: [],
				historyFuture: [],
				selectedIds: [],
				primarySelectedId: null,
			});
		},

		setTrackHidden: (trackId: string, hidden: boolean) => {
			set((state) => {
				let didChange = false;
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					if (track.hidden === hidden) return track;
					didChange = true;
					return { ...track, hidden };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		toggleTrackHidden: (trackId: string) => {
			set((state) => {
				let didChange = false;
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					didChange = true;
					return { ...track, hidden: !track.hidden };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setTrackLocked: (trackId: string, locked: boolean) => {
			set((state) => {
				let didChange = false;
				let nextLocked = locked;
				const targetIndex = state.tracks.findIndex(
					(track) => track.id === trackId,
				);
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					if (track.locked === locked) return track;
					didChange = true;
					nextLocked = locked;
					return { ...track, locked };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				const nextSelection =
					nextLocked && targetIndex >= 0
						? pruneSelectionForTrackLock(state, targetIndex)
						: {
								selectedIds: state.selectedIds,
								primarySelectedId: state.primarySelectedId,
							};
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
					selectedIds: nextSelection.selectedIds,
					primarySelectedId: nextSelection.primarySelectedId,
				};
			});
		},

		toggleTrackLocked: (trackId: string) => {
			set((state) => {
				let didChange = false;
				let nextLocked = false;
				const targetIndex = state.tracks.findIndex(
					(track) => track.id === trackId,
				);
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					didChange = true;
					nextLocked = !track.locked;
					return { ...track, locked: nextLocked };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				const nextSelection =
					nextLocked && targetIndex >= 0
						? pruneSelectionForTrackLock(state, targetIndex)
						: {
								selectedIds: state.selectedIds,
								primarySelectedId: state.primarySelectedId,
							};
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
					selectedIds: nextSelection.selectedIds,
					primarySelectedId: nextSelection.primarySelectedId,
				};
			});
		},

		setTrackMuted: (trackId: string, muted: boolean) => {
			set((state) => {
				let didChange = false;
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					if (track.muted === muted) return track;
					didChange = true;
					return { ...track, muted };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		toggleTrackMuted: (trackId: string) => {
			set((state) => {
				let didChange = false;
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					didChange = true;
					return { ...track, muted: !track.muted };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setTrackSolo: (trackId: string, solo: boolean) => {
			set((state) => {
				let didChange = false;
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					if (track.solo === solo) return track;
					didChange = true;
					return { ...track, solo };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		toggleTrackSolo: (trackId: string) => {
			set((state) => {
				let didChange = false;
				const nextTracks = state.tracks.map((track) => {
					if (track.id !== trackId) return track;
					didChange = true;
					return { ...track, solo: !track.solo };
				});
				if (!didChange) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					tracks: nextTracks,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setAudioTrackLocked: (trackIndex: number, locked: boolean) => {
			set((state) => {
				if (trackIndex >= 0) return state;
				const prevAudioTrack = getAudioTrackControlState(
					state.audioTrackStates,
					trackIndex,
				);
				if (prevAudioTrack.locked === locked) return state;
				const nextAudioTrackStates = {
					...state.audioTrackStates,
					[trackIndex]: {
						...prevAudioTrack,
						locked,
					},
				};
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				const nextSelection = locked
					? pruneSelectionForTrackLock(state, trackIndex)
					: {
							selectedIds: state.selectedIds,
							primarySelectedId: state.primarySelectedId,
						};
				return {
					audioTrackStates: nextAudioTrackStates,
					historyPast: nextPast,
					historyFuture: [],
					selectedIds: nextSelection.selectedIds,
					primarySelectedId: nextSelection.primarySelectedId,
				};
			});
		},

		toggleAudioTrackLocked: (trackIndex: number) => {
			set((state) => {
				if (trackIndex >= 0) return state;
				const prevAudioTrack = getAudioTrackControlState(
					state.audioTrackStates,
					trackIndex,
				);
				const nextLocked = !prevAudioTrack.locked;
				const nextAudioTrackStates = {
					...state.audioTrackStates,
					[trackIndex]: {
						...prevAudioTrack,
						locked: nextLocked,
					},
				};
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				const nextSelection = nextLocked
					? pruneSelectionForTrackLock(state, trackIndex)
					: {
							selectedIds: state.selectedIds,
							primarySelectedId: state.primarySelectedId,
						};
				return {
					audioTrackStates: nextAudioTrackStates,
					historyPast: nextPast,
					historyFuture: [],
					selectedIds: nextSelection.selectedIds,
					primarySelectedId: nextSelection.primarySelectedId,
				};
			});
		},

		setAudioTrackMuted: (trackIndex: number, muted: boolean) => {
			set((state) => {
				if (trackIndex >= 0) return state;
				const prevAudioTrack = getAudioTrackControlState(
					state.audioTrackStates,
					trackIndex,
				);
				if (prevAudioTrack.muted === muted) return state;
				const nextAudioTrackStates = {
					...state.audioTrackStates,
					[trackIndex]: {
						...prevAudioTrack,
						muted,
					},
				};
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					audioTrackStates: nextAudioTrackStates,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		toggleAudioTrackMuted: (trackIndex: number) => {
			set((state) => {
				if (trackIndex >= 0) return state;
				const prevAudioTrack = getAudioTrackControlState(
					state.audioTrackStates,
					trackIndex,
				);
				const nextAudioTrackStates = {
					...state.audioTrackStates,
					[trackIndex]: {
						...prevAudioTrack,
						muted: !prevAudioTrack.muted,
					},
				};
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					audioTrackStates: nextAudioTrackStates,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setAudioTrackSolo: (trackIndex: number, solo: boolean) => {
			set((state) => {
				if (trackIndex >= 0) return state;
				const prevAudioTrack = getAudioTrackControlState(
					state.audioTrackStates,
					trackIndex,
				);
				if (prevAudioTrack.solo === solo) return state;
				const nextAudioTrackStates = {
					...state.audioTrackStates,
					[trackIndex]: {
						...prevAudioTrack,
						solo,
					},
				};
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					audioTrackStates: nextAudioTrackStates,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		toggleAudioTrackSolo: (trackIndex: number) => {
			set((state) => {
				if (trackIndex >= 0) return state;
				const prevAudioTrack = getAudioTrackControlState(
					state.audioTrackStates,
					trackIndex,
				);
				const nextAudioTrackStates = {
					...state.audioTrackStates,
					[trackIndex]: {
						...prevAudioTrack,
						solo: !prevAudioTrack.solo,
					},
				};
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					audioTrackStates: nextAudioTrackStates,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},

		setCanvasSize: (size: { width: number; height: number }) => {
			set({ canvasSize: size });
		},

		getCurrentTime: () => {
			return get().currentTime;
		},

		getDisplayTime: () => {
			const { previewTime, currentTime, previewAxisEnabled } = get();
			return previewAxisEnabled ? (previewTime ?? currentTime) : currentTime;
		},
		getRenderTime: () => {
			return resolveRenderTime(get());
		},

		getElements: () => {
			return get().elements;
		},
		getAssets: () => {
			return get().assets;
		},

		getCanvasSize: () => {
			return get().canvasSize;
		},

		play: () => {
			set((state) => {
				if (state.isPlaying) return state;
				const nextPlaybackState = resolveStartPlaybackPatch(state);
				if (
					state.isPlaying === nextPlaybackState.isPlaying &&
					state.currentTime === nextPlaybackState.currentTime &&
					state.previewTime === nextPlaybackState.previewTime
				) {
					return state;
				}
				return nextPlaybackState;
			});
		},

		pause: () => {
			set({ isPlaying: false });
		},

		togglePlay: () => {
			set((state) => {
				const nextIsPlaying = !state.isPlaying;
				if (!nextIsPlaying) {
					return { isPlaying: false };
				}
				const nextPlaybackState = resolveStartPlaybackPatch(state);
				if (
					state.isPlaying === nextPlaybackState.isPlaying &&
					state.currentTime === nextPlaybackState.currentTime &&
					state.previewTime === nextPlaybackState.previewTime
				) {
					return state;
				}
				return nextPlaybackState;
			});
		},
		setIsExporting: (isExporting: boolean) => {
			set((state) => {
				if (state.isExporting === isExporting) return state;
				return { isExporting };
			});
		},
		setExportTime: (time: number | null) => {
			set((state) => {
				if (state.exportTime === time) return state;
				return { exportTime: time };
			});
		},

		setIsDragging: (isDragging: boolean) => {
			set({ isDragging });
		},

		setSelectedElementId: (id: string | null) => {
			if (!id) {
				set({ selectedIds: [], primarySelectedId: null });
				return;
			}
			set({ selectedIds: [id], primarySelectedId: id });
		},

		setSelectedIds: (ids: string[], primaryId?: string | null) => {
			const uniqueIds = Array.from(new Set(ids));
			const resolvedPrimary =
				uniqueIds.length === 0
					? null
					: primaryId && uniqueIds.includes(primaryId)
						? primaryId
						: uniqueIds[uniqueIds.length - 1];
			set({ selectedIds: uniqueIds, primarySelectedId: resolvedPrimary });
		},

		// 吸附相关方法
		setSnapEnabled: (enabled: boolean) => {
			set({ snapEnabled: enabled });
		},

		setActiveSnapPoint: (point: SnapPoint | null) => {
			set({ activeSnapPoint: point });
		},

		// 层叠关联相关方法
		setAutoAttach: (enabled: boolean) => {
			set({ autoAttach: enabled });
		},

		// 主轨波纹编辑模式方法
		setRippleEditingEnabled: (enabled: boolean) => {
			set((state) => {
				if (state.rippleEditingEnabled === enabled) return state;
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					rippleEditingEnabled: enabled,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},
		setAudioSettings: (audioSettings: TimelineSettings["audio"]) => {
			set({ audioSettings: cloneAudioSettings(audioSettings) });
		},

		// 拖拽目标指示方法
		setActiveDropTarget: (target: ExtendedDropTarget | null) => {
			set({ activeDropTarget: target });
		},

		// 拖拽 Ghost 方法
		setDragGhosts: (ghosts: DragGhostState[]) => {
			set({ dragGhosts: ghosts });
		},

		// 自动滚动方法
		setAutoScrollSpeed: (speed: number) => {
			set({ autoScrollSpeed: speed });
		},

		setAutoScrollSpeedY: (speed: number) => {
			set({ autoScrollSpeedY: speed });
		},

		// 滚动位置方法
		setScrollLeft: (scrollLeft: number) => {
			set((state) => {
				const nextScrollLeft = Number.isFinite(scrollLeft)
					? Math.min(
							Math.max(0, scrollLeft),
							Math.max(0, state.timelineMaxScrollLeft),
						)
					: state.scrollLeft;
				if (nextScrollLeft === state.scrollLeft) return state;
				return { scrollLeft: nextScrollLeft };
			});
		},
		setTimelineMaxScrollLeft: (maxScrollLeft: number) => {
			set((state) => {
				const nextMaxScrollLeft = Number.isFinite(maxScrollLeft)
					? Math.max(0, maxScrollLeft)
					: 0;
				const nextScrollLeft = Math.min(state.scrollLeft, nextMaxScrollLeft);
				if (
					nextMaxScrollLeft === state.timelineMaxScrollLeft &&
					nextScrollLeft === state.scrollLeft
				) {
					return state;
				}
				return {
					timelineMaxScrollLeft: nextMaxScrollLeft,
					scrollLeft: nextScrollLeft,
				};
			});
		},
		setTimelineViewportWidth: (width: number) => {
			const nextWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
			set({ timelineViewportWidth: nextWidth });
		},
		getRevision: () => get().revision,
		getCommandSnapshot: () => {
			const state = get();
			return {
				revision: state.revision,
				fps: state.fps,
				currentTime: state.currentTime,
				elements: state.elements,
				assets: state.assets,
				tracks: state.tracks,
				audioTrackStates: state.audioTrackStates,
				autoAttach: state.autoAttach,
				rippleEditingEnabled: state.rippleEditingEnabled,
			};
		},
		applyCommandSnapshot: (
			snapshot: TimelineCommandSnapshot,
			options?: { history?: boolean },
		) => {
			set((state) => {
				const nextCurrentTime = clampFrame(snapshot.currentTime);
				const didChange =
					state.currentTime !== nextCurrentTime ||
					state.elements !== snapshot.elements ||
					state.assets !== snapshot.assets ||
					state.tracks !== snapshot.tracks ||
					state.audioTrackStates !== snapshot.audioTrackStates ||
					state.autoAttach !== snapshot.autoAttach ||
					state.rippleEditingEnabled !== snapshot.rippleEditingEnabled;
				if (!didChange) return state;

				const selection = reconcileSelection(
					snapshot.elements,
					state.selectedIds,
					state.primarySelectedId,
				);
				const nextStateBase = {
					currentTime: nextCurrentTime,
					elements: snapshot.elements,
					assets: snapshot.assets,
					tracks: snapshot.tracks,
					audioTrackStates: snapshot.audioTrackStates,
					autoAttach: snapshot.autoAttach,
					rippleEditingEnabled: snapshot.rippleEditingEnabled,
					selectedIds: selection.selectedIds,
					primarySelectedId: selection.primarySelectedId,
				};
				if (options?.history === false) {
					return nextStateBase;
				}
				const nextPast = trimHistory(
					[...state.historyPast, buildHistorySnapshot(state)],
					state.historyLimit,
				);
				return {
					...nextStateBase,
					historyPast: nextPast,
					historyFuture: [],
				};
			});
		},
		})),
	);
	timelineStore.subscribe(
		selectRevisionDeps,
		() => {
			timelineStore.setState((state) => ({
				revision: state.revision + 1,
			}));
		},
		{ equalityFn: isRevisionDepsEqual },
	);
	return timelineStore;
};

interface TimelineRevisionDeps {
	fps: number;
	timelineScale: number;
	currentTime: number;
	previewTime: number | null;
	previewAxisEnabled: boolean;
	elements: TimelineElement[];
	assets: TimelineAsset[];
	tracks: TimelineTrack[];
	audioTrackStates: AudioTrackControlStateMap;
	isPlaying: boolean;
	isExporting: boolean;
	exportTime: number | null;
	seekEpoch: number;
	selectedIds: string[];
	primarySelectedId: string | null;
	snapEnabled: boolean;
	autoAttach: boolean;
	rippleEditingEnabled: boolean;
	scrollLeft: number;
	timelineMaxScrollLeft: number;
	timelineViewportWidth: number;
}

const selectRevisionDeps = (state: TimelineStore): TimelineRevisionDeps => ({
	fps: state.fps,
	timelineScale: state.timelineScale,
	currentTime: state.currentTime,
	previewTime: state.previewTime,
	previewAxisEnabled: state.previewAxisEnabled,
	elements: state.elements,
	assets: state.assets,
	tracks: state.tracks,
	audioTrackStates: state.audioTrackStates,
	isPlaying: state.isPlaying,
	isExporting: state.isExporting,
	exportTime: state.exportTime,
	seekEpoch: state.seekEpoch,
	selectedIds: state.selectedIds,
	primarySelectedId: state.primarySelectedId,
	snapEnabled: state.snapEnabled,
	autoAttach: state.autoAttach,
	rippleEditingEnabled: state.rippleEditingEnabled,
	scrollLeft: state.scrollLeft,
	timelineMaxScrollLeft: state.timelineMaxScrollLeft,
	timelineViewportWidth: state.timelineViewportWidth,
});

const isRevisionDepsEqual = (
	prev: TimelineRevisionDeps,
	next: TimelineRevisionDeps,
): boolean => {
	return (
		prev.fps === next.fps &&
		prev.timelineScale === next.timelineScale &&
		prev.currentTime === next.currentTime &&
		prev.previewTime === next.previewTime &&
		prev.previewAxisEnabled === next.previewAxisEnabled &&
		prev.elements === next.elements &&
		prev.assets === next.assets &&
		prev.tracks === next.tracks &&
		prev.audioTrackStates === next.audioTrackStates &&
		prev.isPlaying === next.isPlaying &&
		prev.isExporting === next.isExporting &&
		prev.exportTime === next.exportTime &&
		prev.seekEpoch === next.seekEpoch &&
		prev.selectedIds === next.selectedIds &&
		prev.primarySelectedId === next.primarySelectedId &&
		prev.snapEnabled === next.snapEnabled &&
		prev.autoAttach === next.autoAttach &&
		prev.rippleEditingEnabled === next.rippleEditingEnabled &&
		prev.scrollLeft === next.scrollLeft &&
		prev.timelineMaxScrollLeft === next.timelineMaxScrollLeft &&
		prev.timelineViewportWidth === next.timelineViewportWidth
	);
};

export const useTimelineStore = <T,>(
	selector: (state: TimelineStore) => T,
	equalityFn?: (a: T, b: T) => boolean,
): T => {
	const timelineStore = useTimelineStoreApi();
	return useSyncExternalStore(
		useCallback(
			(onStoreChange) =>
				timelineStore.subscribe(
					selector,
					() => {
						onStoreChange();
					},
					{ equalityFn },
				),
			[equalityFn, selector, timelineStore],
		),
		useCallback(() => selector(timelineStore.getState()), [selector, timelineStore]),
		useCallback(
			() => selector(timelineStore.getInitialState()),
			[selector, timelineStore],
		),
	);
};

// 渲染时间：导出时使用导出帧；预览在末尾帧时回退一帧，避免结束黑屏
const resolveRenderTime = (state: TimelineStore): number => {
	if (state.isExporting && state.exportTime !== null) return state.exportTime;
	const displayTime = state.isPlaying
		? state.currentTime
		: (state.previewTime ?? state.currentTime);
	return resolveRenderDisplayTime({
		displayTime,
		elements: state.elements,
	});
};

export const useRenderTime = () => {
	return useTimelineStore(resolveRenderTime);
};

export const useCurrentTime = () => {
	const currentTime = useTimelineStore((state) => state.currentTime);
	const previewTime = useTimelineStore((state) => state.previewTime);
	const previewAxisEnabled = useTimelineStore(
		(state) => state.previewAxisEnabled,
	);
	const seekTo = useTimelineStore((state) => state.seekTo);

	return {
		currentTime: previewAxisEnabled
			? (previewTime ?? currentTime)
			: currentTime,
		setCurrentTime: seekTo,
		seekTo,
	};
};

export const useDisplayTime = () => {
	const currentTime = useTimelineStore((state) => state.currentTime);
	const previewTime = useTimelineStore((state) => state.previewTime);
	const previewAxisEnabled = useTimelineStore(
		(state) => state.previewAxisEnabled,
	);
	return previewAxisEnabled ? (previewTime ?? currentTime) : currentTime;
};

export const useFps = () => {
	const fps = useTimelineStore((state) => state.fps);
	const setFps = useTimelineStore((state) => state.setFps);
	return { fps, setFps };
};

export const useTimelineScale = () => {
	const timelineScale = useTimelineStore((state) => state.timelineScale);
	const setTimelineScale = useTimelineStore((state) => state.setTimelineScale);
	return { timelineScale, setTimelineScale };
};

export const useTimelineHistory = () => {
	const canUndo = useTimelineStore((state) => state.historyPast.length > 0);
	const canRedo = useTimelineStore((state) => state.historyFuture.length > 0);
	const undo = useTimelineStore((state) => state.undo);
	const redo = useTimelineStore((state) => state.redo);
	return { canUndo, canRedo, undo, redo };
};

export const usePreviewTime = () => {
	const previewTime = useTimelineStore((state) => state.previewTime);
	const setPreviewTime = useTimelineStore((state) => state.setPreviewTime);

	return {
		previewTime,
		setPreviewTime,
	};
};

export const usePreviewAxis = () => {
	const previewAxisEnabled = useTimelineStore(
		(state) => state.previewAxisEnabled,
	);
	const setPreviewAxisEnabled = useTimelineStore(
		(state) => state.setPreviewAxisEnabled,
	);

	return {
		previewAxisEnabled,
		setPreviewAxisEnabled,
	};
};

export const useElements = () => {
	const elements = useTimelineStore((state) => state.elements);
	const setElements = useTimelineStore((state) => state.setElements);

	return {
		elements,
		setElements,
	};
};

export const useAssets = () => {
	const assets = useTimelineStore((state) => state.assets);
	const setAssets = useTimelineStore((state) => state.setAssets);
	const ensureAssetByUri = useTimelineStore((state) => state.ensureAssetByUri);
	const findAssetByUri = useTimelineStore((state) => state.findAssetByUri);
	const getAssetById = useTimelineStore((state) => state.getAssetById);
	const updateAssetMeta = useTimelineStore((state) => state.updateAssetMeta);

	return {
		assets,
		setAssets,
		ensureAssetByUri,
		findAssetByUri,
		getAssetById,
		updateAssetMeta,
	};
};

export const usePlaybackControl = () => {
	const isPlaying = useTimelineStore((state) => state.isPlaying);
	const play = useTimelineStore((state) => state.play);
	const pause = useTimelineStore((state) => state.pause);
	const togglePlay = useTimelineStore((state) => state.togglePlay);

	return {
		isPlaying,
		play,
		pause,
		togglePlay,
	};
};

export const useDragging = () => {
	const isDragging = useTimelineStore((state) => state.isDragging);
	const setIsDragging = useTimelineStore((state) => state.setIsDragging);
	const activeDropTarget = useTimelineStore((state) => state.activeDropTarget);
	const setActiveDropTarget = useTimelineStore(
		(state) => state.setActiveDropTarget,
	);
	const dragGhosts = useTimelineStore((state) => state.dragGhosts);
	const setDragGhosts = useTimelineStore((state) => state.setDragGhosts);

	return {
		isDragging,
		setIsDragging,
		activeDropTarget,
		setActiveDropTarget,
		dragGhosts,
		setDragGhosts,
	};
};

export const useAutoScroll = () => {
	const autoScrollSpeed = useTimelineStore((state) => state.autoScrollSpeed);
	const autoScrollSpeedY = useTimelineStore((state) => state.autoScrollSpeedY);
	const setAutoScrollSpeed = useTimelineStore(
		(state) => state.setAutoScrollSpeed,
	);
	const setAutoScrollSpeedY = useTimelineStore(
		(state) => state.setAutoScrollSpeedY,
	);

	/**
	 * 根据鼠标位置计算并设置水平自动滚动速度
	 */
	const updateAutoScrollFromPosition = useCallback(
		(
			screenX: number,
			containerLeft: number,
			containerRight: number,
			config: AutoScrollConfig = DEFAULT_AUTO_SCROLL_CONFIG,
		) => {
			const { edgeThreshold, maxSpeed } = config;

			// 检查左边缘
			const distanceFromLeft = screenX - containerLeft;
			if (distanceFromLeft < edgeThreshold && distanceFromLeft >= 0) {
				const intensity = 1 - distanceFromLeft / edgeThreshold;
				setAutoScrollSpeed(-intensity * maxSpeed);
				return;
			}

			// 检查右边缘
			const distanceFromRight = containerRight - screenX;
			if (distanceFromRight < edgeThreshold && distanceFromRight >= 0) {
				const intensity = 1 - distanceFromRight / edgeThreshold;
				setAutoScrollSpeed(intensity * maxSpeed);
				return;
			}

			// 不在边缘区域，停止水平滚动
			if (autoScrollSpeed !== 0) {
				setAutoScrollSpeed(0);
			}
		},
		[autoScrollSpeed, setAutoScrollSpeed],
	);

	/**
	 * 根据鼠标位置计算并设置垂直自动滚动速度
	 */
	const updateAutoScrollYFromPosition = useCallback(
		(
			screenY: number,
			containerTop: number,
			containerBottom: number,
			config: AutoScrollConfig = DEFAULT_AUTO_SCROLL_CONFIG,
		) => {
			const { edgeThreshold, maxSpeed } = config;

			// 检查上边缘
			const distanceFromTop = screenY - containerTop;
			if (distanceFromTop < edgeThreshold && distanceFromTop >= 0) {
				const intensity = 1 - distanceFromTop / edgeThreshold;
				setAutoScrollSpeedY(-intensity * maxSpeed);
				return;
			}

			// 检查下边缘
			const distanceFromBottom = containerBottom - screenY;
			if (distanceFromBottom < edgeThreshold && distanceFromBottom >= 0) {
				const intensity = 1 - distanceFromBottom / edgeThreshold;
				setAutoScrollSpeedY(intensity * maxSpeed);
				return;
			}

			// 不在边缘区域，停止垂直滚动
			if (autoScrollSpeedY !== 0) {
				setAutoScrollSpeedY(0);
			}
		},
		[autoScrollSpeedY, setAutoScrollSpeedY],
	);

	// 停止自动滚动（水平和垂直）
	const stopAutoScroll = useCallback(() => {
		setAutoScrollSpeed(0);
		setAutoScrollSpeedY(0);
	}, [setAutoScrollSpeed, setAutoScrollSpeedY]);

	return {
		autoScrollSpeed,
		autoScrollSpeedY,
		setAutoScrollSpeed,
		setAutoScrollSpeedY,
		updateAutoScrollFromPosition,
		updateAutoScrollYFromPosition,
		stopAutoScroll,
	};
};

export const useSelectedElement = () => {
	const selectedElementId = useTimelineStore(
		(state) => state.primarySelectedId,
	);
	const setSelectedElementId = useTimelineStore(
		(state) => state.setSelectedElementId,
	);
	const selectedElement = useTimelineStore((state) =>
		selectedElementId ? state.getElementById(selectedElementId) : null,
	);

	return {
		selectedElementId,
		selectedElement,
		setSelectedElementId,
	};
};

export const useSnap = () => {
	const snapEnabled = useTimelineStore((state) => state.snapEnabled);
	const activeSnapPoint = useTimelineStore((state) => state.activeSnapPoint);
	const setSnapEnabled = useTimelineStore((state) => state.setSnapEnabled);
	const setActiveSnapPoint = useTimelineStore(
		(state) => state.setActiveSnapPoint,
	);

	return {
		snapEnabled,
		activeSnapPoint,
		setSnapEnabled,
		setActiveSnapPoint,
	};
};

export const useRippleEditing = () => {
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);
	const setRippleEditingEnabled = useTimelineStore(
		(state) => state.setRippleEditingEnabled,
	);

	return {
		rippleEditingEnabled,
		setRippleEditingEnabled,
	};
};

export const useTracks = () => {
	const tracks = useTimelineStore((state) => state.tracks);
	const audioTrackStates = useTimelineStore((state) => state.audioTrackStates);
	const setTracks = useTimelineStore((state) => state.setTracks);
	const setTrackHidden = useTimelineStore((state) => state.setTrackHidden);
	const toggleTrackHidden = useTimelineStore(
		(state) => state.toggleTrackHidden,
	);
	const setTrackLocked = useTimelineStore((state) => state.setTrackLocked);
	const toggleTrackLocked = useTimelineStore(
		(state) => state.toggleTrackLocked,
	);
	const setTrackMuted = useTimelineStore((state) => state.setTrackMuted);
	const toggleTrackMuted = useTimelineStore((state) => state.toggleTrackMuted);
	const setTrackSolo = useTimelineStore((state) => state.setTrackSolo);
	const toggleTrackSolo = useTimelineStore((state) => state.toggleTrackSolo);
	const setAudioTrackLocked = useTimelineStore(
		(state) => state.setAudioTrackLocked,
	);
	const toggleAudioTrackLocked = useTimelineStore(
		(state) => state.toggleAudioTrackLocked,
	);
	const setAudioTrackMuted = useTimelineStore(
		(state) => state.setAudioTrackMuted,
	);
	const toggleAudioTrackMuted = useTimelineStore(
		(state) => state.toggleAudioTrackMuted,
	);
	const setAudioTrackSolo = useTimelineStore(
		(state) => state.setAudioTrackSolo,
	);
	const toggleAudioTrackSolo = useTimelineStore(
		(state) => state.toggleAudioTrackSolo,
	);

	return {
		tracks,
		audioTrackStates,
		setTracks,
		setTrackHidden,
		toggleTrackHidden,
		setTrackLocked,
		toggleTrackLocked,
		setTrackMuted,
		toggleTrackMuted,
		setTrackSolo,
		toggleTrackSolo,
		setAudioTrackLocked,
		toggleAudioTrackLocked,
		setAudioTrackMuted,
		toggleAudioTrackMuted,
		setAudioTrackSolo,
		toggleAudioTrackSolo,
	};
};

export const useTrackAssignments = () => {
	const elements = useTimelineStore((state) => state.elements);
	const setElements = useTimelineStore((state) => state.setElements);
	const tracks = useTimelineStore((state) => state.tracks);
	const audioTrackStates = useTimelineStore((state) => state.audioTrackStates);
	const fps = useTimelineStore((state) => state.fps);
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);
	const { attachments, autoAttach } = useAttachments();
	const trackLockedMap = useMemo(
		() => createTrackLockedMap(tracks, audioTrackStates),
		[tracks, audioTrackStates],
	);

	// 基于 elements 计算轨道分配
	const trackAssignments = useMemo(() => {
		return getStoredTrackAssignments(elements);
	}, [elements]);

	const trackCount = tracks.length || 1;

	// 更新元素的轨道位置
	const updateElementTrack = useCallback(
		(elementId: string, targetTrack: number) => {
			setElements((prev) => {
				const element = prev.find((el) => el.id === elementId);
				if (!element) return prev;
				const currentAssignments = getStoredTrackAssignments(prev);
				const elementRole = getElementRole(element);
				const resolvedDropTarget = resolveDropTargetForRole(
					{ type: "track", trackIndex: targetTrack },
					elementRole,
					prev,
					currentAssignments,
				);
				const resolvedTargetTrack = resolvedDropTarget.trackIndex;

				// 计算最终轨道位置（如果有重叠则向上寻找）
				const finalTrack = findAvailableTrack(
					element.timeline.start,
					element.timeline.end,
					resolvedTargetTrack,
					elementRole,
					prev,
					currentAssignments,
					elementId,
					trackCount,
				);
				const targetTrackId = tracks[finalTrack]?.id;

				// 更新元素的 trackIndex
				return prev.map((el) => {
					if (el.id === elementId) {
						return {
							...el,
							timeline: {
								...el.timeline,
								trackIndex: finalTrack,
								...(targetTrackId ? { trackId: targetTrackId } : {}),
							},
						};
					}
					return el;
				});
			});
		},
		[setElements, trackCount, tracks],
	);

	// 更新元素的时间和轨道位置（用于拖拽结束）
	const updateElementTimeAndTrack = useCallback(
		(elementId: string, start: number, end: number, dropTarget: DropTarget) => {
			setElements((prev) => {
				// 计算当前的轨道分配
				const currentAssignments = getStoredTrackAssignments(prev);
				const originalElement = prev.find((el) => el.id === elementId);
				const elementRole = originalElement
					? getElementRole(originalElement)
					: "overlay";
				const resolvedDropTarget = resolveDropTargetForRole(
					dropTarget,
					elementRole,
					prev,
					currentAssignments,
				);
				const { finalTrack, updatedAssignments } =
					resolveTrackPlacementWithStoredAssignments({
						entries: prev,
						elementId,
						start,
						end,
						role: elementRole,
						dropTarget: resolvedDropTarget,
						assignments: currentAssignments,
						originalTrack: originalElement?.timeline.trackIndex ?? 0,
						resolveRole: resolveTimelineElementRole,
					});

				const targetTrackId = tracks[finalTrack]?.id;

				// 应用时间和轨道更新
				const updated = prev.map((el) => {
					if (el.id === elementId) {
						const updatedElement = updateElementTime(el, start, end, fps);
						return {
							...updatedElement,
							timeline: {
								...updatedElement.timeline,
								trackIndex: finalTrack,
								...(targetTrackId ? { trackId: targetTrackId } : {}),
							},
						};
					}
					// 应用可能的轨道移动（插入模式时其他元素的轨道会变化）
					const newTrack = updatedAssignments.get(el.id);
					if (newTrack !== undefined && newTrack !== el.timeline.trackIndex) {
						return {
							...el,
							timeline: {
								...el.timeline,
								trackIndex: newTrack,
							},
						};
					}
					return el;
				});

				return finalizeTimelineElements(updated, {
					rippleEditingEnabled,
					attachments,
					autoAttach,
					fps,
					trackLockedMap,
				});
			});
		},
		[
			setElements,
			rippleEditingEnabled,
			attachments,
			autoAttach,
			fps,
			tracks,
			trackLockedMap,
		],
	);

	// 移动元素及其附属元素（用于拖拽结束，处理层叠关联）
	const moveWithAttachments = useCallback(
		(
			elementId: string,
			start: number,
			end: number,
			dropTarget: DropTarget,
			attachedChildren: { id: string; start: number; end: number }[],
		) => {
			setElements((prev) => {
				const unlockedChildren = attachedChildren.filter((childMove) => {
					const child = prev.find((el) => el.id === childMove.id);
					if (!child) return false;
					const childTrackIndex = child.timeline.trackIndex ?? 0;
					return !trackLockedMap.get(childTrackIndex);
				});
				// 计算当前的轨道分配
				const currentAssignments = getStoredTrackAssignments(prev);
				const originalElement = prev.find((el) => el.id === elementId);
				const elementRole = originalElement
					? getElementRole(originalElement)
					: "overlay";
				const resolvedDropTarget = resolveDropTargetForRole(
					dropTarget,
					elementRole,
					prev,
					currentAssignments,
				);
				const { finalTrack, updatedAssignments } =
					resolveTrackPlacementWithStoredAssignments({
						entries: prev,
						elementId,
						start,
						end,
						role: elementRole,
						dropTarget: resolvedDropTarget,
						assignments: currentAssignments,
						originalTrack: originalElement?.timeline.trackIndex ?? 0,
						resolveRole: resolveTimelineElementRole,
					});

				const targetTrackId = tracks[finalTrack]?.id;

				// 第一步：更新主元素的时间和轨道
				let updated = prev.map((el) => {
					if (el.id === elementId) {
						const updatedElement = updateElementTime(el, start, end, fps);
						return {
							...updatedElement,
							timeline: {
								...updatedElement.timeline,
								trackIndex: finalTrack,
								...(targetTrackId ? { trackId: targetTrackId } : {}),
							},
						};
					}
					// 应用可能的轨道移动（插入模式时其他元素的轨道会变化）
					const newTrack = updatedAssignments.get(el.id);
					if (newTrack !== undefined && newTrack !== el.timeline.trackIndex) {
						return {
							...el,
							timeline: {
								...el.timeline,
								trackIndex: newTrack,
							},
						};
					}
					return el;
				});

				// 第二步：更新附属元素的时间（保持原轨道）
				const movedChildren = new Map(
					unlockedChildren.map((child) => [
						child.id,
						{
							start: child.start,
							end: child.end,
						},
					]),
				);
				updated = updated.map((el) => {
					const childMove = movedChildren.get(el.id);
					if (childMove) {
						return updateElementTime(el, childMove.start, childMove.end, fps);
					}
					return el;
				});

				// 第三步：为附属元素重新计算轨道位置（处理重叠）
				updated = resolveMovedChildrenTracks(updated, movedChildren, {
					resolveRole: resolveTimelineElementRole,
				});

				const finalized = finalizeTimelineElements(updated, {
					rippleEditingEnabled,
					attachments,
					autoAttach,
					fps,
					trackLockedMap,
				});
				return finalized;
			});
		},
		[
			setElements,
			rippleEditingEnabled,
			attachments,
			autoAttach,
			fps,
			tracks,
			trackLockedMap,
		],
	);

	return {
		trackAssignments,
		trackCount,
		updateElementTrack,
		updateElementTimeAndTrack,
		moveWithAttachments,
		getYFromTrack,
		getTrackFromY,
		getDropTarget,
	};
};

export const useAttachments = () => {
	const elements = useTimelineStore((state) => state.elements);
	const autoAttach = useTimelineStore((state) => state.autoAttach);
	const setAutoAttach = useTimelineStore((state) => state.setAutoAttach);

	// 基于 elements 计算关联关系
	const attachments = useMemo(() => {
		return findAttachments(elements);
	}, [elements]);

	return {
		attachments,
		autoAttach,
		setAutoAttach,
	};
};

// ============================================================================
// 多选支持 (Multi-select)
// ============================================================================
/**
 * 多选 Hook - 统一 Timeline/Preview 的选择状态
 *
 * 相关类型已在 timeline/types.ts 中定义：
 * - SelectionState: 完整的选择状态结构
 * - SelectionAction: 选择操作类型
 * - DragState: 支持 draggedElementIds 数组
 */
export const useMultiSelect = () => {
	const selectedIds = useTimelineStore((state) => state.selectedIds);
	const primaryId = useTimelineStore((state) => state.primarySelectedId);
	const setSelectedIds = useTimelineStore((state) => state.setSelectedIds);
	const elements = useTimelineStore((state) => state.elements);

	// 获取选中的元素列表
	const selectedElements = useMemo(() => {
		return elements.filter((el) => selectedIds.includes(el.id));
	}, [elements, selectedIds]);

	// 选择单个元素（未来可扩展为 additive 模式）
	const select = useCallback(
		(id: string, additive = false) => {
			if (additive) {
				setSelectedIds([...selectedIds, id], id);
				return;
			}
			setSelectedIds([id], id);
		},
		[setSelectedIds, selectedIds],
	);

	// 取消选择
	const deselect = useCallback(
		(id: string) => {
			setSelectedIds(
				selectedIds.filter((selectedId) => selectedId !== id),
				primaryId === id ? null : primaryId,
			);
		},
		[primaryId, selectedIds, setSelectedIds],
	);

	// 清空选择
	const deselectAll = useCallback(() => {
		setSelectedIds([], null);
	}, [setSelectedIds]);

	// 切换选择状态
	const toggleSelect = useCallback(
		(id: string) => {
			if (selectedIds.includes(id)) {
				setSelectedIds(
					selectedIds.filter((selectedId) => selectedId !== id),
					primaryId === id ? null : primaryId,
				);
				return;
			}
			setSelectedIds([...selectedIds, id], id);
		},
		[primaryId, selectedIds, setSelectedIds],
	);

	const setSelection = useCallback(
		(ids: string[], nextPrimaryId?: string | null) => {
			setSelectedIds(ids, nextPrimaryId);
		},
		[setSelectedIds],
	);

	return {
		selectedIds,
		selectedElements,
		primaryId,
		select,
		deselect,
		deselectAll,
		toggleSelect,
		setSelection,
		// 框选相关（预留）
		isMarqueeSelecting: false,
		marqueeRect: null as {
			startX: number;
			startY: number;
			endX: number;
			endY: number;
		} | null,
	};
};

export const TimelineContext = createContext<{
	currentTime: number;
	setCurrentTime: (time: number) => void;
}>({
	currentTime: 0,
	setCurrentTime: () => {},
});

export const TimelineProvider = ({
	children,
	currentTime: initialCurrentTime,
	elements: initialElements,
	assets: initialSources,
	tracks: initialTracks,
	canvasSize: initialCanvasSize,
	fps: initialFps,
	settings: initialSettings,
}: {
	children: React.ReactNode;
	currentTime?: number;
	elements?: TimelineElement[];
	assets?: TimelineAsset[];
	tracks?: TimelineTrack[];
	canvasSize?: { width: number; height: number };
	fps?: number;
	settings?: TimelineSettings;
}) => {
	const timelineStore = useTimelineStoreApi();
	const clockModeRef = useRef<"audio" | "perf" | null>(null);
	const clockStartFrameRef = useRef(0);
	const audioStartTimeRef = useRef<number | null>(null);
	const perfStartTimeRef = useRef<number | null>(null);
	const seekEpochRef = useRef<number | null>(null);
	const settingsState = initialSettings
		? {
				snapEnabled: initialSettings.snapEnabled,
				autoAttach: initialSettings.autoAttach,
				rippleEditingEnabled: initialSettings.rippleEditingEnabled,
				previewAxisEnabled: initialSettings.previewAxisEnabled,
				audioSettings: cloneAudioSettings(initialSettings.audio),
			}
		: null;

	// 在首次渲染前同步设置初始状态
	// 使用 useLayoutEffect 确保在子组件渲染前执行
	// biome-ignore lint/correctness/useExhaustiveDependencies: 初始化仅执行一次，后续更新由下方 useEffect 处理。
	useLayoutEffect(() => {
		if (initialElements) {
			const baseTracks = initialTracks ?? timelineStore.getState().tracks;
			const { tracks, elements } = reconcileTracks(initialElements, baseTracks);
			timelineStore.setState({
				currentTime: clampFrame(initialCurrentTime ?? 0),
				elements,
				assets: initialSources ?? [],
				tracks,
				audioTrackStates: {},
				scrollLeft: 0,
				canvasSize: initialCanvasSize ?? { width: 1920, height: 1080 },
				fps: normalizeFps(initialFps ?? DEFAULT_FPS),
				...(settingsState ?? {}),
			});
			timelineStore.getState().resetHistory();
			return;
		}
		if (initialTracks) {
			timelineStore.setState({
				tracks: initialTracks,
				...(initialSources ? { assets: initialSources } : {}),
				audioTrackStates: {},
				scrollLeft: 0,
				...(settingsState ?? {}),
			});
			timelineStore.getState().resetHistory();
			return;
		}
		if (settingsState) {
			timelineStore.setState({
				...(initialSources ? { assets: initialSources } : {}),
				scrollLeft: 0,
				...settingsState,
			});
		}
	}, []);

	// 后续更新
	useEffect(() => {
		if (initialElements) {
			const baseTracks = initialTracks ?? timelineStore.getState().tracks;
			const { tracks, elements } = reconcileTracks(initialElements, baseTracks);
			timelineStore.setState({
				elements,
				assets: initialSources ?? [],
				tracks,
				audioTrackStates: {},
				scrollLeft: 0,
			});
			timelineStore.getState().resetHistory();
		}
	}, [initialElements, initialSources, initialTracks, timelineStore]);

	useEffect(() => {
		if (!initialElements && initialTracks) {
			timelineStore.setState({
				tracks: initialTracks,
				...(initialSources ? { assets: initialSources } : {}),
				audioTrackStates: {},
				scrollLeft: 0,
			});
			timelineStore.getState().resetHistory();
		}
	}, [initialElements, initialSources, initialTracks, timelineStore]);

	useEffect(() => {
		if (initialCurrentTime !== undefined) {
			timelineStore.setState({
				currentTime: clampFrame(initialCurrentTime),
			});
		}
	}, [initialCurrentTime, timelineStore]);

	useEffect(() => {
		if (initialCanvasSize !== undefined) {
			timelineStore.setState({
				canvasSize: initialCanvasSize,
			});
		}
	}, [initialCanvasSize, timelineStore]);

	useEffect(() => {
		if (initialFps !== undefined) {
			timelineStore.setState({
				fps: normalizeFps(initialFps),
			});
		}
	}, [initialFps, timelineStore]);

	const elements = useTimelineStore((state) => state.elements);
	const tracks = useTimelineStore((state) => state.tracks);
	const audioTrackStates = useTimelineStore((state) => state.audioTrackStates);

	useEffect(() => {
		const result = reconcileTracks(elements, tracks);
		const nextAudioTrackStates = pruneAudioTrackStates(
			result.elements,
			audioTrackStates,
		);
		const didChangeAudioTrackStates = nextAudioTrackStates !== audioTrackStates;
		if (
			result.didChangeElements ||
			result.didChangeTracks ||
			didChangeAudioTrackStates
		) {
			timelineStore.setState({
				elements: result.elements,
				tracks: result.tracks,
				...(didChangeAudioTrackStates
					? { audioTrackStates: nextAudioTrackStates }
					: {}),
			});
		}
	}, [elements, tracks, audioTrackStates, timelineStore]);

	// 播放循环
	useEffect(() => {
		const unsubscribe = timelineStore.subscribe(
			(state) => state.isPlaying,
			(isPlaying) => {
				if (isPlaying) {
					const resetAudioClock = (
						state: TimelineStore,
						context: AudioContext,
					) => {
						clockModeRef.current = "audio";
						clockStartFrameRef.current = state.currentTime;
						audioStartTimeRef.current = context.currentTime;
						perfStartTimeRef.current = null;
					};
					const resetPerfClock = (state: TimelineStore, now: number) => {
						clockModeRef.current = "perf";
						clockStartFrameRef.current = state.currentTime;
						perfStartTimeRef.current = now;
						audioStartTimeRef.current = null;
					};
					const animate = (now: number) => {
						const state = timelineStore.getState();
						if (!state.isPlaying) return;
						const timelineEndFrame = resolveTimelineEndFrame(state.elements);
						if (state.currentTime >= timelineEndFrame) {
							if (state.currentTime !== timelineEndFrame) {
								state.setCurrentTime(timelineEndFrame);
							}
							state.pause();
							return;
						}

						const context = getAudioContext();
						// 用户主动 seek 时重置时钟基准，避免被播放循环覆盖
						if (seekEpochRef.current === null) {
							seekEpochRef.current = state.seekEpoch;
						}
						if (seekEpochRef.current !== state.seekEpoch) {
							seekEpochRef.current = state.seekEpoch;
							if (context && context.state === "running") {
								resetAudioClock(state, context);
							} else {
								resetPerfClock(state, now);
							}
							requestAnimationFrame(animate);
							return;
						}

						if (context && context.state === "running") {
							if (
								clockModeRef.current !== "audio" ||
								audioStartTimeRef.current === null
							) {
								resetAudioClock(state, context);
							}
							if (audioStartTimeRef.current !== null) {
								const elapsed = context.currentTime - audioStartTimeRef.current;
								const nextTime = clampFrame(
									clockStartFrameRef.current + elapsed * state.fps,
								);
								if (nextTime >= timelineEndFrame) {
									state.setCurrentTime(timelineEndFrame);
									state.pause();
									return;
								}
								if (nextTime !== state.currentTime) {
									state.setCurrentTime(nextTime);
								}
							}
						} else {
							if (
								clockModeRef.current !== "perf" ||
								perfStartTimeRef.current === null
							) {
								resetPerfClock(state, now);
							}
							if (perfStartTimeRef.current !== null) {
								const elapsed = (now - perfStartTimeRef.current) / 1000;
								const nextTime = clampFrame(
									clockStartFrameRef.current + elapsed * state.fps,
								);
								if (nextTime >= timelineEndFrame) {
									state.setCurrentTime(timelineEndFrame);
									state.pause();
									return;
								}
								if (nextTime !== state.currentTime) {
									state.setCurrentTime(nextTime);
								}
							}
						}

						requestAnimationFrame(animate);
					};
					requestAnimationFrame(animate);
				} else {
					clockModeRef.current = null;
					audioStartTimeRef.current = null;
					perfStartTimeRef.current = null;
					seekEpochRef.current = null;
				}
			},
			{ fireImmediately: true },
		);

		return () => unsubscribe();
	}, [timelineStore]);

	return <>{children}</>;
};
