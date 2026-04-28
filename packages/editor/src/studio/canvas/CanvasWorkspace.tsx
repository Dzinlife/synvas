import { useContext, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useProjectStore } from "@/projects/projectStore";
import { EditorRuntimeContext } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import { useCanvasCameraStore } from "@/studio/canvas/cameraStore";
import { useResolvedAppPreviewColorOutput } from "@/studio/previewColorSettings";
import CanvasWorkspaceOverlay from "./CanvasWorkspaceOverlay";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";
import { useCanvasInteractionStore } from "./canvasInteractionStore";
import { useCanvasInteractionController } from "./useCanvasInteractionController";
import { useCanvasRenderCullController } from "./useCanvasRenderCullController";
import { useCanvasSceneGraph } from "./useCanvasSceneGraph";
import { useNodeThumbnailGeneration } from "./useNodeThumbnailGeneration";

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

const CanvasWorkspace = () => {
	const { currentProject } = useStoreWithEqualityFn(
		useProjectStore,
		(state) => ({
			currentProject: state.currentProject,
		}),
		isProjectEqualExceptCamera,
	);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const setCanvasCamera = useCanvasCameraStore((state) => state.setCamera);
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo<StudioRuntimeManager | null>(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (!manager?.getTimelineRuntime || !manager.listTimelineRuntimes) {
			return null;
		}
		return manager as StudioRuntimeManager;
	}, [runtime]);
	useNodeThumbnailGeneration({
		project: currentProject,
		projectId: currentProjectId,
		runtimeManager,
	});
	const focusedNodeId = currentProject?.ui.focusedNodeId ?? null;
	const activeSceneId = currentProject?.ui.activeSceneId ?? null;
	const previewColorOutput = useResolvedAppPreviewColorOutput();
	const activeNodeId = currentProject?.ui.activeNodeId ?? null;
	const canvasSnapEnabled = currentProject?.ui.canvasSnapEnabled ?? true;
	const isCanvasInteractionLocked = Boolean(focusedNodeId);
	const { selectedNodeIds, stageSize } = useCanvasInteractionStore(
		useShallow((state) => ({
			selectedNodeIds: state.selectedNodeIds,
			stageSize: state.stageSize,
		})),
	);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const {
		cameraSharedValue,
		getCamera,
		applyInstantCameraWithCullIntent,
		applySmoothCameraWithCullLock,
		isCameraAnimating,
		renderCullState,
		tileLodTransition,
	} = useCanvasRenderCullController({
		currentProjectId,
		stageSize,
		onCameraChange: setCanvasCamera,
	});
	const sceneGraph = useCanvasSceneGraph({
		project: currentProject,
		selectedNodeIds,
		activeNodeId,
		focusedNodeId,
		renderCullState,
		stageSize,
	});
	const {
		handleLabelHitTesterChange,
		normalizedSelectedNodeIds,
		renderNodes,
		sortedNodes,
	} = sceneGraph;
	const interaction = useCanvasInteractionController({
		currentProject,
		currentProjectId,
		activeSceneId,
		activeNodeId,
		focusedNodeId,
		canvasSnapEnabled,
		isCanvasInteractionLocked,
		runtimeManager,
		containerRef,
		getCamera,
		applyInstantCameraWithCullIntent,
		applySmoothCameraWithCullLock,
		tileLodTransition,
		sceneGraph,
	});
	const {
		autoLayoutAnimatedNodeIds,
		boardAutoLayoutIndicator,
		canvasToolMode,
		contextMenuActions,
		contextMenuState,
		closeContextMenu,
		drawerBottomOffset,
		drawerIdentity,
		effectiveTileLodTransition,
		expandButtonOffsetX,
		expandButtonOffsetY,
		forceLiveCanvasNodeIds,
		frozenCanvasNodeIds,
		handleBoardLayoutModeChange,
		handleCanvasContextMenu,
		handleCanvasDrop,
		handleCanvasPointerCancel,
		handleCanvasPointerDown,
		handleCanvasPointerLeave,
		handleCanvasPointerMove,
		handleCanvasPointerUp,
		handleCloseDrawer,
		handleCreateHdrTestNode,
		handleCreateImageGeneratorNode,
		handleCreateScene,
		handleDropTimelineElementsToCanvas,
		handleEditorMouseOverCapture,
		handleResetView,
		handleRestoreSceneReferenceToCanvas,
		handleSelectionResize,
		handleSidebarNodeReorder,
		handleSidebarNodeSelect,
		handleSkiaNodeResize,
		handleToolModeChange,
		handleZoomByStep,
		hoveredNodeId,
		marqueeRect,
		overlayLayout,
		resolvedCanvasCursor,
		resolvedDrawer,
		rightPanelShouldRender,
		setSidebarExpanded,
		setTileDebugEnabled,
		setVisibleDrawerHeight,
		sidebarExpanded,
		snapGuidesScreen,
		tileDebugEnabled,
		tileMaxTasksPerTick,
		toolbarLeftOffset,
		toolbarTopOffset,
	} = interaction;
	if (!currentProject) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				Loading...
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			data-testid="canvas-workspace"
			role="application"
			className="relative h-full w-full overflow-hidden"
			style={
				resolvedCanvasCursor ? { cursor: resolvedCanvasCursor } : undefined
			}
			onMouseOverCapture={handleEditorMouseOverCapture}
			onPointerDown={handleCanvasPointerDown}
			onPointerMove={handleCanvasPointerMove}
			onPointerUp={handleCanvasPointerUp}
			onPointerCancel={handleCanvasPointerCancel}
			onPointerLeave={handleCanvasPointerLeave}
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
				camera={cameraSharedValue}
				nodes={renderNodes}
				tileSourceNodes={sortedNodes}
				scenes={currentProject.scenes}
				assets={currentProject.assets}
				activeNodeId={activeNodeId}
				selectedNodeIds={normalizedSelectedNodeIds}
				focusedNodeId={focusedNodeId}
				hoveredNodeId={hoveredNodeId}
				marqueeRectScreen={marqueeRect}
				snapGuidesScreen={snapGuidesScreen}
				boardAutoLayoutIndicator={boardAutoLayoutIndicator}
				animatedLayoutNodeIds={autoLayoutAnimatedNodeIds}
				frozenNodeIds={frozenCanvasNodeIds}
				forceLiveNodeIds={forceLiveCanvasNodeIds}
				suspendHover={isCameraAnimating}
				tileDebugEnabled={tileDebugEnabled}
				tileMaxTasksPerTick={tileMaxTasksPerTick}
				tileLodTransition={effectiveTileLodTransition}
				colorSpace={previewColorOutput.colorSpace}
				dynamicRange={previewColorOutput.dynamicRange}
				onNodeResize={handleSkiaNodeResize}
				onSelectionResize={handleSelectionResize}
				onLabelHitTesterChange={handleLabelHitTesterChange}
			/>

			<CanvasWorkspaceOverlay
				cameraSharedValue={cameraSharedValue}
				toolbarLeftOffset={toolbarLeftOffset}
				toolbarTopOffset={toolbarTopOffset}
				onCreateScene={handleCreateScene}
				onCreateImageGenerator={handleCreateImageGeneratorNode}
				onCreateHdrTestNode={handleCreateHdrTestNode}
				toolMode={canvasToolMode}
				onToolModeChange={handleToolModeChange}
				onZoomIn={() => handleZoomByStep(1.1)}
				onZoomOut={() => handleZoomByStep(0.9)}
				onResetView={handleResetView}
				tileDebugEnabled={tileDebugEnabled}
				onToggleTileDebug={() => {
					setTileDebugEnabled(!tileDebugEnabled);
				}}
				sidebarExpanded={sidebarExpanded}
				sidebarRect={overlayLayout.sidebarRect}
				expandButtonOffsetX={expandButtonOffsetX}
				expandButtonOffsetY={expandButtonOffsetY}
				selectedNodeIds={normalizedSelectedNodeIds}
				onSidebarNodeSelect={handleSidebarNodeSelect}
				onSidebarNodeReorder={handleSidebarNodeReorder}
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
				onDropTimelineElementsToCanvas={handleDropTimelineElementsToCanvas}
				onRestoreSceneReferenceToCanvas={handleRestoreSceneReferenceToCanvas}
				onBoardLayoutModeChange={handleBoardLayoutModeChange}
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
