import { resolveTimelineEndFrame } from "core/editor/utils/timelineEndFrame";
import type { TimelineElement } from "core/element/types";
import type { CanvasNode, SceneDocument, SceneNode } from "core/studio/types";
import type React from "react";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { writeAudioToOpfs } from "@/asr/opfsAudio";
import { createTransformMeta } from "@/element/transform";
import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";
import { useProjectStore } from "@/projects/projectStore";
import type { TimelineContextMenuAction } from "@/scene-editor/components/TimelineContextMenu";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { findAttachments } from "@/scene-editor/utils/attachments";
import { resolveExternalVideoUri } from "@/scene-editor/utils/externalVideo";
import { finalizeTimelineElements } from "@/scene-editor/utils/mainTrackMagnet";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { CANVAS_NODE_DRAWER_DEFAULT_HEIGHT } from "@/studio/canvas/CanvasNodeDrawerShell";
import { isCanvasNodeFocusable } from "@/studio/canvas/node-system/focus";
import {
	canvasNodeDefinitionList,
	getCanvasNodeDefinition,
} from "@/studio/canvas/node-system/registry";
import type {
	CanvasNodeDrawerProps,
	CanvasNodeDrawerTrigger,
	CanvasNodeResizeConstraints,
} from "@/studio/canvas/node-system/types";
import type { CanvasSidebarTab } from "@/studio/canvas/sidebar/CanvasSidebar";
import {
	type CanvasNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { wouldCreateSceneCompositionCycle } from "@/studio/scene/sceneComposition";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { secondsToFrames } from "@/utils/timecode";
import CanvasWorkspaceOverlay, {
	type DrawerViewData,
} from "./CanvasWorkspaceOverlay";
import {
	collectCanvasSnapGuideValues,
	EMPTY_CANVAS_SNAP_GUIDES_SCREEN,
	projectCanvasSnapGuidesToScreen,
	resolveCanvasRectSnap,
	resolveCanvasSnapThresholdWorld,
	type CanvasSnapGuideValues,
	type CanvasSnapGuidesScreen,
	type CanvasSnapGuidesWorld,
	type CanvasSnapRect,
} from "./canvasSnapUtils";
import {
	CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
	CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
	resolveCanvasOverlayLayout,
} from "./canvasOverlayLayout";
import {
	buildNodeFitCamera,
	buildNodePanCamera,
	CAMERA_ZOOM_EPSILON,
	type CameraState,
	clampZoom,
	DEFAULT_CAMERA,
	DROP_GRID_COLUMNS,
	DROP_GRID_OFFSET_X,
	DROP_GRID_OFFSET_Y,
	isCameraAlmostEqual,
	isCanvasSurfaceTarget,
	isLayoutEqual,
	isOverlayWheelTarget,
	isWorldPointInBounds,
	isWorldPointInNode,
	pickLayout,
	resolveCanvasNodeBounds,
	type ResolvedCanvasDrawerOptions,
	resolveDrawerOptions,
	resolveDroppedFiles,
	resolveExternalFileUri,
	SIDEBAR_VIEW_PADDING_PX,
	toTimelineContextMenuActions,
} from "./canvasWorkspaceUtils";
import type {
	CanvasNodeDragEvent,
	CanvasNodePointerEvent,
	CanvasNodeResizeAnchor,
	CanvasNodeResizeEvent,
	CanvasSelectionResizeEvent,
} from "./InfiniteSkiaCanvas";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import {
	resolveCanvasResizeAnchorAtRectWorldPoint,
	resolveCanvasResizeAnchorAtWorldPoint,
} from "./canvasResizeAnchor";
import { useCanvasCameraController } from "./useCanvasCameraController";

type CanvasContextMenuState =
	| { open: false }
	| {
			open: true;
			scope: "canvas";
			x: number;
			y: number;
			worldX: number;
			worldY: number;
	  }
	| {
			open: true;
			scope: "node";
			x: number;
			y: number;
			actions: TimelineContextMenuAction[];
	  };

interface NodeDragSession {
	origin: "node" | "selection";
	anchorNodeId: string | null;
	pendingSelectedNodeIds: string[];
	dragNodeIds: string[];
	initialBounds: CanvasSnapRect;
	snapshots: Record<
		string,
		{
			nodeId: string;
			startNodeX: number;
			startNodeY: number;
			before: CanvasNodeLayoutSnapshot;
		}
	>;
	copyEntries: CanvasGraphHistoryEntry[];
	activated: boolean;
	moved: boolean;
	axisLock: "x" | "y" | null;
	copyMode: boolean;
}

interface CanvasMarqueeRect {
	visible: boolean;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

interface CanvasMarqueeSession {
	additive: boolean;
	initialSelectedNodeIds: string[];
	startLocalX: number;
	startLocalY: number;
	activated: boolean;
}

interface ResolvedCanvasNodeResizeConstraints {
	lockAspectRatio: boolean;
	aspectRatio: number | null;
	minWidth: number | null;
	minHeight: number | null;
	maxWidth: number | null;
	maxHeight: number | null;
}

interface NodeResizeSession {
	nodeId: string;
	anchor: CanvasNodeResizeAnchor;
	startNodeX: number;
	startNodeY: number;
	startNodeWidth: number;
	startNodeHeight: number;
	fixedCornerX: number;
	fixedCornerY: number;
	before: CanvasNodeLayoutSnapshot;
	moved: boolean;
	constraints: ResolvedCanvasNodeResizeConstraints;
}

interface SelectionResizeSnapshot {
	nodeId: string;
	startNodeX: number;
	startNodeY: number;
	startNodeWidth: number;
	startNodeHeight: number;
	before: CanvasNodeLayoutSnapshot;
	constraints: ResolvedCanvasNodeResizeConstraints;
}

interface SelectionResizeSession {
	anchor: CanvasNodeResizeAnchor;
	startBoundsLeft: number;
	startBoundsTop: number;
	startBoundsWidth: number;
	startBoundsHeight: number;
	fixedCornerX: number;
	fixedCornerY: number;
	snapshots: Record<string, SelectionResizeSnapshot>;
	moved: boolean;
}

interface PendingCanvasClickSuppression {
	suppressNode: boolean;
	suppressCanvas: boolean;
}

type CanvasGraphHistoryEntry = {
	node: CanvasNode;
	scene: SceneDocument | undefined;
};

const CANVAS_MARQUEE_ACTIVATION_PX = 3;
const CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX = 6;

const createCanvasEntityId = (prefix: string): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
};

const cloneTimelineJson = <T,>(value: T): T => {
	return JSON.parse(JSON.stringify(value)) as T;
};

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target as HTMLElement | null)?.isContentEditable === true
	);
};

const getPrimarySelectedNodeId = (selectedNodeIds: string[]): string | null => {
	return selectedNodeIds.at(-1) ?? null;
};

const normalizeSelectedNodeIds = (
	selectedNodeIds: string[],
	nodeIdSet: Set<string>,
): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const nodeId of selectedNodeIds) {
		if (!nodeIdSet.has(nodeId) || seen.has(nodeId)) continue;
		seen.add(nodeId);
		result.push(nodeId);
	}
	return result;
};

const toggleSelectedNodeIds = (
	selectedNodeIds: string[],
	nodeId: string,
): string[] => {
	if (selectedNodeIds.includes(nodeId)) {
		return selectedNodeIds.filter((selectedId) => selectedId !== nodeId);
	}
	return [...selectedNodeIds, nodeId];
};

const isNodeIntersectRect = (
	node: CanvasNode,
	rect: { left: number; right: number; top: number; bottom: number },
): boolean => {
	const nodeLeft = Math.min(node.x, node.x + node.width);
	const nodeRight = Math.max(node.x, node.x + node.width);
	const nodeTop = Math.min(node.y, node.y + node.height);
	const nodeBottom = Math.max(node.y, node.y + node.height);
	return (
		rect.left < nodeRight &&
		rect.right > nodeLeft &&
		rect.top < nodeBottom &&
		rect.bottom > nodeTop
	);
};

const resolvePositiveNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	if (value <= 0) return null;
	return value;
};

const clampSize = (
	value: number,
	minValue: number,
	maxValue?: number,
): number => {
	if (!Number.isFinite(value)) return minValue;
	if (!Number.isFinite(minValue)) return value;
	if (maxValue !== undefined && Number.isFinite(maxValue)) {
		if (maxValue < minValue) return minValue;
		return Math.min(Math.max(value, minValue), maxValue);
	}
	return Math.max(value, minValue);
};

const isRightResizeAnchor = (anchor: CanvasNodeResizeAnchor): boolean => {
	return anchor === "top-right" || anchor === "bottom-right";
};

const isBottomResizeAnchor = (anchor: CanvasNodeResizeAnchor): boolean => {
	return anchor === "bottom-left" || anchor === "bottom-right";
};

const applyResizeSnapDeltaToBox = (
	box: CanvasSnapRect,
	anchor: CanvasNodeResizeAnchor,
	deltaX: number,
	deltaY: number,
): CanvasSnapRect => {
	let nextX = box.x;
	let nextY = box.y;
	let nextWidth = box.width;
	let nextHeight = box.height;
	if (deltaX !== 0) {
		if (isRightResizeAnchor(anchor)) {
			nextWidth += deltaX;
		} else {
			nextX += deltaX;
			nextWidth -= deltaX;
		}
	}
	if (deltaY !== 0) {
		if (isBottomResizeAnchor(anchor)) {
			nextHeight += deltaY;
		} else {
			nextY += deltaY;
			nextHeight -= deltaY;
		}
	}
	return {
		x: nextX,
		y: nextY,
		width: Math.max(CAMERA_ZOOM_EPSILON, nextWidth),
		height: Math.max(CAMERA_ZOOM_EPSILON, nextHeight),
	};
};

const selectCornerResizeSnap = ({
	deltaX,
	deltaY,
	guidesWorld,
	preferSingleAxis,
}: {
	deltaX: number;
	deltaY: number;
	guidesWorld: CanvasSnapGuidesWorld;
	preferSingleAxis: boolean;
}) => {
	if (preferSingleAxis && deltaX !== 0 && deltaY !== 0) {
		if (Math.abs(deltaX) <= Math.abs(deltaY)) {
			return {
				deltaX,
				deltaY: 0,
				guidesWorld: {
					vertical: guidesWorld.vertical,
					horizontal: [],
				},
			};
		}
		return {
			deltaX: 0,
			deltaY,
			guidesWorld: {
				vertical: [],
				horizontal: guidesWorld.horizontal,
			},
		};
	}
	return {
		deltaX,
		deltaY,
		guidesWorld,
	};
};

