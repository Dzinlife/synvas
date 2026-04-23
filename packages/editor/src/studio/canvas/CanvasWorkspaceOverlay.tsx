import type { TimelineAsset } from "core/timeline-system/types";
import type { CanvasNode, SceneDocument, SceneNode } from "@/studio/project/types";
import { Bug, PanelLeftOpen, Plus, Search, SearchX } from "lucide-react";
import { AnimatePresence, motion, usePresence } from "motion/react";
import type React from "react";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	getSkiaResourceTrackerConfig,
	getSkiaResourceTrackerStorageKey,
	setSkiaResourceTrackerConfig,
} from "react-skia-lite";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { getOwner, releaseOwner, subscribeOwnerChange } from "@/audio/owner";
import { SnapIcon } from "@/components/icons";
import { useProjectStore } from "@/projects/projectStore";
import TimelineContextMenu, {
	type TimelineContextMenuAction,
} from "@/scene-editor/components/TimelineContextMenu";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import CanvasNodeDrawerShell from "@/studio/canvas/CanvasNodeDrawerShell";
import { useCanvasCameraStore } from "@/studio/canvas/cameraStore";
import {
	CANVAS_TOOL_DEFINITIONS,
	type CanvasToolMode,
} from "@/studio/canvas/canvasToolMode";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type { CanvasNodeDrawerProps } from "@/node-system/types";
import CanvasSidebar, {
	type CanvasSidebarNodeReorderRequest,
	type CanvasSidebarNodeSelectOptions,
	type CanvasSidebarTab,
} from "@/studio/canvas/sidebar/CanvasSidebar";
import type { StudioTimelineCanvasDropRequest } from "@/studio/clipboard/studioClipboardStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import CanvasActiveNodeMetaPanel from "./CanvasActiveNodeMetaPanel";
import {
	resolveCanvasNodeLayoutWorldRect,
	resolveCanvasWorldRectScreenFrame,
} from "./canvasNodeLabelUtils";
import type {
	CameraState,
	ResolvedCanvasDrawerOptions,
} from "./canvasWorkspaceUtils";

const SCENE_OWNER_PREFIX = "scene:";

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
	onDropTimelineElementsToCanvas?: (
		request: StudioTimelineCanvasDropRequest,
	) => boolean;
	onRestoreSceneReferenceToCanvas?: (sceneId: string) => boolean;
}

interface OverlayCameraSharedValue {
	value: CameraState;
	addListener?: (
		listenerId: number,
		listener: (camera: CameraState) => void,
	) => void;
	removeListener?: (listenerId: number) => void;
}

interface CanvasWorkspaceOverlayProps {
	cameraSharedValue?: OverlayCameraSharedValue;
	toolbarLeftOffset: number;
	toolbarTopOffset: number;
	onCreateScene: () => void;
	toolMode: CanvasToolMode;
	onToolModeChange: (mode: CanvasToolMode) => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onResetView: () => void;
	tileDebugEnabled: boolean;
	onToggleTileDebug: () => void;
	sidebarExpanded: boolean;
	sidebarRect: OverlayRect;
	expandButtonOffsetX: number;
	expandButtonOffsetY: number;
	sidebarTab: CanvasSidebarTab;
	onSidebarTabChange: (tab: CanvasSidebarTab) => void;
	selectedNodeIds: string[];
	onSidebarNodeSelect: (
		node: CanvasNode,
		options?: CanvasSidebarNodeSelectOptions,
	) => void;
	onSidebarNodeReorder?: (request: CanvasSidebarNodeReorderRequest) => void;
	onCollapseSidebar: () => void;
	onExpandSidebar: () => void;
	rightPanelShouldRender: boolean;
	rightPanelRect: OverlayRect;
	resolvedDrawer: DrawerViewData | null;
	drawerIdentity: string | null;
	drawerRect: OverlayRect;
	drawerBottomOffset: number;
	onDrawerHeightChange: (height: number) => void;
	onCloseDrawer: () => void;
	onDropTimelineElementsToCanvas?: (
		request: StudioTimelineCanvasDropRequest,
	) => boolean;
	onRestoreSceneReferenceToCanvas?: (sceneId: string) => boolean;
	contextMenuOpen: boolean;
	contextMenuX: number;
	contextMenuY: number;
	contextMenuActions: TimelineContextMenuAction[];
	onCloseContextMenu: () => void;
}

