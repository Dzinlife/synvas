import { useMemo } from "react";
import type { useProjectStore } from "@/projects/projectStore";
import { CANVAS_NODE_DRAWER_DEFAULT_HEIGHT } from "@/studio/canvas/CanvasNodeDrawerShell";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type { CanvasNode } from "@/studio/project/types";
import {
	CANVAS_OVERLAY_GAP_PX,
	CANVAS_OVERLAY_OUTER_PADDING_PX,
	CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX,
	CANVAS_OVERLAY_SIDEBAR_WIDTH_PX,
	resolveCanvasOverlayLayout,
} from "./canvasOverlayLayout";
import {
	resolveDrawerOptions,
	resolveDynamicMinZoom,
} from "./canvasWorkspaceUtils";
import type {
	AnyCanvasDrawer,
	ResolvedNodeDrawer,
	ResolvedNodeDrawerTarget,
} from "./canvasWorkspaceModel";

type CanvasProject = NonNullable<
	ReturnType<typeof useProjectStore.getState>["currentProject"]
>;

type UseCanvasWorkspaceOverlayStateParams = {
	project: CanvasProject | null;
	focusedNode: CanvasNode | null;
	activeNode: CanvasNode | null;
	stageSize: { width: number; height: number };
	sidebarExpanded: boolean;
	visibleDrawerHeight: number;
};

export const useCanvasWorkspaceOverlayState = ({
	project,
	focusedNode,
	activeNode,
	stageSize,
	sidebarExpanded,
	visibleDrawerHeight,
}: UseCanvasWorkspaceOverlayStateParams) => {
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
			node.type === "scene" ? (project?.scenes[node.sceneId] ?? null) : null;
		const asset =
			"assetId" in node
				? (project?.assets.find((item) => item.id === node.assetId) ?? null)
				: null;
		return {
			...resolvedDrawerTarget,
			scene,
			asset,
		};
	}, [project, resolvedDrawerTarget]);

	const isSidebarFocusMode = focusedNode?.type === "scene";
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
	const dynamicMinZoom = useMemo(() => {
		return resolveDynamicMinZoom({
			nodes: project?.canvas.nodes ?? [],
			stageWidth: stageSize.width,
			stageHeight: stageSize.height,
			safeInsets: {
				top: CANVAS_OVERLAY_OUTER_PADDING_PX,
				bottom: CANVAS_OVERLAY_OUTER_PADDING_PX,
				left:
					CANVAS_OVERLAY_OUTER_PADDING_PX +
					CANVAS_OVERLAY_SIDEBAR_WIDTH_PX +
					CANVAS_OVERLAY_GAP_PX,
				right:
					CANVAS_OVERLAY_OUTER_PADDING_PX +
					CANVAS_OVERLAY_RIGHT_PANEL_WIDTH_PX +
					CANVAS_OVERLAY_GAP_PX,
			},
		});
	}, [project, stageSize.height, stageSize.width]);
	const rightPanelShouldRender =
		rightPanelVisible &&
		overlayLayout.rightPanelRect.width > 0 &&
		overlayLayout.rightPanelRect.height > 0;

	return {
		cameraSafeInsets,
		drawerDefaultHeight,
		drawerIdentity,
		drawerVisible,
		dynamicMinZoom,
		isSidebarFocusMode,
		overlayLayout,
		resolvedDrawer,
		resolvedDrawerTarget,
		rightPanelShouldRender,
		rightPanelVisible,
	};
};
