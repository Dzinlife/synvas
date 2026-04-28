import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { CanvasBoardAutoLayoutIndicator } from "./canvasBoardAutoLayout";
import type { CanvasSnapGuidesScreen } from "./canvasSnapUtils";
import { EMPTY_CANVAS_SNAP_GUIDES_SCREEN } from "./canvasSnapUtils";
import { CANVAS_NODE_DRAWER_DEFAULT_HEIGHT } from "./CanvasNodeDrawerShell";
import {
	CANVAS_DEFAULT_TOOL_MODE,
	type CanvasToolMode,
} from "./canvasToolMode";
import type { CameraState } from "./canvasWorkspaceUtils";
import type {
	BoardCreateSession,
	CanvasBasePointerSession,
	CanvasContextMenuState,
	CanvasMarqueeRect,
	CanvasMarqueeSession,
	CanvasTapRecord,
	NodeDragSession,
	NodeResizeSession,
	PendingCanvasClickSuppression,
	SelectionResizeSession,
} from "./canvasWorkspaceModel";

type CanvasResizeCursor = "nwse-resize" | "nesw-resize" | null;
type CanvasPoint = { x: number; y: number };
type FocusRestoreState = {
	preFocusCamera: CameraState | null;
	preFocusCameraCenter: CanvasPoint | null;
	focusCameraZoom: number | null;
	prevFocusedNodeId: string | null;
};
type ActiveDrawerAutoPanState = {
	nodeKey: string | null;
	signature: string | null;
};
type CanvasInteractionStoreValues = Omit<
	CanvasInteractionStoreState,
	| "setStageSize"
	| "setCanvasToolMode"
	| "setVisibleDrawerHeight"
	| "setContextMenuState"
	| "setSelectedNodeIds"
	| "commitSelection"
	| "setHoveredNodeId"
	| "setCanvasResizeCursor"
	| "setMarqueeRect"
	| "setSnapGuidesScreen"
	| "setBoardAutoLayoutIndicator"
	| "setAutoLayoutAnimatedNodeIds"
	| "setAutoLayoutFrozenNodeIds"
	| "setSelectionResizeFrozenNodeIds"
	| "setSidebarExpanded"
	| "setTileDebugEnabled"
	| "setIsTileTaskBoostActive"
	| "setNodeDragSession"
	| "patchNodeDragSession"
	| "setNodeResizeSession"
	| "patchNodeResizeSession"
	| "setSelectionResizeSession"
	| "patchSelectionResizeSession"
	| "setMarqueeSession"
	| "patchMarqueeSession"
	| "setBoardCreateSession"
	| "patchBoardCreateSession"
	| "setPendingClickSuppression"
	| "consumePendingClickSuppression"
	| "setPointerSession"
	| "setLastTapRecord"
	| "setLastPointerClient"
	| "setLastCanvasPointerWorld"
	| "setFocusRestore"
	| "resetFocusRestore"
	| "setActiveDrawerAutoPan"
	| "resetActiveDrawerAutoPan"
	| "clearMarqueePreview"
	| "clearBoardCreatePreview"
	| "clearGestureSessions"
	| "resetProjectScopedInteraction"
	| "resetWorkspaceInteraction"
>;

const createEmptyMarqueeRect = (): CanvasMarqueeRect => ({
	visible: false,
	x1: 0,
	y1: 0,
	x2: 0,
	y2: 0,
});

const createEmptyFocusRestoreState = (
	prevFocusedNodeId: string | null = null,
): FocusRestoreState => ({
	preFocusCamera: null,
	preFocusCameraCenter: null,
	focusCameraZoom: null,
	prevFocusedNodeId,
});

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
};

const areNumberArraysEqual = (left: number[], right: number[]): boolean => {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
};

const areCanvasPointsEqual = (
	left: CanvasPoint | null,
	right: CanvasPoint | null,
): boolean => {
	if (left === right) return true;
	if (!left || !right) return left === right;
	return left.x === right.x && left.y === right.y;
};

const areCameraStatesEqual = (
	left: CameraState | null,
	right: CameraState | null,
): boolean => {
	if (left === right) return true;
	if (!left || !right) return left === right;
	return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
};