const resolveConstrainedResizeLayout = ({
	anchor,
	fixedCornerX,
	fixedCornerY,
	startWidth,
	startHeight,
	draftWidth,
	draftHeight,
	constraints,
	globalMinSize,
	preferredAxis = null,
}: {
	anchor: CanvasNodeResizeAnchor;
	fixedCornerX: number;
	fixedCornerY: number;
	startWidth: number;
	startHeight: number;
	draftWidth: number;
	draftHeight: number;
	constraints: ResolvedCanvasNodeResizeConstraints;
	globalMinSize: number;
	preferredAxis?: "x" | "y" | null;
}): { x: number; y: number; width: number; height: number } => {
	const isRightAnchor = isRightResizeAnchor(anchor);
	const isBottomAnchor = isBottomResizeAnchor(anchor);
	const minWidth = Math.max(globalMinSize, constraints.minWidth ?? 0);
	const minHeight = Math.max(globalMinSize, constraints.minHeight ?? 0);
	const maxWidth = constraints.maxWidth ?? undefined;
	const maxHeight = constraints.maxHeight ?? undefined;

	let nextWidth: number;
	let nextHeight: number;
	if (constraints.lockAspectRatio && constraints.aspectRatio) {
		const aspectRatio = constraints.aspectRatio;
		const scaleX = draftWidth / Math.max(startWidth, CAMERA_ZOOM_EPSILON);
		const scaleY = draftHeight / Math.max(startHeight, CAMERA_ZOOM_EPSILON);
		let scale =
			preferredAxis === "x"
				? scaleX
				: preferredAxis === "y"
					? scaleY
					: (scaleX + scaleY) / 2;
		if (!Number.isFinite(scale) || scale <= 0) {
			scale = minWidth / Math.max(startWidth, CAMERA_ZOOM_EPSILON);
		}
		const minWidthByHeight = minHeight * aspectRatio;
		const minWidthWithAspect = Math.max(minWidth, minWidthByHeight);
		const maxWidthByHeight =
			maxHeight !== undefined ? maxHeight * aspectRatio : undefined;
		const maxWidthWithAspect =
			maxWidthByHeight !== undefined
				? maxWidth !== undefined
					? Math.min(maxWidth, maxWidthByHeight)
					: maxWidthByHeight
				: maxWidth;
		nextWidth = clampSize(
			startWidth * scale,
			minWidthWithAspect,
			maxWidthWithAspect,
		);
		nextHeight = nextWidth / aspectRatio;
	} else {
		nextWidth = clampSize(draftWidth, minWidth, maxWidth);
		nextHeight = clampSize(draftHeight, minHeight, maxHeight);
	}

	return {
		x: isRightAnchor ? fixedCornerX : fixedCornerX - nextWidth,
		y: isBottomAnchor ? fixedCornerY : fixedCornerY - nextHeight,
		width: nextWidth,
		height: nextHeight,
	};
};

type AnyCanvasDrawer = React.FC<CanvasNodeDrawerProps<CanvasNode>>;

interface ResolvedNodeDrawer extends DrawerViewData {
	trigger: CanvasNodeDrawerTrigger;
}

interface ResolvedNodeDrawerTarget {
	Drawer: AnyCanvasDrawer;
	node: CanvasNode;
	trigger: CanvasNodeDrawerTrigger;
	options: ResolvedCanvasDrawerOptions;
}

