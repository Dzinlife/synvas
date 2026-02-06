import {
	createContext,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { TimelineElement, TrackRole } from "@/dsl/types";
import { clampFrame } from "@/utils/timecode";
import type {
	DropTarget,
	ExtendedDropTarget,
	TimelineTrack,
} from "../timeline/types";
import { findAttachments } from "../utils/attachments";
import { finalizeTimelineElements } from "../utils/mainTrackMagnet";
import type { SnapPoint } from "../utils/snap";
import { updateElementTime } from "../utils/timelineTime";
import { MAIN_TRACK_ID, reconcileTracks } from "../utils/trackState";
import { getAudioContext } from "../audio/audioEngine";
import {
	findAvailableTrack,
	getDropTarget,
	getElementRole,
	getTrackFromY,
	getYFromTrack,
	hasOverlapOnStoredTrack,
	hasRoleConflictOnStoredTrack,
	insertTrackAt,
	MAIN_TRACK_INDEX,
	getStoredTrackAssignments,
	resolveDropTargetForRole,
} from "../utils/trackAssignment";
import type { TimelineSettings } from "../timelineLoader";

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
const normalizeFps = (value: number): number => {
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_FPS;
	return Math.round(value);
};

interface TimelineStore {
	fps: number;
	timelineScale: number;
	currentTime: number;
	previewTime: number | null; // hover 时的临时预览时间
	previewAxisEnabled: boolean; // 预览轴是否启用
	elements: TimelineElement[];
	tracks: TimelineTrack[];
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
	// 拖拽目标指示状态
	activeDropTarget: ExtendedDropTarget | null;
	// 拖拽 Ghost 状态
	dragGhosts: DragGhostState[];
	// 自动滚动状态
	autoScrollSpeed: number; // -1 到 1，负数向左，正数向右，0 停止
	autoScrollSpeedY: number; // 垂直滚动速度，负数向上，正数向下
	// 时间线滚动位置
	scrollLeft: number;
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
	setCanvasSize: (size: { width: number; height: number }) => void;
	getCurrentTime: () => number;
	getDisplayTime: () => number; // 返回 previewTime ?? currentTime
	getElements: () => TimelineElement[];
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
	// 拖拽目标指示方法
	setActiveDropTarget: (target: ExtendedDropTarget | null) => void;
	// 拖拽 Ghost 方法
	setDragGhosts: (ghosts: DragGhostState[]) => void;
	// 自动滚动方法
	setAutoScrollSpeed: (speed: number) => void;
	setAutoScrollSpeedY: (speed: number) => void;
	// 滚动位置方法
	setScrollLeft: (scrollLeft: number) => void;
	setTimelineScale: (scale: number) => void;
	getElementById: (id: string) => TimelineElement | null;
}

interface TimelineHistorySnapshot {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	rippleEditingEnabled: boolean;
}

const HISTORY_LIMIT = 100;

// 元素索引缓存，避免频繁遍历
let elementIndexById = new Map<string, TimelineElement>();

const buildElementIndex = (
	elements: TimelineElement[],
): Map<string, TimelineElement> => {
	const nextIndex = new Map<string, TimelineElement>();
	for (const element of elements) {
		nextIndex.set(element.id, element);
	}
	return nextIndex;
};

const syncElementIndex = (elements: TimelineElement[]) => {
	elementIndexById = buildElementIndex(elements);
};

const trimHistory = (
	history: TimelineHistorySnapshot[],
	limit: number,
): TimelineHistorySnapshot[] => {
	if (history.length <= limit) return history;
	return history.slice(history.length - limit);
};

const buildHistorySnapshot = (state: {
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	rippleEditingEnabled: boolean;
}): TimelineHistorySnapshot => {
	// 使用不可变快照复用元素/轨道引用，避免深拷贝占用内存
	return {
		elements: state.elements,
		tracks: state.tracks,
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
			: nextSelected[nextSelected.length - 1] ?? null;
	return { selectedIds: nextSelected, primarySelectedId: nextPrimary };
};

interface TrackPlacementResult {
	finalTrack: number;
	updatedAssignments: Map<string, number>;
}

const buildTimedEntries = (
	entries: TimelineElement[],
	elementId: string,
	start: number,
	end: number,
): TimelineElement[] =>
	entries.map((el) => {
		if (el.id !== elementId) return el;
		return {
			...el,
			timeline: { ...el.timeline, start, end },
		};
	});

const resolveAudioDropResult = (
	entries: TimelineElement[],
	elementId: string,
	start: number,
	end: number,
	dropTarget: DropTarget,
	assignments: Map<string, number>,
): TrackPlacementResult => {
	const targetTrack =
		dropTarget.trackIndex < MAIN_TRACK_INDEX ? dropTarget.trackIndex : -1;
	const hasConflict = (trackIndex: number) =>
		hasRoleConflictOnStoredTrack("audio", trackIndex, entries, elementId) ||
		hasOverlapOnStoredTrack(start, end, trackIndex, entries, elementId);

	if (dropTarget.type === "gap") {
		return {
			finalTrack: targetTrack,
			updatedAssignments: insertTrackAt(targetTrack, assignments),
		};
	}

	if (!hasConflict(targetTrack)) {
		return {
			finalTrack: targetTrack,
			updatedAssignments: assignments,
		};
	}

	return {
		finalTrack: targetTrack,
		updatedAssignments: insertTrackAt(targetTrack, assignments),
	};
};

const resolveTrackPlacementWithStoredAssignments = (args: {
	entries: TimelineElement[];
	elementId: string;
	start: number;
	end: number;
	role: TrackRole;
	dropTarget: DropTarget;
	assignments: Map<string, number>;
	originalTrack: number;
}): TrackPlacementResult => {
	const {
		entries,
		elementId,
		start,
		end,
		role,
		dropTarget,
		assignments,
		originalTrack,
	} = args;
	if (role === "audio") {
		return resolveAudioDropResult(
			entries,
			elementId,
			start,
			end,
			dropTarget,
			assignments,
		);
	}

	const timedEntries = buildTimedEntries(entries, elementId, start, end);
	const maxStoredTrack = Math.max(
		0,
		...timedEntries.map((el) => el.timeline.trackIndex ?? 0),
	);
	const hasTrackConflict = (trackIndex: number) =>
		hasRoleConflictOnStoredTrack(role, trackIndex, timedEntries, elementId) ||
		hasOverlapOnStoredTrack(start, end, trackIndex, timedEntries, elementId);

	if (dropTarget.type === "gap") {
		const gapTrackIndex = dropTarget.trackIndex;
		const belowTrack = gapTrackIndex - 1;
		const aboveTrack = gapTrackIndex;
		const belowIsDestination =
			belowTrack >= 0 &&
			belowTrack !== originalTrack &&
			!hasTrackConflict(belowTrack);
		const aboveIsDestination =
			aboveTrack <= maxStoredTrack &&
			aboveTrack !== originalTrack &&
			!hasTrackConflict(aboveTrack);

		if (belowIsDestination) {
			return {
				finalTrack: belowTrack,
				updatedAssignments: assignments,
			};
		}
		if (aboveIsDestination) {
			return {
				finalTrack: aboveTrack,
				updatedAssignments: assignments,
			};
		}
		return {
			finalTrack: gapTrackIndex,
			updatedAssignments: insertTrackAt(gapTrackIndex, assignments),
		};
	}

	const targetTrack = dropTarget.trackIndex;
	if (!hasTrackConflict(targetTrack)) {
		return {
			finalTrack: targetTrack,
			updatedAssignments: assignments,
		};
	}

	const aboveTrack = targetTrack + 1;
	if (aboveTrack <= maxStoredTrack && !hasTrackConflict(aboveTrack)) {
		return {
			finalTrack: aboveTrack,
			updatedAssignments: assignments,
		};
	}

	return {
		finalTrack: targetTrack + 1,
		updatedAssignments: insertTrackAt(targetTrack + 1, assignments),
	};
};

export const useTimelineStore = create<TimelineStore>()(
	subscribeWithSelector((set, get) => ({
		fps: DEFAULT_FPS,
		timelineScale: 1,
		currentTime: 0,
		previewTime: null,
		previewAxisEnabled: true,
		elements: [],
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
		// 拖拽目标指示状态初始值
		activeDropTarget: null,
		// 拖拽 Ghost 状态初始值
		dragGhosts: [],
		// 自动滚动状态初始值
		autoScrollSpeed: 0,
		autoScrollSpeedY: 0,
		// 滚动位置初始值
		scrollLeft: 0,
		getElementById: (id: string) => elementIndexById.get(id) ?? null,

		setFps: (fps: number) => {
			set({ fps: normalizeFps(fps) });
		},

		setTimelineScale: (scale: number) => {
			const nextScale = Number.isFinite(scale) ? scale : 1;
			set({ timelineScale: nextScale });
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
					return { elements: nextElements };
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
				if (state.historyPast.length === 0) return state;
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
					tracks: previous.tracks,
					rippleEditingEnabled: previous.rippleEditingEnabled,
					historyPast: nextPast,
					historyFuture: nextFuture,
					selectedIds: selection.selectedIds,
					primarySelectedId: selection.primarySelectedId,
				};
			});
		},

		redo: () => {
			set((state) => {
				if (state.historyFuture.length === 0) return state;
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
					tracks: next.tracks,
					rippleEditingEnabled: next.rippleEditingEnabled,
					historyPast: nextPast,
					historyFuture: nextFuture,
					selectedIds: selection.selectedIds,
					primarySelectedId: selection.primarySelectedId,
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

		setCanvasSize: (size: { width: number; height: number }) => {
			set({ canvasSize: size });
		},

		getCurrentTime: () => {
			return get().currentTime;
		},

		getDisplayTime: () => {
			const { previewTime, currentTime, previewAxisEnabled } = get();
			return previewAxisEnabled ? previewTime ?? currentTime : currentTime;
		},

		getElements: () => {
			return get().elements;
		},

		getCanvasSize: () => {
			return get().canvasSize;
		},

		play: () => {
			set((state) => {
				if (state.isPlaying) return state;
				if (state.previewTime === null) {
					return { isPlaying: true };
				}
				return {
					isPlaying: true,
					previewTime: null, // 开始播放时清空预览时间，确保画面跟随播放
				};
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
				if (state.previewTime === null) {
					return { isPlaying: true };
				}
				return {
					isPlaying: true,
					previewTime: null, // 启动播放时移除 hover 预览状态
				};
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
			set({ scrollLeft });
		},
	})),
);

syncElementIndex(useTimelineStore.getState().elements);
useTimelineStore.subscribe((state) => state.elements, (elements) => {
	syncElementIndex(elements);
});

// 渲染时间：导出时使用导出帧，否则跟随预览/播放
const resolveRenderTime = (state: TimelineStore): number => {
	if (state.isExporting && state.exportTime !== null) return state.exportTime;
	if (state.isPlaying) return state.currentTime;
	return state.previewTime ?? state.currentTime;
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
		currentTime: previewAxisEnabled ? previewTime ?? currentTime : currentTime,
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
	return previewAxisEnabled ? previewTime ?? currentTime : currentTime;
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

	return {
		tracks,
		setTracks,
		setTrackHidden,
		toggleTrackHidden,
		setTrackLocked,
		toggleTrackLocked,
		setTrackMuted,
		toggleTrackMuted,
		setTrackSolo,
		toggleTrackSolo,
	};
};

export const useTrackAssignments = () => {
	const elements = useTimelineStore((state) => state.elements);
	const setElements = useTimelineStore((state) => state.setElements);
	const tracks = useTimelineStore((state) => state.tracks);
	const fps = useTimelineStore((state) => state.fps);
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);
	const { attachments, autoAttach } = useAttachments();
	const trackLockedMap = useMemo(() => {
		return new Map(
			tracks.map((track, index) => [index, track.locked ?? false]),
		);
	}, [tracks]);

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
				updated = updated.map((el) => {
					const childMove = unlockedChildren.find((c) => c.id === el.id);
					if (childMove) {
						return updateElementTime(el, childMove.start, childMove.end, fps);
					}
					return el;
				});

				// 第三步：为附属元素重新计算轨道位置（处理重叠）
				// 按照原轨道顺序逐个处理，如果有重叠则向上查找
				for (const childMove of unlockedChildren) {
					const child = updated.find((el) => el.id === childMove.id);
					if (!child) continue;

					const childRole = getElementRole(child);
					const currentTrack =
						child.timeline.trackIndex ?? (childRole === "audio" ? -1 : 1);
					let availableTrack = currentTrack;
					// 基于存储轨道判断，避免 assignTracks 提前重排掩盖重叠
					if (childRole === "audio") {
						const minStoredTrack = Math.min(
							-1,
							...updated.map((el) => el.timeline.trackIndex ?? 0),
						);
						for (
							let track = currentTrack;
							track >= minStoredTrack - 1;
							track--
						) {
							if (
								hasRoleConflictOnStoredTrack(
									childRole,
									track,
									updated,
									childMove.id,
								)
							) {
								continue;
							}
							if (
								!hasOverlapOnStoredTrack(
									childMove.start,
									childMove.end,
									track,
									updated,
									childMove.id,
								)
							) {
								availableTrack = track;
								break;
							}
						}
					} else {
						const maxStoredTrack = Math.max(
							0,
							...updated.map((el) => el.timeline.trackIndex ?? 0),
						);
						for (
							let track = currentTrack;
							track <= maxStoredTrack + 1;
							track++
						) {
							if (
								hasRoleConflictOnStoredTrack(
									childRole,
									track,
									updated,
									childMove.id,
								)
							) {
								continue;
							}
							if (
								!hasOverlapOnStoredTrack(
									childMove.start,
									childMove.end,
									track,
									updated,
									childMove.id,
								)
							) {
								availableTrack = track;
								break;
							}
						}
					}

					// 如果需要移动到新轨道
					if (availableTrack !== currentTrack) {
						updated = updated.map((el) => {
							if (el.id === childMove.id) {
								return {
									...el,
									timeline: {
										...el.timeline,
										trackIndex: availableTrack,
									},
								};
							}
							return el;
						});
					}
				}

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
	tracks: initialTracks,
	canvasSize: initialCanvasSize,
	fps: initialFps,
	settings: initialSettings,
}: {
	children: React.ReactNode;
	currentTime?: number;
	elements?: TimelineElement[];
	tracks?: TimelineTrack[];
	canvasSize?: { width: number; height: number };
	fps?: number;
	settings?: TimelineSettings;
}) => {
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
			}
		: null;

	// 在首次渲染前同步设置初始状态
	// 使用 useLayoutEffect 确保在子组件渲染前执行
	useLayoutEffect(() => {
		if (initialElements) {
			const baseTracks =
				initialTracks ?? useTimelineStore.getState().tracks;
			const { tracks, elements } = reconcileTracks(
				initialElements,
				baseTracks,
			);
			useTimelineStore.setState({
				currentTime: clampFrame(initialCurrentTime ?? 0),
				elements,
				tracks,
				canvasSize: initialCanvasSize ?? { width: 1920, height: 1080 },
				fps: normalizeFps(initialFps ?? DEFAULT_FPS),
				...(settingsState ?? {}),
			});
			useTimelineStore.getState().resetHistory();
			return;
		}
		if (initialTracks) {
			useTimelineStore.setState({
				tracks: initialTracks,
				...(settingsState ?? {}),
			});
			useTimelineStore.getState().resetHistory();
			return;
		}
		if (settingsState) {
			useTimelineStore.setState(settingsState);
		}
	}, []);

	// 后续更新
	useEffect(() => {
		if (initialElements) {
			const baseTracks =
				initialTracks ?? useTimelineStore.getState().tracks;
			const { tracks, elements } = reconcileTracks(
				initialElements,
				baseTracks,
			);
			useTimelineStore.setState({
				elements,
				tracks,
			});
			useTimelineStore.getState().resetHistory();
		}
	}, [initialElements, initialTracks]);

	useEffect(() => {
		if (!initialElements && initialTracks) {
			useTimelineStore.setState({
				tracks: initialTracks,
			});
			useTimelineStore.getState().resetHistory();
		}
	}, [initialElements, initialTracks]);

	useEffect(() => {
		if (initialCurrentTime !== undefined) {
			useTimelineStore.setState({
				currentTime: clampFrame(initialCurrentTime),
			});
		}
	}, [initialCurrentTime]);

	useEffect(() => {
		if (initialCanvasSize !== undefined) {
			useTimelineStore.setState({
				canvasSize: initialCanvasSize,
			});
		}
	}, [initialCanvasSize]);

	useEffect(() => {
		if (initialFps !== undefined) {
			useTimelineStore.setState({
				fps: normalizeFps(initialFps),
			});
		}
	}, [initialFps]);

	const elements = useTimelineStore((state) => state.elements);
	const tracks = useTimelineStore((state) => state.tracks);

	useEffect(() => {
		const result = reconcileTracks(elements, tracks);
		if (result.didChangeElements || result.didChangeTracks) {
			useTimelineStore.setState({
				elements: result.elements,
				tracks: result.tracks,
			});
		}
	}, [elements, tracks]);

	// 播放循环
	useEffect(() => {
		const unsubscribe = useTimelineStore.subscribe(
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
						const state = useTimelineStore.getState();
						if (!state.isPlaying) return;

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
								state.setCurrentTime(nextTime);
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
								state.setCurrentTime(nextTime);
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
	}, []);

	return <>{children}</>;
};
