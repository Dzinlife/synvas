import type { TimelineAsset, TimelineElement } from "core/element/types";
import type { CanvasNode, SceneDocument, SceneNode } from "core/studio/types";
import { PanelLeftOpen, Plus, Search, SearchX } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { SnapIcon } from "@/components/icons";
import { useProjectStore } from "@/projects/projectStore";
import ElementSettingsPanel from "@/scene-editor/components/ElementSettingsPanel";
import TimelineContextMenu, {
	type TimelineContextMenuAction,
} from "@/scene-editor/components/TimelineContextMenu";
import CanvasNodeDrawerShell from "@/studio/canvas/CanvasNodeDrawerShell";
import { getCanvasNodeDefinition } from "@/studio/canvas/node-system/registry";
import type { CanvasNodeDrawerProps } from "@/studio/canvas/node-system/types";
import CanvasSidebar, {
	type CanvasSidebarTab,
} from "@/studio/canvas/sidebar/CanvasSidebar";
import CanvasActiveNodeMetaPanel from "./CanvasActiveNodeMetaPanel";
import type { ResolvedCanvasDrawerOptions } from "./canvasWorkspaceUtils";

interface OverlayRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface DrawerViewData {
	Drawer: React.FC<CanvasNodeDrawerProps<CanvasNode>>;
	node: CanvasNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
	options: ResolvedCanvasDrawerOptions;
}

interface CanvasWorkspaceOverlayProps {
	toolbarLeftOffset: number;
	toolbarTopOffset: number;
	onCreateScene: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onResetView: () => void;
	sidebarExpanded: boolean;
	sidebarRect: OverlayRect;
	expandButtonOffsetX: number;
	expandButtonOffsetY: number;
	sidebarTab: CanvasSidebarTab;
	onSidebarTabChange: (tab: CanvasSidebarTab) => void;
	onSidebarNodeSelect: (node: CanvasNode) => void;
	onCollapseSidebar: () => void;
	onExpandSidebar: () => void;
	rightPanelShouldRender: boolean;
	selectedTimelineElement: TimelineElement | null;
	rightPanelRect: OverlayRect;
	resolvedDrawer: DrawerViewData | null;
	drawerIdentity: string | null;
	drawerRect: OverlayRect;
	drawerBottomOffset: number;
	onDrawerHeightChange: (height: number) => void;
	onCloseDrawer: () => void;
	contextMenuOpen: boolean;
	contextMenuX: number;
	contextMenuY: number;
	contextMenuActions: TimelineContextMenuAction[];
	onCloseContextMenu: () => void;
}

const isProjectEqualExceptCamera = (
	left: { currentProject: ReturnType<typeof useProjectStore.getState>["currentProject"] },
	right: {
		currentProject: ReturnType<typeof useProjectStore.getState>["currentProject"];
	},
): boolean => {
	const leftProject = left.currentProject;
	const rightProject = right.currentProject;
	if (leftProject === rightProject) return true;
	if (!leftProject || !rightProject) return leftProject === rightProject;
	return (
		leftProject.id === rightProject.id &&
		leftProject.revision === rightProject.revision &&
		leftProject.canvas === rightProject.canvas &&
		leftProject.scenes === rightProject.scenes &&
		leftProject.assets === rightProject.assets &&
		leftProject.ot === rightProject.ot &&
		leftProject.ui === rightProject.ui &&
		leftProject.createdAt === rightProject.createdAt &&
		leftProject.updatedAt === rightProject.updatedAt
	);
};

const CameraZoomBadge = () => {
	const cameraZoom = useProjectStore((state) => state.currentProject?.camera.zoom ?? 1);
	return <span className="text-white/70">{Math.round(cameraZoom * 100)}%</span>;
};

