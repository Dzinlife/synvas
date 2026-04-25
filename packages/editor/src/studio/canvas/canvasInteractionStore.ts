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
		setStageSize: (stageSize) => set({ stageSize }),
		setCanvasToolMode: (mode) => set({ canvasToolMode: mode }),
		setVisibleDrawerHeight: (height) => set({ visibleDrawerHeight: height }),
		setContextMenuState: (contextMenuState) => set({ contextMenuState }),
		setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
		commitSelection: (selectedNodeIds, options) => {
			set({ selectedNodeIds });
			const primaryNodeId =
				options?.primaryNodeId === undefined
					? (selectedNodeIds[selectedNodeIds.length - 1] ?? null)
					: options.primaryNodeId;
			options?.onActiveNodeChange?.(primaryNodeId);
			if (options?.primarySceneId) {
				options.onActiveSceneChange?.(options.primarySceneId);
			}
		},
		setHoveredNodeId: (hoveredNodeId) => set({ hoveredNodeId }),
		setCanvasResizeCursor: (canvasResizeCursor) => set({ canvasResizeCursor }),
		setMarqueeRect: (marqueeRect) => set({ marqueeRect }),
		setSnapGuidesScreen: (snapGuidesScreen) => set({ snapGuidesScreen }),
		setBoardAutoLayoutIndicator: (boardAutoLayoutIndicator) =>
			set({ boardAutoLayoutIndicator }),
		setAutoLayoutAnimatedNodeIds: (autoLayoutAnimatedNodeIds) =>
			set({ autoLayoutAnimatedNodeIds }),
		setAutoLayoutFrozenNodeIds: (autoLayoutFrozenNodeIds) =>
			set({ autoLayoutFrozenNodeIds }),
		setSelectionResizeFrozenNodeIds: (selectionResizeFrozenNodeIds) =>
			set({ selectionResizeFrozenNodeIds }),
		setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
		setTileDebugEnabled: (tileDebugEnabled) => set({ tileDebugEnabled }),
		setIsTileTaskBoostActive: (isTileTaskBoostActive) =>
			set({ isTileTaskBoostActive }),
		setNodeDragSession: (nodeDragSession) => set({ nodeDragSession }),
		patchNodeDragSession: (patch) => {
			const nodeDragSession = get().nodeDragSession;
			if (!nodeDragSession) return;
			set({ nodeDragSession: { ...nodeDragSession, ...patch } });
		},
		setNodeResizeSession: (nodeResizeSession) => set({ nodeResizeSession }),
		patchNodeResizeSession: (patch) => {
			const nodeResizeSession = get().nodeResizeSession;
			if (!nodeResizeSession) return;
			set({ nodeResizeSession: { ...nodeResizeSession, ...patch } });
		},
		setSelectionResizeSession: (selectionResizeSession) =>
			set({ selectionResizeSession }),
		patchSelectionResizeSession: (patch) => {
			const selectionResizeSession = get().selectionResizeSession;
			if (!selectionResizeSession) return;
			set({
				selectionResizeSession: { ...selectionResizeSession, ...patch },
			});
		},
		setMarqueeSession: (marqueeSession) => set({ marqueeSession }),
		patchMarqueeSession: (patch) => {
			const marqueeSession = get().marqueeSession;
			if (!marqueeSession) return;
			set({ marqueeSession: { ...marqueeSession, ...patch } });
		},
		setBoardCreateSession: (boardCreateSession) => set({ boardCreateSession }),
		patchBoardCreateSession: (patch) => {
			const boardCreateSession = get().boardCreateSession;
			if (!boardCreateSession) return;
			set({ boardCreateSession: { ...boardCreateSession, ...patch } });
		},
		setPendingClickSuppression: (pendingClickSuppression) =>
			set({ pendingClickSuppression }),
		consumePendingClickSuppression: () => {
			const pendingClickSuppression = get().pendingClickSuppression;
			if (!pendingClickSuppression) return null;
			set({ pendingClickSuppression: null });
			return pendingClickSuppression;
		},
		setPointerSession: (pointerSession) => set({ pointerSession }),
		setLastTapRecord: (lastTapRecord) => set({ lastTapRecord }),
		setLastPointerClient: (lastPointerClient) => set({ lastPointerClient }),
		setLastCanvasPointerWorld: (lastCanvasPointerWorld) =>
			set({ lastCanvasPointerWorld }),
		setFocusRestore: (patch) =>
			set((state) => ({
				focusRestore: { ...state.focusRestore, ...patch },
			})),
		resetFocusRestore: (prevFocusedNodeId = null) =>
			set({ focusRestore: createEmptyFocusRestoreState(prevFocusedNodeId) }),
		setActiveDrawerAutoPan: (patch) =>
			set((state) => ({
				activeDrawerAutoPan: { ...state.activeDrawerAutoPan, ...patch },
			})),
		resetActiveDrawerAutoPan: () =>
			set({ activeDrawerAutoPan: { nodeKey: null, signature: null } }),
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