const areFocusRestoreStatesEqual = (
	left: FocusRestoreState,
	right: FocusRestoreState,
): boolean => {
	return (
		areCameraStatesEqual(left.preFocusCamera, right.preFocusCamera) &&
		areCanvasPointsEqual(
			left.preFocusCameraCenter,
			right.preFocusCameraCenter,
		) &&
		left.focusCameraZoom === right.focusCameraZoom &&
		left.prevFocusedNodeId === right.prevFocusedNodeId
	);
};

const areMarqueeRectsEqual = (
	left: CanvasMarqueeRect,
	right: CanvasMarqueeRect,
): boolean => {
	return (
		left.visible === right.visible &&
		left.x1 === right.x1 &&
		left.y1 === right.y1 &&
		left.x2 === right.x2 &&
		left.y2 === right.y2
	);
};

const areSnapGuidesScreenEqual = (
	left: CanvasSnapGuidesScreen,
	right: CanvasSnapGuidesScreen,
): boolean => {
	if (left === right) return true;
	return (
		areNumberArraysEqual(left.vertical, right.vertical) &&
		areNumberArraysEqual(left.horizontal, right.horizontal)
	);
};

const createInitialCanvasInteractionValues =
	(): CanvasInteractionStoreValues => ({
		stageSize: { width: 0, height: 0 },
		canvasToolMode: CANVAS_DEFAULT_TOOL_MODE,
		visibleDrawerHeight: CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
		contextMenuState: { open: false },
		selectedNodeIds: [],
		hoveredNodeId: null,
		canvasResizeCursor: null,
		marqueeRect: createEmptyMarqueeRect(),
		snapGuidesScreen: EMPTY_CANVAS_SNAP_GUIDES_SCREEN,
		boardAutoLayoutIndicator: null,
		autoLayoutAnimatedNodeIds: [],
		autoLayoutFrozenNodeIds: [],
		selectionResizeFrozenNodeIds: [],
		sidebarExpanded: true,
		tileDebugEnabled: false,
		isTileTaskBoostActive: false,
		nodeDragSession: null,
		nodeResizeSession: null,
		selectionResizeSession: null,
		marqueeSession: null,
		boardCreateSession: null,
		pendingClickSuppression: null,
		pointerSession: null,
		lastTapRecord: null,
		lastPointerClient: null,
		lastCanvasPointerWorld: null,
		focusRestore: createEmptyFocusRestoreState(),
		activeDrawerAutoPan: { nodeKey: null, signature: null },
	});

