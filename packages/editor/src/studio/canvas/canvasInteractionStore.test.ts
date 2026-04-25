import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_NODE_DRAWER_DEFAULT_HEIGHT } from "./CanvasNodeDrawerShell";
import { useCanvasInteractionStore } from "./canvasInteractionStore";
import type { NodeDragSession } from "./canvasWorkspaceModel";

const resetInteractionStore = () => {
	useCanvasInteractionStore.getState().resetWorkspaceInteraction();
};

const createDragSession = (): NodeDragSession => ({
	origin: "node",
	anchorNodeId: "node-1",
	pendingSelectedNodeIds: ["node-1"],
	dragNodeIds: ["node-1"],
	initialBounds: { x: 0, y: 0, width: 100, height: 80 },
	snapshots: {
		"node-1": {
			nodeId: "node-1",
			startNodeX: 0,
			startNodeY: 0,
			before: {
				x: 0,
				y: 0,
				width: 100,
				height: 80,
				parentId: null,
				hidden: false,
				locked: false,
				siblingOrder: 0,
			},
		},
	},
	layoutBeforeByNodeId: {
		"node-1": {
			x: 0,
			y: 0,
			width: 100,
			height: 80,
			parentId: null,
			hidden: false,
			locked: false,
			siblingOrder: 0,
		},
	},
	copyEntries: [],
	activated: false,
	moved: false,
	axisLock: null,
	copyMode: false,
	timelineDropMode: false,
	timelineDropTarget: null,
	autoLayoutInsertion: null,
	autoLayoutRowsByBoardId: new Map(),
	globalDragStarted: false,
	guideValuesCache: null,
});

describe("canvasInteractionStore", () => {
	beforeEach(() => {
		resetInteractionStore();
	});

	it("resetProjectScopedInteraction 会清理项目级交互状态但保留工具和面板偏好", () => {
		const store = useCanvasInteractionStore.getState();
		store.setCanvasToolMode("board");
		store.setSidebarExpanded(false);
		store.setTileDebugEnabled(true);
		store.setSelectedNodeIds(["node-1"]);
		store.setHoveredNodeId("node-1");
		store.setContextMenuState({
			open: true,
			scope: "canvas",
			x: 1,
			y: 2,
			worldX: 3,
			worldY: 4,
		});
		store.setNodeDragSession(createDragSession());
		store.setMarqueeRect({ visible: true, x1: 1, y1: 2, x2: 3, y2: 4 });
		store.setSnapGuidesScreen({ vertical: [10], horizontal: [20] });

		store.resetProjectScopedInteraction("focused-node");
		const next = useCanvasInteractionStore.getState();

		expect(next.canvasToolMode).toBe("board");
		expect(next.sidebarExpanded).toBe(false);
		expect(next.tileDebugEnabled).toBe(true);
		expect(next.selectedNodeIds).toEqual([]);
		expect(next.hoveredNodeId).toBeNull();
		expect(next.contextMenuState.open).toBe(false);
		expect(next.nodeDragSession).toBeNull();
		expect(next.marqueeRect.visible).toBe(false);
		expect(next.snapGuidesScreen).toEqual({ vertical: [], horizontal: [] });
		expect(next.focusRestore.prevFocusedNodeId).toBe("focused-node");
	});

	it("resetWorkspaceInteraction 会恢复跨实例偏好默认值", () => {
		const store = useCanvasInteractionStore.getState();
		store.setCanvasToolMode("board");
		store.setSidebarExpanded(false);
		store.setTileDebugEnabled(true);
		store.setVisibleDrawerHeight(CANVAS_NODE_DRAWER_DEFAULT_HEIGHT + 120);
		store.setStageSize({ width: 800, height: 600 });
		store.setSelectedNodeIds(["node-1"]);

		store.resetWorkspaceInteraction();
		const next = useCanvasInteractionStore.getState();

		expect(next.canvasToolMode).toBe("move");
		expect(next.sidebarExpanded).toBe(true);
		expect(next.tileDebugEnabled).toBe(false);
		expect(next.visibleDrawerHeight).toBe(CANVAS_NODE_DRAWER_DEFAULT_HEIGHT);
		expect(next.stageSize).toEqual({ width: 0, height: 0 });
		expect(next.selectedNodeIds).toEqual([]);
	});

	it("commitSelection 会更新选区并同步 active 回调", () => {
		const onActiveNodeChange = vi.fn();
		const onActiveSceneChange = vi.fn();

		useCanvasInteractionStore.getState().commitSelection(["node-1"], {
			primaryNodeId: "node-1",
			primarySceneId: "scene-1",
			onActiveNodeChange,
			onActiveSceneChange,
		});

		expect(useCanvasInteractionStore.getState().selectedNodeIds).toEqual([
			"node-1",
		]);
		expect(onActiveNodeChange).toHaveBeenCalledWith("node-1");
		expect(onActiveSceneChange).toHaveBeenCalledWith("scene-1");
	});

	it("会话 action 可以 begin 和 patch node drag session", () => {
		const store = useCanvasInteractionStore.getState();
		store.setNodeDragSession(createDragSession());
		store.patchNodeDragSession({ moved: true, axisLock: "x" });

		expect(useCanvasInteractionStore.getState().nodeDragSession).toMatchObject({
			moved: true,
			axisLock: "x",
		});
	});

	it("pending click suppression 只会被消费一次", () => {
		const store = useCanvasInteractionStore.getState();
		store.setPendingClickSuppression({
			suppressCanvas: true,
			suppressNode: false,
		});

		expect(store.consumePendingClickSuppression()).toEqual({
			suppressCanvas: true,
			suppressNode: false,
		});
		expect(
			useCanvasInteractionStore.getState().consumePendingClickSuppression(),
		).toBeNull();
	});

	it("会清理 marquee 和 board-create 预览", () => {
		const store = useCanvasInteractionStore.getState();
		store.setMarqueeSession({
			additive: false,
			initialSelectedNodeIds: [],
			startLocalX: 1,
			startLocalY: 2,
			activated: true,
		});
		store.setMarqueeRect({ visible: true, x1: 1, y1: 2, x2: 3, y2: 4 });
		store.clearMarqueePreview();
		expect(useCanvasInteractionStore.getState().marqueeSession).toBeNull();
		expect(useCanvasInteractionStore.getState().marqueeRect.visible).toBe(
			false,
		);

		store.setBoardCreateSession({
			startWorldX: 0,
			startWorldY: 0,
			startLocalX: 0,
			startLocalY: 0,
			activated: true,
			currentWorldX: 10,
			currentWorldY: 10,
			currentLocalX: 10,
			currentLocalY: 10,
		});
		store.setMarqueeRect({ visible: true, x1: 1, y1: 2, x2: 3, y2: 4 });
		store.clearBoardCreatePreview();
		expect(useCanvasInteractionStore.getState().boardCreateSession).toBeNull();
		expect(useCanvasInteractionStore.getState().marqueeRect.visible).toBe(
			false,
		);
	});
});