const DRAWER_PRESENCE_TRANSITION = {
	duration: 0.25,
	ease: [0.22, 1, 0.36, 1] as const,
};

const RIGHT_PANEL_PRESENCE_TRANSITION = {
	duration: 0.25,
	ease: [0.22, 1, 0.36, 1] as const,
};

const ACTIVE_NODE_OVERLAY_PRESENCE_TRANSITION = {
	duration: 0.25,
	ease: [0.22, 1, 0.36, 1] as const,
};

const RIGHT_PANEL_EXIT_DURATION_MS = Math.round(
	RIGHT_PANEL_PRESENCE_TRANSITION.duration * 1000,
);
const SKIA_RESOURCE_TRACKER_DEFAULT_SAMPLE_LIMIT = 3;
const SKIA_RESOURCE_TRACKER_DEBUG_SAMPLE_LIMIT = 200;
const IS_JSDOM_ENV =
	typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
interface AnimatedRightPanelProps {
	rightPanelRect: OverlayRect;
	children: React.ReactNode;
}

const AnimatedRightPanel: React.FC<AnimatedRightPanelProps> = ({
	rightPanelRect,
	children,
}) => {
	const [isPresent, safeToRemove] = usePresence();

	useEffect(() => {
		if (isPresent) return;
		if (IS_JSDOM_ENV) {
			safeToRemove();
			return;
		}
		const timer = window.setTimeout(safeToRemove, RIGHT_PANEL_EXIT_DURATION_MS);
		return () => {
			window.clearTimeout(timer);
		};
	}, [isPresent, safeToRemove]);

	return (
		<motion.div
			data-testid={isPresent ? "canvas-overlay-right-panel" : undefined}
			className="pointer-events-none absolute z-50"
			style={{
				left: rightPanelRect.x,
				top: rightPanelRect.y,
				width: rightPanelRect.width,
				height: rightPanelRect.height,
			}}
			initial={{ x: "100%" }}
			animate={{ x: "0%" }}
			exit={{ x: "100%" }}
			transition={RIGHT_PANEL_PRESENCE_TRANSITION}
		>
			<div
				className="pointer-events-auto h-full w-full"
				data-canvas-overlay-ui="true"
			>
				{isPresent ? children : null}
			</div>
		</motion.div>
	);
};