export interface CanvasInteractionStoreState {
	stageSize: { width: number; height: number };
	canvasToolMode: CanvasToolMode;
	visibleDrawerHeight: number;
	contextMenuState: CanvasContextMenuState;
	selectedNodeIds: string[];
	hoveredNodeId: string | null;
	canvasResizeCursor: CanvasResizeCursor;
	marqueeRect: CanvasMarqueeRect;
	snapGuidesScreen: CanvasSnapGuidesScreen;
	boardAutoLayoutIndicator: CanvasBoardAutoLayoutIndicator | null;
	autoLayoutAnimatedNodeIds: string[];
	autoLayoutFrozenNodeIds: string[];
	selectionResizeFrozenNodeIds: string[];
	sidebarExpanded: boolean;
	tileDebugEnabled: boolean;
	isTileTaskBoostActive: boolean;
	nodeDragSession: NodeDragSession | null;
	nodeResizeSession: NodeResizeSession | null;
	selectionResizeSession: SelectionResizeSession | null;
	marqueeSession: CanvasMarqueeSession | null;
	boardCreateSession: BoardCreateSession | null;
	pendingClickSuppression: PendingCanvasClickSuppression | null;
	pointerSession: CanvasBasePointerSession | null;
	lastTapRecord: CanvasTapRecord | null;
	lastPointerClient: CanvasPoint | null;
	lastCanvasPointerWorld: CanvasPoint | null;
	focusRestore: FocusRestoreState;
	activeDrawerAutoPan: ActiveDrawerAutoPanState;
	setStageSize: (size: { width: number; height: number }) => void;
	setCanvasToolMode: (mode: CanvasToolMode) => void;
	setVisibleDrawerHeight: (height: number) => void;
	setContextMenuState: (state: CanvasContextMenuState) => void;
	setSelectedNodeIds: (nodeIds: string[]) => void;
	commitSelection: (
		nodeIds: string[],
		options?: {
			primaryNodeId?: string | null;
			primarySceneId?: string | null;
			onActiveNodeChange?: (nodeId: string | null) => void;
			onActiveSceneChange?: (sceneId: string) => void;
		},
	) => void;
	setHoveredNodeId: (nodeId: string | null) => void;
	setCanvasResizeCursor: (cursor: CanvasResizeCursor) => void;
	setMarqueeRect: (rect: CanvasMarqueeRect) => void;
	setSnapGuidesScreen: (guides: CanvasSnapGuidesScreen) => void;
	setBoardAutoLayoutIndicator: (
		indicator: CanvasBoardAutoLayoutIndicator | null,
	) => void;
	setAutoLayoutAnimatedNodeIds: (nodeIds: string[]) => void;
	setAutoLayoutFrozenNodeIds: (nodeIds: string[]) => void;
	setSelectionResizeFrozenNodeIds: (nodeIds: string[]) => void;
	setSidebarExpanded: (expanded: boolean) => void;
	setTileDebugEnabled: (enabled: boolean) => void;
	setIsTileTaskBoostActive: (active: boolean) => void;
	setNodeDragSession: (session: NodeDragSession | null) => void;
	patchNodeDragSession: (patch: Partial<NodeDragSession>) => void;
	setNodeResizeSession: (session: NodeResizeSession | null) => void;
	patchNodeResizeSession: (patch: Partial<NodeResizeSession>) => void;
	setSelectionResizeSession: (session: SelectionResizeSession | null) => void;
	patchSelectionResizeSession: (patch: Partial<SelectionResizeSession>) => void;
	setMarqueeSession: (session: CanvasMarqueeSession | null) => void;
	patchMarqueeSession: (patch: Partial<CanvasMarqueeSession>) => void;
	setBoardCreateSession: (session: BoardCreateSession | null) => void;
	patchBoardCreateSession: (patch: Partial<BoardCreateSession>) => void;
	setPendingClickSuppression: (
		suppression: PendingCanvasClickSuppression | null,
	) => void;
	consumePendingClickSuppression: () => PendingCanvasClickSuppression | null;
	setPointerSession: (session: CanvasBasePointerSession | null) => void;
	setLastTapRecord: (record: CanvasTapRecord | null) => void;
	setLastPointerClient: (point: CanvasPoint | null) => void;
	setLastCanvasPointerWorld: (point: CanvasPoint | null) => void;
	setFocusRestore: (patch: Partial<FocusRestoreState>) => void;
	resetFocusRestore: (prevFocusedNodeId?: string | null) => void;
	setActiveDrawerAutoPan: (patch: Partial<ActiveDrawerAutoPanState>) => void;
	resetActiveDrawerAutoPan: () => void;
	clearMarqueePreview: () => void;
	clearBoardCreatePreview: () => void;
	clearGestureSessions: () => void;
	resetProjectScopedInteraction: (focusedNodeId?: string | null) => void;
	resetWorkspaceInteraction: () => void;
}