const CanvasWorkspace = () => {
	const currentProject = useProjectStore((state) => state.currentProject);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const updateCanvasNodeLayout = useProjectStore(
		(state) => state.updateCanvasNodeLayout,
	);
	const ensureProjectAssetByUri = useProjectStore(
		(state) => state.ensureProjectAssetByUri,
	);
	const updateProjectAssetMeta = useProjectStore(
		(state) => state.updateProjectAssetMeta,
	);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
	);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setActiveNode = useProjectStore((state) => state.setActiveNode);
	const setCanvasCamera = useProjectStore((state) => state.setCanvasCamera);
	const appendCanvasGraphBatch = useProjectStore(
		(state) => state.appendCanvasGraphBatch,
	);
	const removeCanvasGraphBatch = useProjectStore(
		(state) => state.removeCanvasGraphBatch,
	);
	const removeCanvasNodeForHistory = useProjectStore(
		(state) => state.removeCanvasNodeForHistory,
	);
	const removeSceneGraphForHistory = useProjectStore(
		(state) => state.removeSceneGraphForHistory,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (!manager?.getTimelineRuntime || !manager.listTimelineRuntimes) {
			return null;
		}
		return manager as StudioRuntimeManager;
	}, [runtime]);

	const focusedNodeId = currentProject?.ui.focusedNodeId ?? null;
	const activeSceneId = currentProject?.ui.activeSceneId ?? null;
	const activeNodeId = currentProject?.ui.activeNodeId ?? null;
	const canvasSnapEnabled = currentProject?.ui.canvasSnapEnabled ?? true;
	const camera = currentProject?.ui.camera ?? DEFAULT_CAMERA;
	const isCanvasInteractionLocked = Boolean(focusedNodeId);
	const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
	const [visibleDrawerHeight, setVisibleDrawerHeight] = useState(
		CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	);
	const [isCameraAnimating, setIsCameraAnimating] = useState(false);
	const [contextMenuState, setContextMenuState] =
		useState<CanvasContextMenuState>({ open: false });
	const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
	const [marqueeRect, setMarqueeRect] = useState<CanvasMarqueeRect>({
		visible: false,
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 0,
	});
	const [snapGuidesScreen, setSnapGuidesScreen] =
		useState<CanvasSnapGuidesScreen>(EMPTY_CANVAS_SNAP_GUIDES_SCREEN);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const marqueeRectRef = useRef<CanvasMarqueeRect>({
		visible: false,
		x1: 0,
		y1: 0,
		x2: 0,
		y2: 0,
	});
	const preFocusCameraRef = useRef<CameraState | null>(null);
	const prevFocusedNodeIdRef = useRef<string | null>(focusedNodeId);
	const nodeDragSessionRef = useRef<NodeDragSession | null>(null);
	const nodeResizeSessionRef = useRef<NodeResizeSession | null>(null);
	const selectionResizeSessionRef = useRef<SelectionResizeSession | null>(null);
	const marqueeSessionRef = useRef<CanvasMarqueeSession | null>(null);
	const pendingClickSuppressionRef =
		useRef<PendingCanvasClickSuppression | null>(null);
	const { getCamera, applyCamera } = useCanvasCameraController({
		camera,
		onChange: setCanvasCamera,
		onAnimationStateChange: setIsCameraAnimating,
	});

	const sortedNodes = useMemo(() => {
		if (!currentProject) return [];
		return [...currentProject.canvas.nodes]
			.filter((node) => !node.hidden)
			.sort((a, b) => {
				if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
				return a.createdAt - b.createdAt;
			});
	}, [currentProject]);
	const currentNodeIdSet = useMemo(() => {
		return new Set(currentProject?.canvas.nodes.map((node) => node.id) ?? []);
	}, [currentProject]);
	const normalizedSelectedNodeIds = useMemo(() => {
		return normalizeSelectedNodeIds(selectedNodeIds, currentNodeIdSet);
	}, [currentNodeIdSet, selectedNodeIds]);

	const focusedNode = useMemo(() => {
		if (!focusedNodeId) return null;
		return (
			currentProject?.canvas.nodes.find((node) => node.id === focusedNodeId) ??
			null
		);
	}, [currentProject, focusedNodeId]);

	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return (
			currentProject?.canvas.nodes.find((node) => node.id === activeNodeId) ??
			null
		);
	}, [activeNodeId, currentProject]);
	const selectedNodes = useMemo(() => {
		if (!currentProject || normalizedSelectedNodeIds.length === 0) return [];
		return normalizedSelectedNodeIds
			.map(
				(nodeId) =>
					currentProject.canvas.nodes.find((node) => node.id === nodeId) ??
					null,
			)
			.filter((node): node is CanvasNode => Boolean(node));
	}, [currentProject, normalizedSelectedNodeIds]);
	const selectedBounds = useMemo(() => {
		if (selectedNodes.length <= 1) return null;
		return resolveCanvasNodeBounds(selectedNodes);
	}, [selectedNodes]);
	const isSingleSelection = useMemo(() => {
		return (
			Boolean(activeNode) &&
			(selectedNodes.length === 0 ||
				(selectedNodes.length === 1 && selectedNodes[0]?.id === activeNode?.id))
		);
	}, [activeNode, selectedNodes]);

	const contextMenuSceneOptions = useMemo(() => {
		if (!currentProject) return [];
		const toSceneOption = (sceneId: string) => {
			const scene = currentProject.scenes[sceneId];
			if (!scene) return null;
			return {
				sceneId,
				label: scene.name?.trim() ? scene.name : sceneId,
			};
		};
		if (runtimeManager) {
			const runtimeSceneOptions: Array<{ sceneId: string; label: string }> = [];
			const seen = new Set<string>();
			for (const timelineRuntime of runtimeManager.listTimelineRuntimes()) {
				const sceneId = timelineRuntime.ref.sceneId;
				if (seen.has(sceneId)) continue;
				seen.add(sceneId);
				const option = toSceneOption(sceneId);
				if (option) runtimeSceneOptions.push(option);
			}
			if (runtimeSceneOptions.length > 0) {
				return runtimeSceneOptions;
			}
		}
		return Object.keys(currentProject.scenes)
			.map((sceneId) => toSceneOption(sceneId))
			.filter((scene): scene is { sceneId: string; label: string } =>
				Boolean(scene),
			);
	}, [currentProject, runtimeManager]);

	const insertNodeToScene = useCallback(
		(node: CanvasNode, sceneId: string) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const targetScene = latestProject.scenes[sceneId];
			if (!targetScene) return;

			const appendImageElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
			): TimelineElement[] => {
				if (node.type !== "image" || !node.assetId) return elements;
				const start = resolveTimelineEndFrame(elements);
				const duration = Math.max(1, secondsToFrames(5, fps));
				const nextElement: TimelineElement = {
					id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					type: "Image",
					component: "image",
					name: node.name,
					assetId: node.assetId,
					props: {},
					transform: createTransformMeta({
						width: Math.max(1, Math.abs(node.width)),
						height: Math.max(1, Math.abs(node.height)),
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start,
							end: start + duration,
							trackIndex: 0,
							role: "clip",
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
				};
				return finalizeTimelineElements([...elements, nextElement], {
					rippleEditingEnabled,
					attachments: autoAttach ? findAttachments(elements) : undefined,
					autoAttach,
					fps,
				});
			};

			const appendCompositionElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
			): TimelineElement[] => {
				if (node.type !== "scene") return elements;
				const sourceScene = latestProject.scenes[node.sceneId];
				if (!sourceScene) return elements;
				if (
					wouldCreateSceneCompositionCycle(
						latestProject,
						sceneId,
						sourceScene.id,
					)
				) {
					return elements;
				}
				const sourceRuntime = runtimeManager?.getTimelineRuntime(
					toSceneTimelineRef(sourceScene.id),
				);
				const sourceTimelineState = sourceRuntime?.timelineStore.getState();
				const sourceElements =
					sourceTimelineState?.elements ?? sourceScene.timeline.elements;
				const sourceFps = Math.max(
					1,
					Math.round(
						sourceTimelineState?.fps ?? sourceScene.timeline.fps ?? fps,
					),
				);
				const sourceCanvasSize =
					sourceTimelineState?.canvasSize ?? sourceScene.timeline.canvas;
				const sourceDuration = resolveTimelineEndFrame(sourceElements);
				const durationBySource = Math.max(
					1,
					Math.round((sourceDuration / sourceFps) * fps),
				);
				const fallbackDuration = Math.max(1, secondsToFrames(5, fps));
				const duration =
					sourceDuration > 0 ? durationBySource : fallbackDuration;
				const start = resolveTimelineEndFrame(elements);
				const width = Math.max(
					1,
					Math.round(sourceCanvasSize.width || Math.abs(node.width) || 1),
				);
				const height = Math.max(
					1,
					Math.round(sourceCanvasSize.height || Math.abs(node.height) || 1),
				);
				const nextElement: TimelineElement = {
					id: `element-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					type: "Composition",
					component: "composition",
					name: sourceScene.name?.trim() || node.name || "Composition",
					props: {
						sceneId: sourceScene.id,
					},
					transform: createTransformMeta({
						width,
						height,
						positionX: 0,
						positionY: 0,
					}),
					timeline: buildTimelineMeta(
						{
							start,
							end: start + duration,
							trackIndex: 0,
							role: "clip",
						},
						fps,
					),
					render: {
						zIndex: 0,
						visible: true,
						opacity: 1,
					},
				};
				return finalizeTimelineElements([...elements, nextElement], {
					rippleEditingEnabled,
					attachments: autoAttach ? findAttachments(elements) : undefined,
					autoAttach,
					fps,
				});
			};

			const appendElement = (
				elements: TimelineElement[],
				fps: number,
				rippleEditingEnabled: boolean,
				autoAttach: boolean,
			): TimelineElement[] => {
				if (node.type === "image") {
					return appendImageElement(
						elements,
						fps,
						rippleEditingEnabled,
						autoAttach,
					);
				}
				if (node.type === "scene") {
					return appendCompositionElement(
						elements,
						fps,
						rippleEditingEnabled,
						autoAttach,
					);
				}
				return elements;
			};

			if (runtimeManager) {
				const timelineRuntime = runtimeManager.getTimelineRuntime(
					toSceneTimelineRef(sceneId),
				);
				if (timelineRuntime) {
					const timelineState = timelineRuntime.timelineStore.getState();
					timelineState.setElements((prev) => {
						return appendElement(
							prev,
							timelineState.fps,
							timelineState.rippleEditingEnabled,
							timelineState.autoAttach,
						);
					});
					return;
				}
			}

			const nextElements = appendElement(
				targetScene.timeline.elements,
				targetScene.timeline.fps,
				targetScene.timeline.settings.rippleEditingEnabled,
				targetScene.timeline.settings.autoAttach,
			);
			if (nextElements === targetScene.timeline.elements) return;
			updateSceneTimeline(sceneId, {
				...targetScene.timeline,
				elements: nextElements,
			});
		},
		[runtimeManager, updateSceneTimeline],
	);

	const resolvedDrawerTarget = useMemo<ResolvedNodeDrawerTarget | null>(() => {
		if (focusedNode) {
			const definition = getCanvasNodeDefinition(focusedNode.type);
			const options = resolveDrawerOptions(
				definition.drawerOptions,
				definition.drawerTrigger,
			);
			const trigger = options.trigger;
			if (definition.drawer && trigger === "focus") {
				return {
					Drawer: definition.drawer as unknown as AnyCanvasDrawer,
					node: focusedNode,
					trigger,
					options,
				};
			}
		}
		if (activeNode) {
			const definition = getCanvasNodeDefinition(activeNode.type);
			const options = resolveDrawerOptions(
				definition.drawerOptions,
				definition.drawerTrigger,
			);
			const trigger = options.trigger;
			if (definition.drawer && trigger === "active") {
				return {
					Drawer: definition.drawer as unknown as AnyCanvasDrawer,
					node: activeNode,
					trigger,
					options,
				};
			}
		}
		return null;
	}, [activeNode, focusedNode]);

	const resolvedDrawer = useMemo<ResolvedNodeDrawer | null>(() => {
		if (!resolvedDrawerTarget) return null;
		const node = resolvedDrawerTarget.node;
		const scene =
			node.type === "scene"
				? (currentProject?.scenes[node.sceneId] ?? null)
				: null;
		const asset =
			"assetId" in node
				? (currentProject?.assets.find((item) => item.id === node.assetId) ??
					null)
				: null;
		return {
			...resolvedDrawerTarget,
			scene,
			asset,
		};
	}, [currentProject, resolvedDrawerTarget]);

	const isSidebarFocusMode = focusedNode?.type === "scene";
	const [sidebarTab, setSidebarTab] = useState<CanvasSidebarTab>("nodes");
	const [sidebarExpanded, setSidebarExpanded] = useState(true);

	useEffect(() => {
		setSidebarTab(focusedNodeId ? "element" : "nodes");
	}, [focusedNodeId]);

	const drawerIdentity = resolvedDrawerTarget
		? `${resolvedDrawerTarget.node.id}:${resolvedDrawerTarget.trigger}`
		: null;
	const drawerDefaultHeight =
		resolvedDrawerTarget?.options.defaultHeight ??
		CANVAS_NODE_DRAWER_DEFAULT_HEIGHT;
	const drawerVisible = Boolean(resolvedDrawerTarget);
	const rightPanelVisible = Boolean(activeNode);
	const overlayLayout = useMemo(() => {
		return resolveCanvasOverlayLayout({
			containerWidth: stageSize.width,
			containerHeight: stageSize.height,
			sidebarExpanded,
			drawerVisible,
			drawerHeight: visibleDrawerHeight,
			rightPanelVisible,
			sidebarWidthPx: CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
			rightPanelWidthPx: CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
		});
	}, [
		drawerVisible,
		rightPanelVisible,
		sidebarExpanded,
		stageSize.height,
		stageSize.width,
		visibleDrawerHeight,
	]);
	const cameraSafeInsets = overlayLayout.cameraSafeInsets;
	const rightPanelShouldRender =
		rightPanelVisible &&
		overlayLayout.rightPanelRect.width > 0 &&
		overlayLayout.rightPanelRect.height > 0;

	const resolveWorldPoint = useCallback(
		(clientX: number, clientY: number) => {
			const container = containerRef.current;
			if (!container) return { x: 0, y: 0 };
			const rect = container.getBoundingClientRect();
			const safeClientX = Number.isFinite(clientX) ? clientX : rect.left;
			const safeClientY = Number.isFinite(clientY) ? clientY : rect.top;
			const localX = safeClientX - rect.left;
			const localY = safeClientY - rect.top;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			return {
				x: localX / safeZoom - camera.x,
				y: localY / safeZoom - camera.y,
			};
		},
		[camera],
	);
	const resolveLocalPoint = useCallback((clientX: number, clientY: number) => {
		const container = containerRef.current;
		if (!container) return { x: 0, y: 0 };
		const rect = container.getBoundingClientRect();
		return {
			x: clientX - rect.left,
			y: clientY - rect.top,
		};
	}, []);
	const updateMarqueeRectState = useCallback((nextRect: CanvasMarqueeRect) => {
		marqueeRectRef.current = nextRect;
		setMarqueeRect(nextRect);
	}, []);
	const clearCanvasSnapGuides = useCallback(() => {
		setSnapGuidesScreen(EMPTY_CANVAS_SNAP_GUIDES_SCREEN);
	}, []);
	const setCanvasSnapGuides = useCallback(
		(guidesWorld: CanvasSnapGuidesWorld) => {
			if (
				guidesWorld.vertical.length === 0 &&
				guidesWorld.horizontal.length === 0
			) {
				clearCanvasSnapGuides();
				return;
			}
			setSnapGuidesScreen(projectCanvasSnapGuidesToScreen(guidesWorld, camera));
		},
		[camera, clearCanvasSnapGuides],
	);
	const resolveCanvasGuideValues = useCallback(
		(excludeNodeIds: string[]): CanvasSnapGuideValues => {
			const latestProject =
				useProjectStore.getState().currentProject ?? currentProject;
			return collectCanvasSnapGuideValues({
				nodes: latestProject?.canvas.nodes ?? [],
				excludeNodeIds,
			});
		},
		[currentProject],
	);
	const clearCanvasMarquee = useCallback(() => {
		marqueeSessionRef.current = null;
		updateMarqueeRectState({
			visible: false,
			x1: marqueeRectRef.current.x1,
			y1: marqueeRectRef.current.y1,
			x2: marqueeRectRef.current.x2,
			y2: marqueeRectRef.current.y2,
		});
	}, [updateMarqueeRectState]);
	const clearPendingClickSuppression = useCallback(() => {
		pendingClickSuppressionRef.current = null;
	}, []);
	const setPendingClickSuppression = useCallback(
		(nextSuppression: PendingCanvasClickSuppression) => {
			pendingClickSuppressionRef.current = nextSuppression;
		},
		[],
	);
	const resolvePendingClickSuppression = useCallback(() => {
		const pendingSuppression = pendingClickSuppressionRef.current;
		if (!pendingSuppression) return null;
		clearPendingClickSuppression();
		// 只有没被新的 mousedown 打断时，才把它视为上一轮手势的尾随 click。
		return pendingSuppression;
	}, [clearPendingClickSuppression]);

	useEffect(() => {
		if (canvasSnapEnabled) return;
		clearCanvasSnapGuides();
	}, [canvasSnapEnabled, clearCanvasSnapGuides]);
	const isResizeAnchorHitAtWorldPoint = useCallback(
		(worldX: number, worldY: number) => {
			if (activeNode && !activeNode.locked && isSingleSelection) {
				const hitAnchor = resolveCanvasResizeAnchorAtWorldPoint({
					node: activeNode,
					worldX,
					worldY,
					cameraZoom: camera.zoom,
				});
				if (hitAnchor) return true;
			}
			if (
				selectedBounds &&
				selectedNodes.length > 1 &&
				selectedNodes.some((node) => !node.locked)
			) {
				const hitAnchor = resolveCanvasResizeAnchorAtRectWorldPoint({
					x: selectedBounds.left,
					y: selectedBounds.top,
					width: selectedBounds.width,
					height: selectedBounds.height,
					worldX,
					worldY,
					cameraZoom: camera.zoom,
				});
				if (hitAnchor) return true;
			}
			return false;
		},
		[activeNode, camera.zoom, isSingleSelection, selectedBounds, selectedNodes],
	);

	const commitSelectedNodeIds = useCallback(
		(nextSelectedNodeIds: string[]) => {
			const latestProject =
				useProjectStore.getState().currentProject ?? currentProject;
			const latestNodeIdSet = new Set(
				latestProject?.canvas.nodes.map((node) => node.id) ?? [],
			);
			const normalized = normalizeSelectedNodeIds(
				nextSelectedNodeIds,
				latestNodeIdSet,
			);
			setSelectedNodeIds(normalized);
			const nextPrimaryNodeId = getPrimarySelectedNodeId(normalized);
			if (nextPrimaryNodeId) {
				const primaryNode =
					latestProject?.canvas.nodes.find(
						(node) => node.id === nextPrimaryNodeId,
					) ?? null;
				if (primaryNode?.type === "scene") {
					setActiveScene(primaryNode.sceneId);
				}
			}
			setActiveNode(nextPrimaryNodeId);
		},
		[currentProject, setActiveNode, setActiveScene],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			setStageSize({ width: rect.width, height: rect.height });
		};
		updateSize();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateSize);
			return () => window.removeEventListener("resize", updateSize);
		}
		const observer = new ResizeObserver(updateSize);
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (focusedNodeId) {
			const nextSelected = currentNodeIdSet.has(focusedNodeId)
				? [focusedNodeId]
				: [];
			if (
				nextSelected.length !== normalizedSelectedNodeIds.length ||
				nextSelected[0] !== normalizedSelectedNodeIds[0]
			) {
				setSelectedNodeIds(nextSelected);
			}
			return;
		}
		const filteredSelected = normalizeSelectedNodeIds(
			selectedNodeIds,
			currentNodeIdSet,
		);
		const primarySelectedNodeId = getPrimarySelectedNodeId(filteredSelected);
		if (primarySelectedNodeId === activeNodeId) {
			if (filteredSelected.length !== selectedNodeIds.length) {
				setSelectedNodeIds(filteredSelected);
			}
			return;
		}
		if (!activeNodeId || !currentNodeIdSet.has(activeNodeId)) {
			if (filteredSelected.length > 0) {
				setSelectedNodeIds([]);
			}
			return;
		}
		if (filteredSelected.length !== 1 || filteredSelected[0] !== activeNodeId) {
			setSelectedNodeIds([activeNodeId]);
		}
	}, [
		activeNodeId,
		currentNodeIdSet,
		focusedNodeId,
		normalizedSelectedNodeIds,
		selectedNodeIds,
	]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (!focusedNodeId) return;
			event.preventDefault();
			setFocusedNode(null);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [focusedNodeId, setFocusedNode]);

	useEffect(() => {
		if (focusedNodeId) return;
		setVisibleDrawerHeight(CANVAS_NODE_DRAWER_DEFAULT_HEIGHT);
	}, [focusedNodeId]);

	useEffect(() => {
		if (!drawerIdentity) return;
		setVisibleDrawerHeight(drawerDefaultHeight);
	}, [drawerDefaultHeight, drawerIdentity]);

	useEffect(() => {
		const prevFocusedNodeId = prevFocusedNodeIdRef.current;
		const currentCamera = getCamera();
		if (!prevFocusedNodeId && focusedNodeId) {
			preFocusCameraRef.current = currentCamera;
		}
		if (prevFocusedNodeId && !focusedNodeId) {
			const previous = preFocusCameraRef.current;
			preFocusCameraRef.current = null;
			// 退出 focus 时总是尝试恢复，避免在首帧前退出导致旧 focus 动画继续到终点。
			if (previous) {
				applyCamera(previous);
			}
		}
		prevFocusedNodeIdRef.current = focusedNodeId;
	}, [focusedNodeId]);

	useEffect(() => {
		if (!focusedNodeId) return;
		if (!focusedNode) return;
		if (stageSize.width <= 0 || stageSize.height <= 0) return;
		const nextCamera = buildNodeFitCamera({
			node: focusedNode,
			stageWidth: stageSize.width,
			stageHeight: stageSize.height,
			safeInsets: cameraSafeInsets,
		});
		const currentCamera = getCamera();
		if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
		applyCamera(nextCamera);
	}, [
		cameraSafeInsets,
		focusedNode,
		focusedNodeId,
		stageSize.height,
		stageSize.width,
	]);

	const handleCreateScene = useCallback(() => {
		const nodeId = createCanvasNode({ type: "scene" });
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject) return;
		const node = latestProject.canvas.nodes.find((item) => item.id === nodeId);
		if (!node || node.type !== "scene") return;
		const scene = latestProject.scenes[node.sceneId];
		pushHistory({
			kind: "canvas.node-create",
			node,
			scene,
			focusNodeId: latestProject.ui.focusedNodeId,
		});
	}, [createCanvasNode, pushHistory]);

	const handleZoomByStep = useCallback(
		(multiplier: number) => {
			const currentCamera = getCamera();
			const nextZoom = clampZoom(currentCamera.zoom * multiplier);
			if (nextZoom === currentCamera.zoom) return;
			const safeCurrentZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
			const anchorX = stageSize.width > 0 ? stageSize.width / 2 : 0;
			const anchorY = stageSize.height > 0 ? stageSize.height / 2 : 0;
			const anchorWorldX = anchorX / safeCurrentZoom - currentCamera.x;
			const anchorWorldY = anchorY / safeCurrentZoom - currentCamera.y;
			applyCamera(
				{
					x: anchorX / safeNextZoom - anchorWorldX,
					y: anchorY / safeNextZoom - anchorWorldY,
					zoom: nextZoom,
				},
				{ transition: "instant" },
			);
		},
		[applyCamera, getCamera, stageSize.height, stageSize.width],
	);

	const handleResetView = useCallback(() => {
		applyCamera(DEFAULT_CAMERA);
	}, [applyCamera]);

	const handleContainerWheel = useCallback(
		(event: WheelEvent) => {
			if (isOverlayWheelTarget(event.target)) return;
			event.preventDefault();
			if (focusedNodeId) return;
			const currentCamera = getCamera();
			if (event.ctrlKey || event.metaKey) {
				const oldZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
				const zoomDelta = event.deltaY > 0 ? 0.92 : 1.08;
				const nextZoom = clampZoom(oldZoom * zoomDelta);
				const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
				const container = containerRef.current;
				if (!container) return;
				const rect = container.getBoundingClientRect();
				const pointerX = event.clientX - rect.left;
				const pointerY = event.clientY - rect.top;
				const worldPoint = {
					x: pointerX / oldZoom - currentCamera.x,
					y: pointerY / oldZoom - currentCamera.y,
				};
				applyCamera(
					{
						x: pointerX / safeNextZoom - worldPoint.x,
						y: pointerY / safeNextZoom - worldPoint.y,
						zoom: nextZoom,
					},
					{ transition: "instant" },
				);
				return;
			}
			const safeZoom = Math.max(currentCamera.zoom, CAMERA_ZOOM_EPSILON);
			applyCamera(
				{
					x: currentCamera.x - event.deltaX / safeZoom,
					y: currentCamera.y - event.deltaY / safeZoom,
					zoom: currentCamera.zoom,
				},
				{ transition: "instant" },
			);
		},
		[applyCamera, focusedNodeId, getCamera],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const listener = (event: WheelEvent) => {
			handleContainerWheel(event);
		};
		container.addEventListener("wheel", listener, { passive: false });
		return () => {
			container.removeEventListener("wheel", listener);
		};
	}, [handleContainerWheel]);

	const getTopHitNode = useCallback(
		(worldX: number, worldY: number): CanvasNode | null => {
			for (let index = sortedNodes.length - 1; index >= 0; index -= 1) {
				const node = sortedNodes[index];
				if (!node) continue;
				const canInteractNode =
					!isCanvasInteractionLocked || node.id === focusedNodeId;
				if (!canInteractNode) continue;
				if (!isWorldPointInNode(node, worldX, worldY)) continue;
				return node;
			}
			return null;
		},
		[focusedNodeId, isCanvasInteractionLocked, sortedNodes],
	);

	const handleNodeActivate = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitSelectedNodeIds([node.id]);
		},
		[commitSelectedNodeIds, focusedNodeId, isCanvasInteractionLocked],
	);

	const handleToggleNodeSelection = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitSelectedNodeIds(
				toggleSelectedNodeIds(normalizedSelectedNodeIds, node.id),
			);
		},
		[
			commitSelectedNodeIds,
			focusedNodeId,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
		],
	);

	const collectIntersectedNodeIds = useCallback(
		(rect: CanvasMarqueeRect): string[] => {
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const left = Math.min(rect.x1, rect.x2) / safeZoom - camera.x;
			const right = Math.max(rect.x1, rect.x2) / safeZoom - camera.x;
			const top = Math.min(rect.y1, rect.y2) / safeZoom - camera.y;
			const bottom = Math.max(rect.y1, rect.y2) / safeZoom - camera.y;
			return sortedNodes
				.filter((node) =>
					isNodeIntersectRect(node, {
						left,
						right,
						top,
						bottom,
					}),
				)
				.map((node) => node.id);
		},
		[camera.x, camera.y, camera.zoom, sortedNodes],
	);

	const applyMarqueeSelection = useCallback(
		(rect: CanvasMarqueeRect) => {
			const marqueeSession = marqueeSessionRef.current;
			if (!marqueeSession) return;
			const hitNodeIds = collectIntersectedNodeIds(rect);
			if (marqueeSession.additive) {
				let nextSelectedNodeIds = [...marqueeSession.initialSelectedNodeIds];
				for (const nodeId of hitNodeIds) {
					nextSelectedNodeIds = toggleSelectedNodeIds(
						nextSelectedNodeIds,
						nodeId,
					);
				}
				commitSelectedNodeIds(nextSelectedNodeIds);
				return;
			}
			commitSelectedNodeIds(hitNodeIds);
		},
		[collectIntersectedNodeIds, commitSelectedNodeIds],
	);

	const resolveNodeResizeConstraints = useCallback(
		(node: CanvasNode): ResolvedCanvasNodeResizeConstraints => {
			const definition = getCanvasNodeDefinition(node.type);
			const scene =
				node.type === "scene"
					? (currentProject?.scenes[node.sceneId] ?? null)
					: null;
			const asset =
				"assetId" in node
					? (currentProject?.assets.find((item) => item.id === node.assetId) ??
						null)
					: null;
			const constraints: CanvasNodeResizeConstraints =
				definition.resolveResizeConstraints?.({
					node,
					scene,
					asset,
				}) ?? {};
			const minWidth = resolvePositiveNumber(constraints.minWidth);
			const minHeight = resolvePositiveNumber(constraints.minHeight);
			const maxWidth = resolvePositiveNumber(constraints.maxWidth);
			const maxHeight = resolvePositiveNumber(constraints.maxHeight);
			const fallbackAspectRatio = resolvePositiveNumber(
				node.width / Math.max(node.height, CAMERA_ZOOM_EPSILON),
			);
			const requestedAspectRatio = resolvePositiveNumber(
				constraints.aspectRatio,
			);
			const lockAspectRatio =
				constraints.lockAspectRatio === true &&
				(requestedAspectRatio !== null || fallbackAspectRatio !== null);

			return {
				lockAspectRatio,
				aspectRatio: lockAspectRatio
					? (requestedAspectRatio ?? fallbackAspectRatio)
					: null,
				minWidth,
				minHeight,
				maxWidth,
				maxHeight,
			};
		},
		[currentProject],
	);

	const buildCanvasCopyEntries = useCallback((nodeIds: string[]) => {
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject || nodeIds.length === 0) return [];
		const sourceNodes = latestProject.canvas.nodes
			.filter((node) => nodeIds.includes(node.id))
			.sort((left, right) => {
				if (left.zIndex !== right.zIndex) return left.zIndex - right.zIndex;
				return left.createdAt - right.createdAt;
			});
		if (sourceNodes.length === 0) return [];
		const maxZIndex = latestProject.canvas.nodes.reduce((maxValue, node) => {
			return Math.max(maxValue, node.zIndex);
		}, -1);
		const now = Date.now();
		return sourceNodes.reduce<CanvasGraphHistoryEntry[]>(
			(entries, sourceNode, index) => {
				const createdAt = now + index;
				const copyName = sourceNode.name.trim()
					? `${sourceNode.name}副本`
					: "副本";
				const baseNode = {
					...sourceNode,
					id: createCanvasEntityId("node"),
					name: copyName,
					zIndex: maxZIndex + index + 1,
					createdAt,
					updatedAt: createdAt,
				};
				if (sourceNode.type === "scene") {
					const sourceScene = latestProject.scenes[sourceNode.sceneId];
					if (!sourceScene) return entries;
					const sceneId = createCanvasEntityId("scene");
					const scene: SceneDocument = {
						...cloneTimelineJson(sourceScene),
						id: sceneId,
						name: copyName,
						createdAt,
						updatedAt: createdAt,
					};
					const node: SceneNode = {
						...baseNode,
						type: "scene",
						sceneId,
					};
					entries.push({ node, scene });
					return entries;
				}
				entries.push({
					node: baseNode as CanvasNode,
					scene: undefined,
				});
				return entries;
			},
			[],
		);
		}, []);

	const handleSkiaNodeResizeStart = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			event: CanvasNodeDragEvent,
		) => {
			if (event.button !== 0) return;
			if (normalizedSelectedNodeIds.length > 1) return;
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			if (node.locked) {
				handleNodeActivate(node);
				return;
			}
			nodeDragSessionRef.current = null;
			clearPendingClickSuppression();
			commitSelectedNodeIds([node.id]);
			nodeResizeSessionRef.current = {
				nodeId: node.id,
				anchor,
				startNodeX: node.x,
				startNodeY: node.y,
				startNodeWidth: node.width,
				startNodeHeight: node.height,
				fixedCornerX:
					anchor === "top-right" || anchor === "bottom-right"
						? node.x
						: node.x + node.width,
				fixedCornerY:
					anchor === "bottom-left" || anchor === "bottom-right"
						? node.y
						: node.y + node.height,
				before: pickLayout(node),
				moved: false,
				constraints: resolveNodeResizeConstraints(node),
			};
		},
		[
			clearPendingClickSuppression,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			focusedNodeId,
			commitSelectedNodeIds,
			handleNodeActivate,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds.length,
			resolveNodeResizeConstraints,
		],
	);

	const handleSkiaNodeResizeMove = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			event: CanvasNodeDragEvent,
		) => {
			const resizeSession = nodeResizeSessionRef.current;
			if (!resizeSession) return;
			if (resizeSession.nodeId !== node.id) return;
			if (resizeSession.anchor !== anchor) return;

			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const deltaX = event.movementX / safeZoom;
			const deltaY = event.movementY / safeZoom;
			if (Math.abs(deltaX) + Math.abs(deltaY) < 1e-9) return;
			const isRightAnchor = isRightResizeAnchor(anchor);
			const isBottomAnchor = isBottomResizeAnchor(anchor);

			const draftWidth = isRightAnchor
				? resizeSession.startNodeWidth + deltaX
				: resizeSession.startNodeWidth - deltaX;
			const draftHeight = isBottomAnchor
				? resizeSession.startNodeHeight + deltaY
				: resizeSession.startNodeHeight - deltaY;
			const globalMinSize = 32 / safeZoom;
			let nextLayout = resolveConstrainedResizeLayout({
				anchor,
				fixedCornerX: resizeSession.fixedCornerX,
				fixedCornerY: resizeSession.fixedCornerY,
				startWidth: resizeSession.startNodeWidth,
				startHeight: resizeSession.startNodeHeight,
				draftWidth,
				draftHeight,
				constraints: resizeSession.constraints,
				globalMinSize,
			});
			if (canvasSnapEnabled) {
				const guideValues = resolveCanvasGuideValues([resizeSession.nodeId]);
				const snapThreshold = resolveCanvasSnapThresholdWorld(camera.zoom);
				const candidateBox = {
					x: nextLayout.x,
					y: nextLayout.y,
					width: nextLayout.width,
					height: nextLayout.height,
				};
				const snapResult = resolveCanvasRectSnap({
					guideValues,
					threshold: snapThreshold,
					movingX: [isRightAnchor ? candidateBox.x + candidateBox.width : candidateBox.x],
					movingY: [isBottomAnchor ? candidateBox.y + candidateBox.height : candidateBox.y],
				});
				const selectedSnap = selectCornerResizeSnap({
					deltaX: snapResult.deltaX,
					deltaY: snapResult.deltaY,
					guidesWorld: snapResult.guidesWorld,
					preferSingleAxis: resizeSession.constraints.lockAspectRatio,
				});
				if (selectedSnap.deltaX !== 0 || selectedSnap.deltaY !== 0) {
					const snappedBox = applyResizeSnapDeltaToBox(
						candidateBox,
						anchor,
						selectedSnap.deltaX,
						selectedSnap.deltaY,
					);
					nextLayout = resolveConstrainedResizeLayout({
						anchor,
						fixedCornerX: resizeSession.fixedCornerX,
						fixedCornerY: resizeSession.fixedCornerY,
						startWidth: resizeSession.startNodeWidth,
						startHeight: resizeSession.startNodeHeight,
						draftWidth: snappedBox.width,
						draftHeight: snappedBox.height,
						constraints: resizeSession.constraints,
						globalMinSize,
						preferredAxis:
							selectedSnap.deltaX !== 0
								? "x"
								: selectedSnap.deltaY !== 0
									? "y"
									: null,
					});
					setCanvasSnapGuides(selectedSnap.guidesWorld);
				} else {
					clearCanvasSnapGuides();
				}
			} else {
				clearCanvasSnapGuides();
			}
			const didLayoutChange =
				Math.abs(nextLayout.x - resizeSession.startNodeX) > 1e-6 ||
				Math.abs(nextLayout.y - resizeSession.startNodeY) > 1e-6 ||
				Math.abs(nextLayout.width - resizeSession.startNodeWidth) > 1e-6 ||
				Math.abs(nextLayout.height - resizeSession.startNodeHeight) > 1e-6;

			resizeSession.moved = resizeSession.moved || didLayoutChange;
			updateCanvasNodeLayout(resizeSession.nodeId, nextLayout);
		},
		[
			canvasSnapEnabled,
			camera.zoom,
			clearCanvasSnapGuides,
			resolveCanvasGuideValues,
			setCanvasSnapGuides,
			updateCanvasNodeLayout,
		],
	);

	const handleSkiaNodeResizeEnd = useCallback(
		(
			node: CanvasNode,
			anchor: CanvasNodeResizeAnchor,
			_event: CanvasNodeDragEvent,
		) => {
			const resizeSession = nodeResizeSessionRef.current;
			nodeResizeSessionRef.current = null;
			clearCanvasSnapGuides();
			if (!resizeSession) return;
			if (resizeSession.nodeId !== node.id) return;
			if (resizeSession.anchor !== anchor) return;
			setPendingClickSuppression({
				suppressNode: true,
				suppressCanvas: true,
			});
			if (!resizeSession.moved) return;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const latestNode = latestProject.canvas.nodes.find(
				(item) => item.id === resizeSession.nodeId,
			);
			if (!latestNode) return;
			const after = pickLayout(latestNode);
			if (isLayoutEqual(resizeSession.before, after)) return;
			pushHistory({
				kind: "canvas.node-layout",
				nodeId: latestNode.id,
				before: resizeSession.before,
				after,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[clearCanvasSnapGuides, pushHistory, setPendingClickSuppression],
	);

	const handleSkiaNodeResize = useCallback(
		(resizeEvent: CanvasNodeResizeEvent) => {
			const { phase, node, anchor, event } = resizeEvent;
			if (phase === "start") {
				handleSkiaNodeResizeStart(node, anchor, event);
				return;
			}
			if (phase === "move") {
				handleSkiaNodeResizeMove(node, anchor, event);
				return;
			}
			handleSkiaNodeResizeEnd(node, anchor, event);
		},
		[
			handleSkiaNodeResizeEnd,
			handleSkiaNodeResizeMove,
			handleSkiaNodeResizeStart,
		],
	);

	const beginCanvasDragSession = useCallback(
		(input: {
			origin: "node" | "selection";
			anchorNodeId: string | null;
			pendingSelectedNodeIds: string[];
			copyMode: boolean;
		}) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return false;
			const dragNodes = input.pendingSelectedNodeIds
				.map(
					(nodeId) =>
						latestProject.canvas.nodes.find((item) => item.id === nodeId) ??
						null,
				)
				.filter((item): item is CanvasNode => Boolean(item))
				.filter((item) => !item.locked);
			if (dragNodes.length === 0) return false;
			const initialBounds = resolveCanvasNodeBounds(dragNodes);
			if (!initialBounds) return false;
			nodeDragSessionRef.current = {
				origin: input.origin,
				anchorNodeId: input.anchorNodeId,
				pendingSelectedNodeIds: input.pendingSelectedNodeIds,
				dragNodeIds: dragNodes.map((item) => item.id),
				initialBounds: {
					x: initialBounds.left,
					y: initialBounds.top,
					width: initialBounds.width,
					height: initialBounds.height,
				},
				snapshots: Object.fromEntries(
					dragNodes.map((dragNode) => [
						dragNode.id,
						{
							nodeId: dragNode.id,
							startNodeX: dragNode.x,
							startNodeY: dragNode.y,
							before: pickLayout(dragNode),
						},
					]),
				),
				copyEntries: [],
				activated: false,
				moved: false,
				axisLock: null,
				copyMode: input.copyMode,
			};
			return true;
		},
		[],
	);

	const applyCanvasDragEvent = useCallback(
		(event: CanvasNodeDragEvent) => {
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession) return;
			if (
				Math.abs(event.movementX) + Math.abs(event.movementY) <
				CANVAS_MARQUEE_ACTIVATION_PX
			) {
				return;
			}
			if (!dragSession.activated) {
				commitSelectedNodeIds(dragSession.pendingSelectedNodeIds);
				dragSession.activated = true;
				if (dragSession.copyMode) {
					const copyEntries = buildCanvasCopyEntries(dragSession.dragNodeIds);
					if (copyEntries.length > 0) {
						appendCanvasGraphBatch(copyEntries);
						dragSession.copyEntries = copyEntries;
						for (const entry of copyEntries) {
							dragSession.snapshots[entry.node.id] = {
								nodeId: entry.node.id,
								startNodeX: entry.node.x,
								startNodeY: entry.node.y,
								before: pickLayout(entry.node),
							};
						}
					}
				}
			}
			const targetNodeIds =
				dragSession.copyEntries.length > 0
					? dragSession.copyEntries.map((entry) => entry.node.id)
					: dragSession.dragNodeIds;
			if (targetNodeIds.length === 0) return;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			let deltaX = event.movementX / safeZoom;
			let deltaY = event.movementY / safeZoom;
			if (
				dragSession.axisLock === null &&
				event.shiftKey &&
				(Math.abs(event.movementX) >=
					CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX ||
					Math.abs(event.movementY) >= CANVAS_ORTHOGONAL_DRAG_LOCK_THRESHOLD_PX)
			) {
				dragSession.axisLock =
					Math.abs(event.movementX) >= Math.abs(event.movementY) ? "x" : "y";
			}
			if (dragSession.axisLock === "x") {
				deltaY = 0;
			}
			if (dragSession.axisLock === "y") {
				deltaX = 0;
			}
			if (canvasSnapEnabled) {
				const guideValues = resolveCanvasGuideValues(targetNodeIds);
				const snapThreshold = resolveCanvasSnapThresholdWorld(camera.zoom);
				const movingBox = {
					x: dragSession.initialBounds.x + deltaX,
					y: dragSession.initialBounds.y + deltaY,
					width: dragSession.initialBounds.width,
					height: dragSession.initialBounds.height,
				};
				const snapResult = resolveCanvasRectSnap({
					guideValues,
					threshold: snapThreshold,
					movingX:
						dragSession.axisLock === "y"
							? []
							: [
									movingBox.x,
									movingBox.x + movingBox.width / 2,
									movingBox.x + movingBox.width,
								],
					movingY:
						dragSession.axisLock === "x"
							? []
							: [
									movingBox.y,
									movingBox.y + movingBox.height / 2,
									movingBox.y + movingBox.height,
								],
				});
				deltaX += snapResult.deltaX;
				deltaY += snapResult.deltaY;
				setCanvasSnapGuides(snapResult.guidesWorld);
			} else {
				clearCanvasSnapGuides();
			}
			let didMove = false;
			for (const targetNodeId of targetNodeIds) {
				const snapshot = dragSession.snapshots[targetNodeId];
				if (!snapshot) continue;
				const nextX = Math.round(snapshot.startNodeX + deltaX);
				const nextY = Math.round(snapshot.startNodeY + deltaY);
				if (nextX !== snapshot.startNodeX || nextY !== snapshot.startNodeY) {
					didMove = true;
				}
				updateCanvasNodeLayout(targetNodeId, {
					x: nextX,
					y: nextY,
				});
			}
			dragSession.moved = dragSession.moved || didMove;
		},
		[
			appendCanvasGraphBatch,
			buildCanvasCopyEntries,
			canvasSnapEnabled,
			camera.zoom,
			clearCanvasSnapGuides,
			commitSelectedNodeIds,
			resolveCanvasGuideValues,
			setCanvasSnapGuides,
			updateCanvasNodeLayout,
		],
	);

	const finishCanvasDragSession = useCallback(
		(_event: CanvasNodeDragEvent) => {
			const dragSession = nodeDragSessionRef.current;
			nodeDragSessionRef.current = null;
			clearCanvasSnapGuides();
			if (!dragSession) return;
			if (!dragSession.activated || !dragSession.moved) {
				if (dragSession.copyEntries.length > 0) {
					removeCanvasGraphBatch(
						dragSession.copyEntries.map((entry) => entry.node.id),
					);
				}
				return;
			}
			setPendingClickSuppression({
				suppressNode: true,
				suppressCanvas: true,
			});
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			if (dragSession.copyEntries.length > 0) {
				const nextEntries = dragSession.copyEntries
					.map((entry) => {
						const latestNode =
							latestProject.canvas.nodes.find(
								(item) => item.id === entry.node.id,
							) ?? null;
						if (!latestNode) return null;
						return {
							node: latestNode,
							scene:
								latestNode.type === "scene"
									? (latestProject.scenes[latestNode.sceneId] ?? entry.scene)
									: undefined,
						};
						})
						.filter(
							(
								entry,
							): entry is CanvasGraphHistoryEntry => entry !== null,
						);
				if (nextEntries.length === 0) return;
				pushHistory({
					kind: "canvas.node-create.batch",
					entries: nextEntries,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				commitSelectedNodeIds(nextEntries.map((entry) => entry.node.id));
				return;
			}
			const nextEntries = dragSession.dragNodeIds
				.map((nodeId) => {
					const snapshot = dragSession.snapshots[nodeId];
					const latestNode =
						latestProject.canvas.nodes.find((item) => item.id === nodeId) ??
						null;
					if (!snapshot || !latestNode) return null;
					const after = pickLayout(latestNode);
					if (isLayoutEqual(snapshot.before, after)) return null;
					return {
						nodeId,
						before: snapshot.before,
						after,
					};
				})
				.filter(
					(
						entry,
					): entry is {
						nodeId: string;
						before: CanvasNodeLayoutSnapshot;
						after: CanvasNodeLayoutSnapshot;
					} => Boolean(entry),
				);
			if (nextEntries.length === 0) return;
			if (nextEntries.length === 1) {
				const entry = nextEntries[0];
				pushHistory({
					kind: "canvas.node-layout",
					nodeId: entry.nodeId,
					before: entry.before,
					after: entry.after,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				return;
			}
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: nextEntries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[
			clearCanvasSnapGuides,
			commitSelectedNodeIds,
			pushHistory,
			removeCanvasGraphBatch,
			setPendingClickSuppression,
		],
	);

	const handleSkiaNodeDragStart = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || selectionResizeSessionRef.current) {
				return;
			}
			if (event.button !== 0) return;
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			clearPendingClickSuppression();
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			if (node.locked) {
				if (!event.shiftKey) {
					handleNodeActivate(node);
				}
				return;
			}
			const isNodeSelected = normalizedSelectedNodeIds.includes(node.id);
			const pendingSelectedNodeIds = isNodeSelected
				? normalizedSelectedNodeIds
				: event.shiftKey
					? [...normalizedSelectedNodeIds, node.id]
					: [node.id];
			beginCanvasDragSession({
				origin: "node",
				anchorNodeId: node.id,
				pendingSelectedNodeIds,
				copyMode: event.altKey,
			});
		},
		[
			beginCanvasDragSession,
			clearPendingClickSuppression,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			focusedNodeId,
			handleNodeActivate,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
		],
	);

	const handleSkiaNodeDrag = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || selectionResizeSessionRef.current) {
				return;
			}
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession) return;
			if (
				dragSession.origin !== "node" ||
				dragSession.anchorNodeId !== node.id
			) {
				return;
			}
			applyCanvasDragEvent(event);
		},
		[applyCanvasDragEvent],
	);

	const handleSkiaNodeDragEnd = useCallback(
		(node: CanvasNode, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || selectionResizeSessionRef.current) {
				return;
			}
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession) return;
			if (
				dragSession.origin !== "node" ||
				dragSession.anchorNodeId !== node.id
			) {
				return;
			}
			finishCanvasDragSession(event);
		},
		[finishCanvasDragSession],
	);

	const handleSelectionBoundsDragStart = useCallback(
		(event: CanvasNodeDragEvent) => {
			if (
				nodeResizeSessionRef.current ||
				selectionResizeSessionRef.current ||
				event.button !== 0 ||
				isCanvasInteractionLocked ||
				normalizedSelectedNodeIds.length <= 1
			) {
				return;
			}
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			setPendingClickSuppression({
				suppressNode: false,
				suppressCanvas: true,
			});
			beginCanvasDragSession({
				origin: "selection",
				anchorNodeId: null,
				pendingSelectedNodeIds: normalizedSelectedNodeIds,
				copyMode: event.altKey,
			});
		},
		[
			beginCanvasDragSession,
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
			setPendingClickSuppression,
		],
	);

	const handleSelectionBoundsDrag = useCallback(
		(event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || selectionResizeSessionRef.current) {
				return;
			}
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession || dragSession.origin !== "selection") return;
			applyCanvasDragEvent(event);
		},
		[applyCanvasDragEvent],
	);

	const handleSelectionBoundsDragEnd = useCallback(
		(event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || selectionResizeSessionRef.current)
				return;
			const dragSession = nodeDragSessionRef.current;
			if (!dragSession || dragSession.origin !== "selection") return;
			finishCanvasDragSession(event);
		},
		[finishCanvasDragSession],
	);

	const handleSelectionResizeStart = useCallback(
		(anchor: CanvasNodeResizeAnchor, event: CanvasNodeDragEvent) => {
			if (nodeResizeSessionRef.current || nodeDragSessionRef.current) return;
			if (event.button !== 0) return;
			if (isCanvasInteractionLocked) return;
			if (!selectedBounds || selectedNodes.length <= 1) return;
			clearCanvasMarquee();
			clearCanvasSnapGuides();
			const resizeNodes = selectedNodes.filter((node) => !node.locked);
			if (resizeNodes.length === 0) return;
			setPendingClickSuppression({
				suppressNode: false,
				suppressCanvas: true,
			});
			selectionResizeSessionRef.current = {
				anchor,
				startBoundsLeft: selectedBounds.left,
				startBoundsTop: selectedBounds.top,
				startBoundsWidth: selectedBounds.width,
				startBoundsHeight: selectedBounds.height,
				fixedCornerX:
					anchor === "top-right" || anchor === "bottom-right"
						? selectedBounds.left
						: selectedBounds.right,
				fixedCornerY:
					anchor === "bottom-left" || anchor === "bottom-right"
						? selectedBounds.top
						: selectedBounds.bottom,
				snapshots: Object.fromEntries(
					resizeNodes.map((node) => [
						node.id,
						{
							nodeId: node.id,
							startNodeX: node.x,
							startNodeY: node.y,
							startNodeWidth: node.width,
							startNodeHeight: node.height,
							before: pickLayout(node),
							constraints: resolveNodeResizeConstraints(node),
						},
					]),
				),
				moved: false,
			};
		},
		[
			clearCanvasMarquee,
			clearCanvasSnapGuides,
			isCanvasInteractionLocked,
			resolveNodeResizeConstraints,
			selectedBounds,
			selectedNodes,
			setPendingClickSuppression,
		],
	);

		const handleSelectionResizeMove = useCallback(
			(anchor: CanvasNodeResizeAnchor, event: CanvasNodeDragEvent) => {
				const resizeSession = selectionResizeSessionRef.current;
				if (!resizeSession) return;
				if (resizeSession.anchor !== anchor) return;
				const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
				const deltaX = event.movementX / safeZoom;
				const deltaY = event.movementY / safeZoom;
				if (Math.abs(deltaX) + Math.abs(deltaY) < 1e-9) return;
				const isRightAnchor = isRightResizeAnchor(anchor);
				const isBottomAnchor = isBottomResizeAnchor(anchor);
				const globalMinSize = 32 / safeZoom;
				const draftWidth = clampSize(
					isRightAnchor
						? resizeSession.startBoundsWidth + deltaX
						: resizeSession.startBoundsWidth - deltaX,
					globalMinSize,
				);
				const draftHeight = clampSize(
					isBottomAnchor
						? resizeSession.startBoundsHeight + deltaY
						: resizeSession.startBoundsHeight - deltaY,
					globalMinSize,
				);
				const groupAspectRatio = resolvePositiveNumber(
					resizeSession.startBoundsWidth /
						Math.max(resizeSession.startBoundsHeight, CAMERA_ZOOM_EPSILON),
				);
				const groupResizeConstraints: ResolvedCanvasNodeResizeConstraints = {
					lockAspectRatio: groupAspectRatio !== null,
					aspectRatio: groupAspectRatio,
					minWidth: null,
					minHeight: null,
					maxWidth: null,
					maxHeight: null,
				};
				let preferredResizeAxis: "x" | "y" | null = null;
				let nextBoundsBox = resolveConstrainedResizeLayout({
					anchor,
					fixedCornerX: resizeSession.fixedCornerX,
					fixedCornerY: resizeSession.fixedCornerY,
					startWidth: resizeSession.startBoundsWidth,
					startHeight: resizeSession.startBoundsHeight,
					draftWidth,
					draftHeight,
					constraints: groupResizeConstraints,
					globalMinSize,
				});
				if (canvasSnapEnabled) {
					const guideValues = resolveCanvasGuideValues(
						Object.keys(resizeSession.snapshots),
					);
					const snapThreshold = resolveCanvasSnapThresholdWorld(camera.zoom);
					const snapResult = resolveCanvasRectSnap({
						guideValues,
						threshold: snapThreshold,
						movingX: [
							isRightAnchor
								? nextBoundsBox.x + nextBoundsBox.width
								: nextBoundsBox.x,
						],
						movingY: [
							isBottomAnchor
								? nextBoundsBox.y + nextBoundsBox.height
								: nextBoundsBox.y,
						],
					});
					const selectedSnap = selectCornerResizeSnap({
						deltaX: snapResult.deltaX,
						deltaY: snapResult.deltaY,
						guidesWorld: snapResult.guidesWorld,
						preferSingleAxis: groupResizeConstraints.lockAspectRatio,
					});
					if (selectedSnap.deltaX !== 0 || selectedSnap.deltaY !== 0) {
						const snappedBoundsBox = applyResizeSnapDeltaToBox(
							nextBoundsBox,
							anchor,
							selectedSnap.deltaX,
							selectedSnap.deltaY,
						);
						preferredResizeAxis =
							selectedSnap.deltaX !== 0
								? "x"
								: selectedSnap.deltaY !== 0
									? "y"
									: preferredResizeAxis;
						nextBoundsBox = resolveConstrainedResizeLayout({
							anchor,
							fixedCornerX: resizeSession.fixedCornerX,
							fixedCornerY: resizeSession.fixedCornerY,
							startWidth: resizeSession.startBoundsWidth,
							startHeight: resizeSession.startBoundsHeight,
							draftWidth: snappedBoundsBox.width,
							draftHeight: snappedBoundsBox.height,
							constraints: groupResizeConstraints,
							globalMinSize,
							preferredAxis: preferredResizeAxis,
						});
						setCanvasSnapGuides(selectedSnap.guidesWorld);
					} else {
						clearCanvasSnapGuides();
					}
				} else {
					clearCanvasSnapGuides();
				}
				const nextLeft = nextBoundsBox.x;
				const nextTop = nextBoundsBox.y;
				const safeStartWidth = Math.max(
					resizeSession.startBoundsWidth,
					CAMERA_ZOOM_EPSILON,
				);
				const safeStartHeight = Math.max(
					resizeSession.startBoundsHeight,
					CAMERA_ZOOM_EPSILON,
				);
				const scaleX = nextBoundsBox.width / safeStartWidth;
				const scaleY = nextBoundsBox.height / safeStartHeight;
				let didMove = false;
				for (const snapshot of Object.values(resizeSession.snapshots)) {
					const candidateNodeX =
						nextLeft +
						(snapshot.startNodeX - resizeSession.startBoundsLeft) * scaleX;
					const candidateNodeY =
						nextTop +
						(snapshot.startNodeY - resizeSession.startBoundsTop) * scaleY;
					const candidateNodeWidth = Math.max(
						CAMERA_ZOOM_EPSILON,
						snapshot.startNodeWidth * scaleX,
					);
					const candidateNodeHeight = Math.max(
						CAMERA_ZOOM_EPSILON,
						snapshot.startNodeHeight * scaleY,
					);
					const candidateFixedCornerX = isRightAnchor
						? candidateNodeX
						: candidateNodeX + candidateNodeWidth;
					const candidateFixedCornerY = isBottomAnchor
						? candidateNodeY
						: candidateNodeY + candidateNodeHeight;
					const nextLayout = resolveConstrainedResizeLayout({
						anchor,
						fixedCornerX: candidateFixedCornerX,
						fixedCornerY: candidateFixedCornerY,
						startWidth: snapshot.startNodeWidth,
						startHeight: snapshot.startNodeHeight,
						draftWidth: candidateNodeWidth,
						draftHeight: candidateNodeHeight,
						constraints: snapshot.constraints,
						globalMinSize,
					});
				if (
					Math.abs(nextLayout.x - snapshot.startNodeX) > 1e-6 ||
					Math.abs(nextLayout.y - snapshot.startNodeY) > 1e-6 ||
					Math.abs(nextLayout.width - snapshot.startNodeWidth) > 1e-6 ||
					Math.abs(nextLayout.height - snapshot.startNodeHeight) > 1e-6
				) {
					didMove = true;
				}
				updateCanvasNodeLayout(snapshot.nodeId, nextLayout);
			}
			resizeSession.moved = resizeSession.moved || didMove;
		},
		[
			canvasSnapEnabled,
			camera.zoom,
			clearCanvasSnapGuides,
			resolveCanvasGuideValues,
			setCanvasSnapGuides,
			updateCanvasNodeLayout,
		],
	);

	const handleSelectionResizeEnd = useCallback(
		(_event: CanvasNodeDragEvent) => {
			const resizeSession = selectionResizeSessionRef.current;
			selectionResizeSessionRef.current = null;
			clearCanvasSnapGuides();
			if (!resizeSession) return;
			setPendingClickSuppression({
				suppressNode: true,
				suppressCanvas: true,
			});
			if (!resizeSession.moved) return;
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const nextEntries = Object.keys(resizeSession.snapshots)
				.map((nodeId) => {
					const snapshot = resizeSession.snapshots[nodeId];
					const latestNode =
						latestProject.canvas.nodes.find((item) => item.id === nodeId) ??
						null;
					if (!snapshot || !latestNode) return null;
					const after = pickLayout(latestNode);
					if (isLayoutEqual(snapshot.before, after)) return null;
					return {
						nodeId,
						before: snapshot.before,
						after,
					};
				})
				.filter(
					(
						entry,
					): entry is {
						nodeId: string;
						before: CanvasNodeLayoutSnapshot;
						after: CanvasNodeLayoutSnapshot;
					} => Boolean(entry),
				);
			if (nextEntries.length === 0) return;
			if (nextEntries.length === 1) {
				const entry = nextEntries[0];
				pushHistory({
					kind: "canvas.node-layout",
					nodeId: entry.nodeId,
					before: entry.before,
					after: entry.after,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				return;
			}
			pushHistory({
				kind: "canvas.node-layout.batch",
				entries: nextEntries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[clearCanvasSnapGuides, pushHistory, setPendingClickSuppression],
	);

	const handleSelectionResize = useCallback(
		(resizeEvent: CanvasSelectionResizeEvent) => {
			const { phase, anchor, event } = resizeEvent;
			if (phase === "start") {
				handleSelectionResizeStart(anchor, event);
				return;
			}
			if (phase === "move") {
				handleSelectionResizeMove(anchor, event);
				return;
			}
			handleSelectionResizeEnd(event);
		},
		[
			handleSelectionResizeEnd,
			handleSelectionResizeMove,
			handleSelectionResizeStart,
		],
	);

	const handleSkiaNodeClick = useCallback(
		(node: CanvasNode, event: CanvasNodePointerEvent) => {
			const pendingSuppression = resolvePendingClickSuppression();
			if (pendingSuppression?.suppressNode) {
				return;
			}
			if (event.shiftKey) {
				handleToggleNodeSelection(node);
				return;
			}
			handleNodeActivate(node);
		},
		[
			handleNodeActivate,
			handleToggleNodeSelection,
			resolvePendingClickSuppression,
		],
	);

	const handleSkiaNodeDoubleClick = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked || node.id === focusedNodeId;
			if (!canInteractNode) return;
			commitSelectedNodeIds([node.id]);
			if (isCanvasNodeFocusable(node, getCanvasNodeDefinition)) {
				setFocusedNode(node.id);
				return;
			}
			const container = containerRef.current;
			const stageWidth =
				stageSize.width > 0
					? stageSize.width
					: (container?.getBoundingClientRect().width ?? 0);
			const stageHeight =
				stageSize.height > 0
					? stageSize.height
					: (container?.getBoundingClientRect().height ?? 0);
			if (stageWidth <= 0 || stageHeight <= 0) return;
			const nextCamera = buildNodeFitCamera({
				node,
				stageWidth,
				stageHeight,
				safeInsets: cameraSafeInsets,
			});
			const currentCamera = getCamera();
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applyCamera(nextCamera);
		},
		[
			applyCamera,
			cameraSafeInsets,
			commitSelectedNodeIds,
			focusedNodeId,
			getCamera,
			isCanvasInteractionLocked,
			setFocusedNode,
			stageSize.height,
			stageSize.width,
		],
	);

	const handleSidebarNodeSelect = useCallback(
		(node: CanvasNode) => {
			handleNodeActivate(node);
			if (isSidebarFocusMode) return;
			if (stageSize.width <= 0 || stageSize.height <= 0) return;
			const currentCamera = getCamera();
			const nextCamera = buildNodePanCamera({
				node,
				camera: currentCamera,
				stageWidth: stageSize.width,
				stageHeight: stageSize.height,
				safeInsets: cameraSafeInsets,
				paddingPx: SIDEBAR_VIEW_PADDING_PX,
			});
			if (isCameraAlmostEqual(currentCamera, nextCamera)) return;
			applyCamera(nextCamera);
		},
		[
			applyCamera,
			cameraSafeInsets,
			getCamera,
			handleNodeActivate,
			isSidebarFocusMode,
			stageSize.height,
			stageSize.width,
		],
	);

	const openCanvasContextMenuAt = useCallback(
		(clientX: number, clientY: number) => {
			const world = resolveWorldPoint(clientX, clientY);
			setContextMenuState({
				open: true,
				scope: "canvas",
				x: clientX,
				y: clientY,
				worldX: world.x,
				worldY: world.y,
			});
		},
		[resolveWorldPoint],
	);

	const deleteCanvasNodes = useCallback(
		(nodeIds: string[]) => {
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const targetIds = normalizeSelectedNodeIds(
				nodeIds,
				new Set(latestProject.canvas.nodes.map((node) => node.id)),
			);
			if (targetIds.length === 0) return;
			const entries = targetIds
				.map((nodeId) => {
					const node =
						latestProject.canvas.nodes.find(
							(candidate) => candidate.id === nodeId,
						) ?? null;
					if (!node) return null;
					return {
						node,
						scene:
							node.type === "scene"
								? (latestProject.scenes[node.sceneId] ?? undefined)
								: undefined,
					};
					})
					.filter(
						(
							entry,
						): entry is CanvasGraphHistoryEntry => entry !== null,
					);
			if (entries.length === 0) return;
			if (entries.length === 1) {
				const entry = entries[0];
				pushHistory({
					kind: "canvas.node-delete",
					node: entry.node,
					scene: entry.scene,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
				if (entry.node.type === "scene" && entry.scene) {
					removeSceneGraphForHistory(entry.scene.id, entry.node.id);
				} else {
					removeCanvasNodeForHistory(entry.node.id);
				}
				return;
			}
			pushHistory({
				kind: "canvas.node-delete.batch",
				entries,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
			removeCanvasGraphBatch(entries.map((entry) => entry.node.id));
		},
		[
			pushHistory,
			removeCanvasGraphBatch,
			removeCanvasNodeForHistory,
			removeSceneGraphForHistory,
		],
	);

	const openDeleteContextMenuAt = useCallback(
		(targetNodeIds: string[], clientX: number, clientY: number) => {
			setContextMenuState({
				open: true,
				scope: "node",
				x: clientX,
				y: clientY,
				actions: [
					{
						key: "delete",
						label: "删除",
						danger: true,
						onSelect: () => {
							deleteCanvasNodes(targetNodeIds);
						},
					},
				],
			});
		},
		[deleteCanvasNodes],
	);

	const openNodeContextMenuAt = useCallback(
		(node: CanvasNode, clientX: number, clientY: number): boolean => {
			if (!currentProject) return false;
			const targetNodeIds =
				normalizedSelectedNodeIds.includes(node.id) &&
				normalizedSelectedNodeIds.length > 0
					? normalizedSelectedNodeIds
					: [node.id];
			const definition = getCanvasNodeDefinition(node.type);
			const nodeActions = definition.contextMenu
				? definition.contextMenu({
						node,
						project: currentProject,
						sceneOptions: contextMenuSceneOptions,
						onInsertNodeToScene: (sceneId) => {
							insertNodeToScene(node, sceneId);
						},
					})
				: [];
			const actions = [
				...toTimelineContextMenuActions(nodeActions),
				{
					key: "delete",
					label: "删除",
					danger: true,
					onSelect: () => {
						deleteCanvasNodes(targetNodeIds);
					},
				},
			];
			if (actions.length === 0) return false;
			setContextMenuState({
				open: true,
				scope: "node",
				x: clientX,
				y: clientY,
				actions,
			});
			return true;
		},
		[
			contextMenuSceneOptions,
			currentProject,
			deleteCanvasNodes,
			insertNodeToScene,
			normalizedSelectedNodeIds,
			setContextMenuState,
		],
	);

	const finishCanvasMarquee = useCallback(
		(_event: MouseEvent) => {
			const marqueeSession = marqueeSessionRef.current;
			if (!marqueeSession) return;
			marqueeSessionRef.current = null;
			if (!marqueeSession.activated) {
				updateMarqueeRectState({
					visible: false,
					x1: marqueeRectRef.current.x1,
					y1: marqueeRectRef.current.y1,
					x2: marqueeRectRef.current.x2,
					y2: marqueeRectRef.current.y2,
				});
				return;
			}
			setPendingClickSuppression({
				suppressNode: true,
				suppressCanvas: true,
			});
			applyMarqueeSelection(marqueeRectRef.current);
			updateMarqueeRectState({
				visible: false,
				x1: marqueeRectRef.current.x1,
				y1: marqueeRectRef.current.y1,
				x2: marqueeRectRef.current.x2,
				y2: marqueeRectRef.current.y2,
			});
		},
		[applyMarqueeSelection, setPendingClickSuppression, updateMarqueeRectState],
	);

	const handleCanvasMouseDown = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			clearPendingClickSuppression();
			clearCanvasSnapGuides();
			if (event.button !== 0) return;
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			if (isCanvasInteractionLocked) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			if (isResizeAnchorHitAtWorldPoint(world.x, world.y)) return;
			const node = getTopHitNode(world.x, world.y);
			if (node) return;
			if (
				selectedBounds &&
				normalizedSelectedNodeIds.length > 1 &&
				isWorldPointInBounds(selectedBounds, world.x, world.y)
			) {
				return;
			}
			const local = resolveLocalPoint(event.clientX, event.clientY);
			marqueeSessionRef.current = {
				additive: event.shiftKey,
				initialSelectedNodeIds: normalizedSelectedNodeIds,
				startLocalX: local.x,
				startLocalY: local.y,
				activated: false,
			};
			updateMarqueeRectState({
				visible: false,
				x1: local.x,
				y1: local.y,
				x2: local.x,
				y2: local.y,
			});
		},
		[
			clearCanvasSnapGuides,
			getTopHitNode,
			isResizeAnchorHitAtWorldPoint,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
			resolveLocalPoint,
			resolveWorldPoint,
			selectedBounds,
			updateMarqueeRectState,
			clearPendingClickSuppression,
		],
	);

	const handleCanvasMouseMove = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const marqueeSession = marqueeSessionRef.current;
			if (!marqueeSession) return;
			const local = resolveLocalPoint(event.clientX, event.clientY);
			const deltaX = local.x - marqueeSession.startLocalX;
			const deltaY = local.y - marqueeSession.startLocalY;
			const hasActivated =
				marqueeSession.activated ||
				Math.abs(deltaX) >= CANVAS_MARQUEE_ACTIVATION_PX ||
				Math.abs(deltaY) >= CANVAS_MARQUEE_ACTIVATION_PX;
			marqueeSession.activated = hasActivated;
			const nextRect: CanvasMarqueeRect = {
				visible: hasActivated,
				x1: marqueeSession.startLocalX,
				y1: marqueeSession.startLocalY,
				x2: local.x,
				y2: local.y,
			};
			updateMarqueeRectState(nextRect);
			if (!hasActivated) return;
			applyMarqueeSelection(nextRect);
		},
		[applyMarqueeSelection, resolveLocalPoint, updateMarqueeRectState],
	);

	useEffect(() => {
		const handleWindowMouseUp = (event: MouseEvent) => {
			finishCanvasMarquee(event);
		};
		window.addEventListener("mouseup", handleWindowMouseUp);
		return () => {
			window.removeEventListener("mouseup", handleWindowMouseUp);
		};
	}, [finishCanvasMarquee]);

	const handleCanvasClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const pendingSuppression = resolvePendingClickSuppression();
			if (
				pendingSuppression &&
				(pendingSuppression.suppressCanvas || pendingSuppression.suppressNode)
			) {
				return;
			}
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			if (isCanvasInteractionLocked) return;
			if (event.shiftKey) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			if (isResizeAnchorHitAtWorldPoint(world.x, world.y)) return;
			const node = getTopHitNode(world.x, world.y);
			if (node) return;
			if (
				selectedBounds &&
				normalizedSelectedNodeIds.length > 1 &&
				isWorldPointInBounds(selectedBounds, world.x, world.y)
			) {
				return;
			}
			commitSelectedNodeIds([]);
		},
		[
			commitSelectedNodeIds,
			getTopHitNode,
			isResizeAnchorHitAtWorldPoint,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds.length,
			resolveWorldPoint,
			resolvePendingClickSuppression,
			selectedBounds,
		],
	);

	const handleCanvasContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (!isCanvasSurfaceTarget(event.target)) return;
			if (isOverlayWheelTarget(event.target)) return;
			event.preventDefault();
			if (isCanvasInteractionLocked) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (
				normalizedSelectedNodeIds.length > 1 &&
				selectedBounds &&
				isWorldPointInBounds(selectedBounds, world.x, world.y)
			) {
				if (!node || !normalizedSelectedNodeIds.includes(node.id)) {
					openDeleteContextMenuAt(
						normalizedSelectedNodeIds,
						event.clientX,
						event.clientY,
					);
					return;
				}
			}
			if (node && openNodeContextMenuAt(node, event.clientX, event.clientY)) {
				return;
			}
			if (
				normalizedSelectedNodeIds.length > 1 &&
				selectedBounds &&
				isWorldPointInBounds(selectedBounds, world.x, world.y)
			) {
				openDeleteContextMenuAt(
					normalizedSelectedNodeIds,
					event.clientX,
					event.clientY,
				);
				return;
			}
			openCanvasContextMenuAt(event.clientX, event.clientY);
		},
		[
			getTopHitNode,
			isCanvasInteractionLocked,
			normalizedSelectedNodeIds,
			openDeleteContextMenuAt,
			openCanvasContextMenuAt,
			openNodeContextMenuAt,
			resolveWorldPoint,
			selectedBounds,
		],
	);

	const closeContextMenu = useCallback(() => {
		setContextMenuState({ open: false });
	}, []);

	useEffect(() => {
		const handleDeleteKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Delete" && event.key !== "Backspace") return;
			if (event.repeat) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (isEditableKeyboardTarget(event.target)) return;
			if (normalizedSelectedNodeIds.length === 0) return;
			const activeTimelineState = runtimeManager
				?.getActiveEditTimelineRuntime()
				?.timelineStore.getState();
			if (
				activeTimelineState?.isTimelineEditorMounted &&
				(activeTimelineState.selectedIds.length > 0 ||
					activeTimelineState.isTimelineEditorHovered)
			) {
				return;
			}
			event.preventDefault();
			deleteCanvasNodes(normalizedSelectedNodeIds);
			closeContextMenu();
		};
		window.addEventListener("keydown", handleDeleteKeyDown);
		return () => {
			window.removeEventListener("keydown", handleDeleteKeyDown);
		};
	}, [
		closeContextMenu,
		deleteCanvasNodes,
		normalizedSelectedNodeIds,
		runtimeManager,
	]);

	const handleCreateTextNodeAt = useCallback(
		(worldX: number, worldY: number) => {
			const textNodeDefinition = getCanvasNodeDefinition("text");
			const nodeId = createCanvasNode({
				...textNodeDefinition.create(),
				x: worldX,
				y: worldY,
			});
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const node = latestProject.canvas.nodes.find(
				(item) => item.id === nodeId,
			);
			if (!node) return;
			pushHistory({
				kind: "canvas.node-create",
				node,
				focusNodeId: latestProject.ui.focusedNodeId,
			});
		},
		[createCanvasNode, pushHistory],
	);

	const handleCanvasDrop = useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			if (!currentProjectId || !currentProject) return;
			const files = resolveDroppedFiles(event.dataTransfer);
			if (files.length === 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const activeSceneTimeline =
				(activeSceneId
					? currentProject.scenes[activeSceneId]?.timeline
					: undefined) ?? Object.values(currentProject.scenes)[0]?.timeline;
			const fps = activeSceneTimeline?.fps ?? 30;

			const resolveExternalFile = (
				file: File,
				kind: "video" | "audio" | "image",
			) => {
				return resolveExternalFileUri(
					file,
					kind,
					currentProjectId,
					resolveExternalVideoUri,
					writeAudioToOpfs,
					writeProjectFileToOpfs,
				);
			};

			const nodeInputs: Array<{
				input: Parameters<typeof createCanvasNode>[0];
				index: number;
			}> = [];

			for (const [index, file] of files.entries()) {
				let resolvedInput: Parameters<typeof createCanvasNode>[0] | null = null;
				for (const definition of canvasNodeDefinitionList) {
					if (!definition.fromExternalFile) continue;
					const matched = await definition.fromExternalFile(file, {
						projectId: currentProjectId,
						fps,
						ensureProjectAssetByUri,
						updateProjectAssetMeta,
						resolveExternalFileUri: resolveExternalFile,
					});
					if (!matched) continue;
					resolvedInput = matched;
					break;
				}
				if (!resolvedInput) continue;
				nodeInputs.push({ input: resolvedInput, index });
			}

			for (const item of nodeInputs) {
				const column = item.index % DROP_GRID_COLUMNS;
				const row = Math.floor(item.index / DROP_GRID_COLUMNS);
				const nodeId = createCanvasNode({
					...item.input,
					x: world.x + column * DROP_GRID_OFFSET_X,
					y: world.y + row * DROP_GRID_OFFSET_Y,
				});
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) continue;
				const node = latestProject.canvas.nodes.find(
					(candidate) => candidate.id === nodeId,
				);
				if (!node) continue;
				if (node.type === "scene") continue;
				pushHistory({
					kind: "canvas.node-create",
					node,
					focusNodeId: latestProject.ui.focusedNodeId,
				});
			}
		},
		[
			activeSceneId,
			createCanvasNode,
			currentProject,
			currentProjectId,
			ensureProjectAssetByUri,
			updateProjectAssetMeta,
			pushHistory,
			resolveWorldPoint,
		],
	);

	const handleCloseDrawer = useCallback(() => {
		if (focusedNodeId) {
			setFocusedNode(null);
			return;
		}
		if (activeNodeId) {
			setActiveNode(null);
		}
	}, [activeNodeId, focusedNodeId, setActiveNode, setFocusedNode]);
	const handleEditorMouseOverCapture = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation?.();
		},
		[],
	);

	if (!currentProject) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				Loading...
			</div>
		);
	}

	const contextMenuActions = useMemo<TimelineContextMenuAction[]>(() => {
		if (!contextMenuState.open) return [];
		if (contextMenuState.scope === "node") {
			return contextMenuState.actions;
		}
		if (focusedNodeId) return [];
		return [
			{
				key: "new-text-node",
				label: "新建文本节点",
				onSelect: () => {
					handleCreateTextNodeAt(
						contextMenuState.worldX,
						contextMenuState.worldY,
					);
				},
			},
		];
	}, [contextMenuState, focusedNodeId, handleCreateTextNodeAt]);

	const toolbarLeftOffset = sidebarExpanded
		? overlayLayout.cameraSafeInsets.left + 4
		: 56;
	const toolbarTopOffset = overlayLayout.cameraSafeInsets.top + 4;
	const expandButtonOffsetX = overlayLayout.sidebarRect.x + 4;
	const expandButtonOffsetY = overlayLayout.sidebarRect.y + 4;
	const drawerBottomOffset = Math.max(
		0,
		stageSize.height -
			(overlayLayout.drawerRect.y + overlayLayout.drawerRect.height),
	);

	return (
		<div
			ref={containerRef}
			data-testid="canvas-workspace"
			role="application"
			className="relative h-full w-full overflow-hidden"
			onMouseOverCapture={handleEditorMouseOverCapture}
			onMouseDown={handleCanvasMouseDown}
			onMouseMove={handleCanvasMouseMove}
			onClick={handleCanvasClick}
			onContextMenu={handleCanvasContextMenu}
			onDragOver={(event) => {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}}
			onDrop={handleCanvasDrop}
		>
			<InfiniteSkiaCanvas
				width={stageSize.width}
				height={stageSize.height}
				camera={camera}
				nodes={sortedNodes}
				scenes={currentProject.scenes}
				assets={currentProject.assets}
				activeNodeId={activeNodeId}
				selectedNodeIds={normalizedSelectedNodeIds}
				focusedNodeId={focusedNodeId}
				snapGuidesScreen={snapGuidesScreen}
				suspendHover={isCameraAnimating}
				onNodeDragStart={handleSkiaNodeDragStart}
				onNodeDrag={handleSkiaNodeDrag}
				onNodeDragEnd={handleSkiaNodeDragEnd}
				onNodeResize={handleSkiaNodeResize}
				onSelectionDragStart={handleSelectionBoundsDragStart}
				onSelectionDrag={handleSelectionBoundsDrag}
				onSelectionDragEnd={handleSelectionBoundsDragEnd}
				onSelectionResize={handleSelectionResize}
				onNodeClick={handleSkiaNodeClick}
				onNodeDoubleClick={handleSkiaNodeDoubleClick}
			/>
			{marqueeRect.visible && (
				<div
					data-testid="canvas-selection-rect"
					className="pointer-events-none absolute z-20 border border-sky-300/70 bg-sky-400/10"
					style={{
						left: Math.min(marqueeRect.x1, marqueeRect.x2),
						top: Math.min(marqueeRect.y1, marqueeRect.y2),
						width: Math.abs(marqueeRect.x2 - marqueeRect.x1),
						height: Math.abs(marqueeRect.y2 - marqueeRect.y1),
					}}
				/>
			)}

			<CanvasWorkspaceOverlay
				toolbarLeftOffset={toolbarLeftOffset}
				toolbarTopOffset={toolbarTopOffset}
				onCreateScene={handleCreateScene}
				onZoomIn={() => handleZoomByStep(1.1)}
				onZoomOut={() => handleZoomByStep(0.9)}
				onResetView={handleResetView}
				sidebarExpanded={sidebarExpanded}
				sidebarRect={overlayLayout.sidebarRect}
				expandButtonOffsetX={expandButtonOffsetX}
				expandButtonOffsetY={expandButtonOffsetY}
				sidebarTab={sidebarTab}
				onSidebarTabChange={setSidebarTab}
				onSidebarNodeSelect={handleSidebarNodeSelect}
				onCollapseSidebar={() => setSidebarExpanded(false)}
				onExpandSidebar={() => setSidebarExpanded(true)}
				rightPanelShouldRender={rightPanelShouldRender}
				rightPanelRect={overlayLayout.rightPanelRect}
				resolvedDrawer={resolvedDrawer}
				drawerIdentity={drawerIdentity}
				drawerRect={overlayLayout.drawerRect}
				drawerBottomOffset={drawerBottomOffset}
				onDrawerHeightChange={setVisibleDrawerHeight}
				onCloseDrawer={handleCloseDrawer}
				contextMenuOpen={contextMenuState.open}
				contextMenuX={contextMenuState.open ? contextMenuState.x : 0}
				contextMenuY={contextMenuState.open ? contextMenuState.y : 0}
				contextMenuActions={contextMenuActions}
				onCloseContextMenu={closeContextMenu}
			/>
		</div>
	);
};

export default CanvasWorkspace;