const CanvasWorkspaceOverlay = ({
	toolbarLeftOffset,
	toolbarTopOffset,
	onCreateScene,
	onZoomIn,
	onZoomOut,
	onResetView,
	sidebarExpanded,
	sidebarRect,
	expandButtonOffsetX,
	expandButtonOffsetY,
	sidebarTab,
	onSidebarTabChange,
	onSidebarNodeSelect,
	onCollapseSidebar,
	onExpandSidebar,
	rightPanelShouldRender,
	selectedTimelineElement,
	rightPanelRect,
	resolvedDrawer,
	drawerIdentity,
	drawerRect,
	drawerBottomOffset,
	onDrawerHeightChange,
	onCloseDrawer,
	contextMenuOpen,
	contextMenuX,
	contextMenuY,
	contextMenuActions,
	onCloseContextMenu,
}: CanvasWorkspaceOverlayProps) => {
	const { currentProject } = useStoreWithEqualityFn(
		useProjectStore,
		(state) => ({
			currentProject: state.currentProject,
		}),
		isProjectEqualExceptCamera,
	);
	const updateCanvasNode = useProjectStore((state) => state.updateCanvasNode);
	const setFocusedNode = useProjectStore((state) => state.setFocusedNode);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setCanvasSnapEnabled = useProjectStore(
		(state) => state.setCanvasSnapEnabled,
	);
	const focusedNodeId = currentProject?.ui.focusedNodeId ?? null;
	const activeNodeId = currentProject?.ui.activeNodeId ?? null;
	const canvasSnapEnabled = currentProject?.ui.canvasSnapEnabled ?? true;
	const sidebarNodes = useMemo(() => {
		if (!currentProject) return [];
		return [...currentProject.canvas.nodes].sort((left, right) => {
			if (left.zIndex !== right.zIndex) return right.zIndex - left.zIndex;
			return right.createdAt - left.createdAt;
		});
	}, [currentProject]);
	const focusedSceneNode = useMemo((): SceneNode | null => {
		if (!focusedNodeId) return null;
		const focusedNode =
			currentProject?.canvas.nodes.find((node) => node.id === focusedNodeId) ??
			null;
		if (!focusedNode || focusedNode.type !== "scene") return null;
		return focusedNode;
	}, [currentProject, focusedNodeId]);
	const sidebarMode = focusedSceneNode ? "focus" : "canvas";
	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return (
			currentProject?.canvas.nodes.find((node) => node.id === activeNodeId) ??
			null
		);
	}, [activeNodeId, currentProject]);
	const activeNodeDefinition = useMemo(() => {
		if (!activeNode) return null;
		return getCanvasNodeDefinition(activeNode.type);
	}, [activeNode]);
	const ActiveNodeToolbar = activeNodeDefinition?.toolbar ?? null;
	const activeNodeScene = useMemo(() => {
		if (!activeNode || activeNode.type !== "scene") return null;
		return currentProject?.scenes[activeNode.sceneId] ?? null;
	}, [activeNode, currentProject]);
	const activeNodeAsset = useMemo(() => {
		if (!activeNode || !("assetId" in activeNode)) return null;
		return (
			currentProject?.assets.find((asset) => asset.id === activeNode.assetId) ??
			null
		);
	}, [activeNode, currentProject]);
	const DrawerComponent = resolvedDrawer?.Drawer;

	return (
		<>
			{activeNode && ActiveNodeToolbar && (
				<div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-black/65 px-3 py-2 backdrop-blur">
					<ActiveNodeToolbar
						node={activeNode}
						scene={activeNodeScene}
						asset={activeNodeAsset}
						updateNode={(patch) => {
							updateCanvasNode(activeNode.id, patch as never);
						}}
						setFocusedNode={setFocusedNode}
						setActiveScene={setActiveScene}
					/>
				</div>
			)}

			{!focusedNodeId && (
				<div
					className="absolute z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white backdrop-blur"
					style={{ left: toolbarLeftOffset, top: toolbarTopOffset }}
				>
					<button
						type="button"
						onClick={onCreateScene}
						className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20"
					>
						<Plus className="size-3" />
						<span>新建 Scene</span>
					</button>
					<button
						type="button"
						onClick={() => setCanvasSnapEnabled(!canvasSnapEnabled)}
						aria-label="画布吸附"
						className={`rounded p-1 transition ${
							canvasSnapEnabled
								? "bg-white/10 text-orange-400 hover:bg-white/20"
								: "bg-white/5 text-white/55 hover:bg-white/10"
						}`}
					>
						<SnapIcon className="size-4" />
					</button>
					<button
						type="button"
						onClick={onZoomIn}
						className="rounded bg-white/10 p-1 hover:bg-white/20"
						aria-label="放大"
					>
						<Search className="size-3" />
					</button>
					<button
						type="button"
						onClick={onZoomOut}
						className="rounded bg-white/10 p-1 hover:bg-white/20"
						aria-label="缩小"
					>
						<SearchX className="size-3" />
					</button>
					<button
						type="button"
						onClick={onResetView}
						className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
					>
						重置视图
					</button>
					<CameraZoomBadge />
				</div>
			)}

			{sidebarExpanded ? (
				<div
					data-testid="canvas-overlay-sidebar"
					className="pointer-events-none absolute z-50"
					style={{
						left: sidebarRect.x,
						top: sidebarRect.y,
						width: sidebarRect.width,
						height: sidebarRect.height,
					}}
				>
					<div
						className="pointer-events-auto h-full w-full"
						data-canvas-overlay-ui="true"
					>
						<CanvasSidebar
							mode={sidebarMode}
							nodes={sidebarNodes}
							activeNodeId={activeNodeId}
							activeTab={sidebarTab}
							onTabChange={onSidebarTabChange}
							onNodeSelect={onSidebarNodeSelect}
							onCollapse={onCollapseSidebar}
						/>
					</div>
				</div>
			) : (
				<button
					type="button"
					data-testid="canvas-sidebar-expand-button"
					aria-label="展开侧边栏"
					onClick={onExpandSidebar}
					className="absolute z-50 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white ring-1 ring-white/20 hover:bg-black/70"
					style={{ left: expandButtonOffsetX, top: expandButtonOffsetY }}
				>
					<PanelLeftOpen className="size-3" />
					侧栏
				</button>
			)}

			{rightPanelShouldRender && (activeNode || selectedTimelineElement) && (
				<div
					data-testid="canvas-overlay-right-panel"
					className="pointer-events-none absolute z-50"
					style={{
						left: rightPanelRect.x,
						top: rightPanelRect.y,
						width: rightPanelRect.width,
						height: rightPanelRect.height,
					}}
				>
					<div
						className="pointer-events-auto h-full w-full"
						data-canvas-overlay-ui="true"
					>
						{selectedTimelineElement ? (
							<div
								data-testid="canvas-timeline-element-settings-panel"
								className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl [corner-shape:superellipse(1.2)] ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
							>
								<div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/90">
									Element
								</div>
								<div className="min-h-0 flex-1 overflow-y-auto p-3">
									<ElementSettingsPanel />
								</div>
							</div>
						) : (
							activeNode && (
								<CanvasActiveNodeMetaPanel
									node={activeNode}
									scene={activeNodeScene}
									asset={activeNodeAsset}
								/>
							)
						)}
					</div>
				</div>
			)}

			{resolvedDrawer && DrawerComponent && (
				<div
					data-testid="canvas-overlay-drawer"
					className="absolute z-40 pointer-events-auto"
					data-canvas-overlay-ui="true"
					style={{
						left: drawerRect.x,
						bottom: drawerBottomOffset,
						width: drawerRect.width,
					}}
				>
					<CanvasNodeDrawerShell
						key={drawerIdentity ?? undefined}
						defaultHeight={resolvedDrawer.options.defaultHeight}
						minHeight={resolvedDrawer.options.minHeight}
						maxHeightRatio={resolvedDrawer.options.maxHeightRatio}
						resizable={resolvedDrawer.options.resizable}
						onHeightChange={onDrawerHeightChange}
					>
						<DrawerComponent
							node={resolvedDrawer.node}
							scene={resolvedDrawer.scene}
							asset={resolvedDrawer.asset}
							onClose={onCloseDrawer}
							onHeightChange={onDrawerHeightChange}
						/>
					</CanvasNodeDrawerShell>
				</div>
			)}

			<TimelineContextMenu
				open={contextMenuOpen}
				x={contextMenuOpen ? contextMenuX : 0}
				y={contextMenuOpen ? contextMenuY : 0}
				actions={contextMenuActions}
				onClose={onCloseContextMenu}
			/>
		</>
	);
};

export type { DrawerViewData };

export default CanvasWorkspaceOverlay;