export const useCanvasInteractionStore = create<CanvasInteractionStoreState>()(
	subscribeWithSelector((set, get) => ({
		...createInitialCanvasInteractionValues(),
		setStageSize: (stageSize) =>
			set((state) =>
				state.stageSize.width === stageSize.width &&
				state.stageSize.height === stageSize.height
					? state
					: { stageSize },
			),
		setCanvasToolMode: (mode) =>
			set((state) =>
				state.canvasToolMode === mode ? state : { canvasToolMode: mode },
			),
		setVisibleDrawerHeight: (height) =>
			set((state) =>
				state.visibleDrawerHeight === height
					? state
					: { visibleDrawerHeight: height },
			),
		setContextMenuState: (contextMenuState) => set({ contextMenuState }),
		setSelectedNodeIds: (selectedNodeIds) =>
			set((state) =>
				areStringArraysEqual(state.selectedNodeIds, selectedNodeIds)
					? state
					: { selectedNodeIds },
			),
		commitSelection: (selectedNodeIds, options) => {
			set((state) =>
				areStringArraysEqual(state.selectedNodeIds, selectedNodeIds)
					? state
					: { selectedNodeIds },
			);
			const primaryNodeId =
				options?.primaryNodeId === undefined
					? (selectedNodeIds[selectedNodeIds.length - 1] ?? null)
					: options.primaryNodeId;
			options?.onActiveNodeChange?.(primaryNodeId);
			if (options?.primarySceneId) {
				options.onActiveSceneChange?.(options.primarySceneId);
			}
		},
		setHoveredNodeId: (hoveredNodeId) =>
			set((state) =>
				state.hoveredNodeId === hoveredNodeId ? state : { hoveredNodeId },
			),
		setCanvasResizeCursor: (canvasResizeCursor) =>
			set((state) =>
				state.canvasResizeCursor === canvasResizeCursor
					? state
					: { canvasResizeCursor },
			),
		setMarqueeRect: (marqueeRect) =>
			set((state) =>
				areMarqueeRectsEqual(state.marqueeRect, marqueeRect)
					? state
					: { marqueeRect },
			),
		setSnapGuidesScreen: (snapGuidesScreen) =>
			set((state) =>
				areSnapGuidesScreenEqual(state.snapGuidesScreen, snapGuidesScreen)
					? state
					: { snapGuidesScreen },
			),
		setBoardAutoLayoutIndicator: (boardAutoLayoutIndicator) =>
			set((state) =>
				state.boardAutoLayoutIndicator === boardAutoLayoutIndicator
					? state
					: { boardAutoLayoutIndicator },
			),
		setAutoLayoutAnimatedNodeIds: (autoLayoutAnimatedNodeIds) =>
			set((state) =>
				areStringArraysEqual(
					state.autoLayoutAnimatedNodeIds,
					autoLayoutAnimatedNodeIds,
				)
					? state
					: { autoLayoutAnimatedNodeIds },
			),
		setAutoLayoutFrozenNodeIds: (autoLayoutFrozenNodeIds) =>
			set((state) =>
				areStringArraysEqual(
					state.autoLayoutFrozenNodeIds,
					autoLayoutFrozenNodeIds,
				)
					? state
					: { autoLayoutFrozenNodeIds },
			),
		setSelectionResizeFrozenNodeIds: (selectionResizeFrozenNodeIds) =>
			set((state) =>
				areStringArraysEqual(
					state.selectionResizeFrozenNodeIds,
					selectionResizeFrozenNodeIds,
				)
					? state
					: { selectionResizeFrozenNodeIds },
			),
		setSidebarExpanded: (sidebarExpanded) =>
			set((state) =>
				state.sidebarExpanded === sidebarExpanded ? state : { sidebarExpanded },
			),
		setTileDebugEnabled: (tileDebugEnabled) =>
			set((state) =>
				state.tileDebugEnabled === tileDebugEnabled
					? state
					: { tileDebugEnabled },
			),
		setIsTileTaskBoostActive: (isTileTaskBoostActive) =>
			set((state) =>
				state.isTileTaskBoostActive === isTileTaskBoostActive
					? state
					: { isTileTaskBoostActive },
			),
		setNodeDragSession: (nodeDragSession) =>
			set((state) =>
				state.nodeDragSession === nodeDragSession ? state : { nodeDragSession },
			),
		patchNodeDragSession: (patch) => {
			const nodeDragSession = get().nodeDragSession;
			if (!nodeDragSession) return;
			set({ nodeDragSession: { ...nodeDragSession, ...patch } });
		},
		setNodeResizeSession: (nodeResizeSession) =>
			set((state) =>
				state.nodeResizeSession === nodeResizeSession
					? state
					: { nodeResizeSession },
			),
		patchNodeResizeSession: (patch) => {
			const nodeResizeSession = get().nodeResizeSession;
			if (!nodeResizeSession) return;
			set({ nodeResizeSession: { ...nodeResizeSession, ...patch } });
		},
		setSelectionResizeSession: (selectionResizeSession) =>
			set((state) =>
				state.selectionResizeSession === selectionResizeSession
					? state
					: { selectionResizeSession },
			),
		patchSelectionResizeSession: (patch) => {
			const selectionResizeSession = get().selectionResizeSession;
			if (!selectionResizeSession) return;
			set({
				selectionResizeSession: { ...selectionResizeSession, ...patch },
			});
		},
		setMarqueeSession: (marqueeSession) =>
			set((state) =>
				state.marqueeSession === marqueeSession ? state : { marqueeSession },
			),
		patchMarqueeSession: (patch) => {
			const marqueeSession = get().marqueeSession;
			if (!marqueeSession) return;
			set({ marqueeSession: { ...marqueeSession, ...patch } });
		},
		setBoardCreateSession: (boardCreateSession) =>
			set((state) =>
				state.boardCreateSession === boardCreateSession
					? state
					: { boardCreateSession },
			),
		patchBoardCreateSession: (patch) => {
			const boardCreateSession = get().boardCreateSession;
			if (!boardCreateSession) return;
			set({ boardCreateSession: { ...boardCreateSession, ...patch } });
		},
		setPendingClickSuppression: (pendingClickSuppression) =>
			set((state) =>
				state.pendingClickSuppression === pendingClickSuppression
					? state
					: { pendingClickSuppression },
			),
		consumePendingClickSuppression: () => {
			const pendingClickSuppression = get().pendingClickSuppression;
			if (!pendingClickSuppression) return null;
			set({ pendingClickSuppression: null });
			return pendingClickSuppression;
		},
		setPointerSession: (pointerSession) =>
			set((state) =>
				state.pointerSession === pointerSession ? state : { pointerSession },
			),
		setLastTapRecord: (lastTapRecord) =>
			set((state) =>
				state.lastTapRecord === lastTapRecord ? state : { lastTapRecord },
			),
		setLastPointerClient: (lastPointerClient) =>
			set((state) =>
				areCanvasPointsEqual(state.lastPointerClient, lastPointerClient)
					? state
					: { lastPointerClient },
			),
		setLastCanvasPointerWorld: (lastCanvasPointerWorld) =>
			set((state) =>
				areCanvasPointsEqual(
					state.lastCanvasPointerWorld,
					lastCanvasPointerWorld,
				)
					? state
					: { lastCanvasPointerWorld },
			),
		setFocusRestore: (patch) =>
			set((state) => {
				const focusRestore = { ...state.focusRestore, ...patch };
				return areFocusRestoreStatesEqual(state.focusRestore, focusRestore)
					? state
					: { focusRestore };
			}),
		resetFocusRestore: (prevFocusedNodeId = null) =>
			set((state) => {
				const focusRestore = createEmptyFocusRestoreState(prevFocusedNodeId);
				return areFocusRestoreStatesEqual(state.focusRestore, focusRestore)
					? state
					: { focusRestore };
			}),
		setActiveDrawerAutoPan: (patch) =>
			set((state) => {
				const activeDrawerAutoPan = {
					...state.activeDrawerAutoPan,
					...patch,
				};
				return state.activeDrawerAutoPan.nodeKey ===
					activeDrawerAutoPan.nodeKey &&
					state.activeDrawerAutoPan.signature === activeDrawerAutoPan.signature
					? state
					: { activeDrawerAutoPan };
			}),
		resetActiveDrawerAutoPan: () =>
			set((state) =>
				state.activeDrawerAutoPan.nodeKey === null &&
				state.activeDrawerAutoPan.signature === null
					? state
					: { activeDrawerAutoPan: { nodeKey: null, signature: null } },
			),
		clearMarqueePreview: () =>
			set({ marqueeSession: null, marqueeRect: createEmptyMarqueeRect() }),
		clearBoardCreatePreview: () =>
			set({ boardCreateSession: null, marqueeRect: createEmptyMarqueeRect() }),
		clearGestureSessions: () =>
			set({
				nodeDragSession: null,
				nodeResizeSession: null,
				selectionResizeSession: null,
				marqueeSession: null,
				boardCreateSession: null,
				pendingClickSuppression: null,
				pointerSession: null,
				lastTapRecord: null,
				isTileTaskBoostActive: false,
			}),
		resetProjectScopedInteraction: (focusedNodeId = null) =>
			set({
				contextMenuState: { open: false },
				selectedNodeIds: [],
				hoveredNodeId: null,
				canvasResizeCursor: null,
				marqueeRect: createEmptyMarqueeRect(),
				snapGuidesScreen: EMPTY_CANVAS_SNAP_GUIDES_SCREEN,
				boardAutoLayoutIndicator: null,
				autoLayoutAnimatedNodeIds: [],
				autoLayoutFrozenNodeIds: [],
				selectionResizeFrozenNodeIds: [],
				nodeDragSession: null,
				nodeResizeSession: null,
				selectionResizeSession: null,
				marqueeSession: null,
				boardCreateSession: null,
				pendingClickSuppression: null,
				pointerSession: null,
				lastTapRecord: null,
				lastPointerClient: null,
				lastCanvasPointerWorld: null,
				focusRestore: createEmptyFocusRestoreState(focusedNodeId),
				activeDrawerAutoPan: { nodeKey: null, signature: null },
				isTileTaskBoostActive: false,
			}),
		resetWorkspaceInteraction: () =>
			set(createInitialCanvasInteractionValues()),
	})),
);