const isProjectEqualExceptCamera = (
	left: {
		currentProject: ReturnType<
			typeof useProjectStore.getState
		>["currentProject"];
	},
	right: {
		currentProject: ReturnType<
			typeof useProjectStore.getState
		>["currentProject"];
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
	const cameraZoom = useCanvasCameraStore((state) => state.camera.zoom);
	return <span className="text-white/70">{Math.round(cameraZoom * 100)}%</span>;
};

interface ActiveNodeToolbarOverlayProps {
	node: CanvasNode;
	cameraSharedValue?: OverlayCameraSharedValue;
	children: React.ReactNode;
}

const ActiveNodeToolbarOverlay = ({
	node,
	cameraSharedValue,
	children,
}: ActiveNodeToolbarOverlayProps) => {
	const storeCamera = useCanvasCameraStore((state) => state.camera);
	const [camera, setCamera] = useState(() => {
		return cameraSharedValue?.value ?? storeCamera;
	});
	const cameraListenerIdRef = useRef(
		81001 + Math.floor(Math.random() * 100000),
	);
	const setCameraIfChanged = useCallback((next: CameraState) => {
		setCamera((prev) => {
			if (prev.x === next.x && prev.y === next.y && prev.zoom === next.zoom) {
				return prev;
			}
			return next;
		});
	}, []);
	useEffect(() => {
		if (!cameraSharedValue) {
			return;
		}
		setCameraIfChanged(cameraSharedValue.value);
		const addListener = cameraSharedValue.addListener;
		const removeListener = cameraSharedValue.removeListener;
		if (
			typeof addListener !== "function" ||
			typeof removeListener !== "function"
		) {
			return;
		}
		const listenerId = cameraListenerIdRef.current;
		addListener(listenerId, (next) => {
			setCameraIfChanged(next);
		});
		return () => {
			removeListener(listenerId);
		};
	}, [cameraSharedValue, setCameraIfChanged]);
	useEffect(() => {
		setCameraIfChanged(storeCamera);
	}, [setCameraIfChanged, storeCamera]);
	const overlayFrame = useMemo(() => {
		return resolveCanvasWorldRectScreenFrame(
			resolveCanvasNodeLayoutWorldRect(node),
			camera,
		);
	}, [camera, node]);

	return (
		<motion.div
			data-testid="canvas-active-node-overlay"
			className="pointer-events-none absolute z-40 overflow-visible"
			style={{
				left: overlayFrame.x,
				top: overlayFrame.y,
				width: overlayFrame.width,
				height: overlayFrame.height,
			}}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={ACTIVE_NODE_OVERLAY_PRESENCE_TRANSITION}
		>
			<div
				data-testid="canvas-active-node-toolbar"
				className="pointer-events-auto absolute bottom-full left-1/2 mb-6.5 w-max max-w-none -translate-x-1/2 rounded-full border border-white/10 bg-black/65 px-3 py-2 backdrop-blur"
			>
				{children}
			</div>
		</motion.div>
	);
};

const CanvasWorkspaceOverlay = ({
	cameraSharedValue,
	toolbarLeftOffset,
	toolbarTopOffset,
	onCreateScene,
	toolMode,
	onToolModeChange,
	onZoomIn,
	onZoomOut,
	onResetView,
	tileDebugEnabled,
	onToggleTileDebug,
	sidebarExpanded,
	sidebarRect,
	expandButtonOffsetX,
	expandButtonOffsetY,
	sidebarTab,
	onSidebarTabChange,
	selectedNodeIds,
	onSidebarNodeSelect,
	onSidebarNodeReorder,
	onCollapseSidebar,
	onExpandSidebar,
	rightPanelShouldRender,
	rightPanelRect,
	resolvedDrawer,
	drawerIdentity,
	drawerRect,
	drawerBottomOffset,
	onDrawerHeightChange,
	onCloseDrawer,
	onDropTimelineElementsToCanvas,
	onRestoreSceneReferenceToCanvas,
	contextMenuOpen,
	contextMenuX,
	contextMenuY,
	contextMenuActions,
	onCloseContextMenu,
}: CanvasWorkspaceOverlayProps) => {
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (!manager?.getTimelineRuntime || !manager.listTimelineRuntimes) {
			return null;
		}
		return manager as StudioRuntimeManager;
	}, [runtime]);
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
	const [skiaResourceTrackerDebugEnabled, setSkiaResourceTrackerDebugEnabled] =
		useState(() => {
			const config = getSkiaResourceTrackerConfig();
			return (
				config.enabled &&
				config.captureStacks &&
				config.autoProjectSwitchSnapshot
			);
		});
	const focusedNodeId = currentProject?.ui.focusedNodeId ?? null;
	const activeNodeId = currentProject?.ui.activeNodeId ?? null;
	const canvasSnapEnabled = currentProject?.ui.canvasSnapEnabled ?? true;
	const sidebarNodes = useMemo(() => {
		if (!currentProject) return [];
		return currentProject.canvas.nodes;
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
	const ActiveNodeInspector = activeNodeDefinition?.inspector ?? null;
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
	const pauseBlurredSceneOwnerPlayback = useCallback(() => {
		if (!runtimeManager || !currentProject) return;
		const ownerId = getOwner();
		if (!ownerId || !ownerId.startsWith(SCENE_OWNER_PREFIX)) return;
		const sceneId = ownerId.slice(SCENE_OWNER_PREFIX.length).trim();
		if (!sceneId) return;
		const ownerSceneNode = currentProject.canvas.nodes.find((node) => {
			return node.type === "scene" && node.sceneId === sceneId;
		});
		if (ownerSceneNode?.id === activeNodeId) return;
		const ownerRuntime = runtimeManager.getTimelineRuntime(
			toSceneTimelineRef(sceneId),
		);
		ownerRuntime?.timelineStore.getState().pause();
		releaseOwner(ownerId);
	}, [activeNodeId, currentProject, runtimeManager]);

	useEffect(() => {
		pauseBlurredSceneOwnerPlayback();
	}, [pauseBlurredSceneOwnerPlayback]);

	useEffect(() => {
		const unsubscribe = subscribeOwnerChange(() => {
			pauseBlurredSceneOwnerPlayback();
		});
		return unsubscribe;
	}, [pauseBlurredSceneOwnerPlayback]);
	useEffect(() => {
		if (typeof window === "undefined") return;
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== getSkiaResourceTrackerStorageKey()) return;
			const config = getSkiaResourceTrackerConfig();
			setSkiaResourceTrackerDebugEnabled(
				config.enabled &&
					config.captureStacks &&
					config.autoProjectSwitchSnapshot,
			);
		};
		window.addEventListener("storage", handleStorage);
		return () => {
			window.removeEventListener("storage", handleStorage);
		};
	}, []);
	const handleToggleSkiaResourceTrackerDebug = useCallback(() => {
		if (skiaResourceTrackerDebugEnabled) {
			setSkiaResourceTrackerConfig({
				enabled: false,
				captureStacks: false,
				autoProjectSwitchSnapshot: false,
				sampleLimitPerType: SKIA_RESOURCE_TRACKER_DEFAULT_SAMPLE_LIMIT,
			});
			if (typeof window !== "undefined") {
				try {
					window.localStorage.removeItem(getSkiaResourceTrackerStorageKey());
				} catch {}
			}
			setSkiaResourceTrackerDebugEnabled(false);
			return;
		}
		const nextConfig = setSkiaResourceTrackerConfig({
			enabled: true,
			captureStacks: true,
			autoProjectSwitchSnapshot: true,
			sampleLimitPerType: SKIA_RESOURCE_TRACKER_DEBUG_SAMPLE_LIMIT,
		});
		setSkiaResourceTrackerDebugEnabled(
			nextConfig.enabled &&
				nextConfig.captureStacks &&
				nextConfig.autoProjectSwitchSnapshot,
		);
	}, [skiaResourceTrackerDebugEnabled]);

	const DrawerComponent = resolvedDrawer?.Drawer;

	return (
		<>
			<AnimatePresence mode="sync" initial={false}>
				{activeNode && ActiveNodeToolbar && (
					<ActiveNodeToolbarOverlay
						key={`active-node-overlay:${activeNode.id}`}
						node={activeNode}
						cameraSharedValue={cameraSharedValue}
					>
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
					</ActiveNodeToolbarOverlay>
				)}
			</AnimatePresence>

			{!focusedNodeId && (
				<div
					className="absolute z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white backdrop-blur"
					style={{ left: toolbarLeftOffset, top: toolbarTopOffset }}
				>
					<div className="flex items-center gap-1 rounded bg-white/5 p-1">
						{CANVAS_TOOL_DEFINITIONS.map((tool) => {
							const Icon = tool.icon;
							const isActive = toolMode === tool.mode;
							const disabled = !tool.enabled;
							return (
								<button
									key={tool.mode}
									type="button"
									data-testid={`canvas-tool-mode-${tool.mode}`}
									disabled={disabled}
									aria-disabled={disabled}
									aria-pressed={isActive}
									onClick={() => {
										if (disabled) return;
										onToolModeChange(tool.mode);
									}}
									className={`flex items-center gap-1 rounded px-2 py-1 transition ${
										disabled
											? "cursor-not-allowed bg-white/5 text-white/30"
											: isActive
												? "bg-white/20 text-white"
												: "bg-transparent text-white/70 hover:bg-white/10"
									}`}
								>
									<Icon className="size-3" />
									<span>{tool.label}</span>
								</button>
							);
						})}
					</div>
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
						onClick={onToggleTileDebug}
						aria-label="Tile 调试"
						aria-pressed={tileDebugEnabled}
						data-testid="canvas-tile-debug-toggle"
						className={`rounded px-2 py-1 transition ${
							tileDebugEnabled
								? "bg-white/10 text-sky-300 hover:bg-white/20"
								: "bg-white/5 text-white/55 hover:bg-white/10"
						}`}
					>
						<span className="flex items-center gap-1">
							<Bug className="size-3" />
							<span>Tile 调试</span>
						</span>
					</button>
					<button
						type="button"
						onClick={handleToggleSkiaResourceTrackerDebug}
						aria-label="Skia 资源追踪"
						aria-pressed={skiaResourceTrackerDebugEnabled}
						data-testid="canvas-skia-resource-tracker-toggle"
						className={`rounded px-2 py-1 transition ${
							skiaResourceTrackerDebugEnabled
								? "bg-white/10 text-amber-300 hover:bg-white/20"
								: "bg-white/5 text-white/55 hover:bg-white/10"
						}`}
					>
						<span className="flex items-center gap-1">
							<Bug className="size-3" />
							<span>Skia 追踪</span>
						</span>
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
							selectedNodeIds={selectedNodeIds}
							activeTab={sidebarTab}
							onTabChange={onSidebarTabChange}
							onNodeSelect={onSidebarNodeSelect}
							onNodeReorder={onSidebarNodeReorder}
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

			<AnimatePresence>
				{rightPanelShouldRender && activeNode && (
					<AnimatedRightPanel rightPanelRect={rightPanelRect}>
						{ActiveNodeInspector ? (
							<ActiveNodeInspector
								node={activeNode}
								scene={activeNodeScene}
								asset={activeNodeAsset}
								isFocused={focusedNodeId === activeNode.id}
								updateNode={(patch) => {
									updateCanvasNode(activeNode.id, patch as never);
								}}
								setFocusedNode={setFocusedNode}
								setActiveScene={setActiveScene}
							/>
						) : (
							<CanvasActiveNodeMetaPanel
								node={activeNode}
								scene={activeNodeScene}
								asset={activeNodeAsset}
							/>
						)}
					</AnimatedRightPanel>
				)}
			</AnimatePresence>

			<AnimatePresence>
				{resolvedDrawer && DrawerComponent && (
					<motion.div
						data-testid="canvas-overlay-drawer"
						className="absolute z-40 pointer-events-auto"
						data-canvas-overlay-ui="true"
						style={{
							left: drawerRect.x,
							bottom: drawerBottomOffset,
							width: drawerRect.width,
							height: drawerRect.height,
						}}
						initial={{ y: "100%" }}
						animate={{ y: "0%" }}
						exit={{ y: "100%" }}
						transition={DRAWER_PRESENCE_TRANSITION}
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
								onDropTimelineElementsToCanvas={
									resolvedDrawer.onDropTimelineElementsToCanvas ??
									onDropTimelineElementsToCanvas
								}
								onRestoreSceneReferenceToCanvas={
									resolvedDrawer.onRestoreSceneReferenceToCanvas ??
									onRestoreSceneReferenceToCanvas
								}
							/>
						</CanvasNodeDrawerShell>
					</motion.div>
				)}
			</AnimatePresence>

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
