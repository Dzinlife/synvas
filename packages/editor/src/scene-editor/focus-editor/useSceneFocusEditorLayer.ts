import type { SceneNode } from "core/studio/types";
import { useMemo } from "react";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import type { CameraState } from "@/studio/canvas/canvasWorkspaceUtils";
import type { FocusSceneSkiaLayerProps } from "./FocusSceneSkiaLayer";
import { useFocusSceneSkiaInteractions } from "./useFocusSceneSkiaInteractions";
import { useFocusSceneTimelineElements } from "./useFocusSceneTimelineElements";

interface UseSceneFocusEditorLayerOptions {
	width: number;
	height: number;
	camera: CameraState;
	runtimeManager: StudioRuntimeManager;
	focusedNode: SceneNode | null;
	suspendHover?: boolean;
}

export interface SceneFocusEditorLayerResult {
	enabled: boolean;
	layerProps: FocusSceneSkiaLayerProps | null;
}

export const useSceneFocusEditorLayer = ({
	width,
	height,
	camera,
	runtimeManager,
	focusedNode,
	suspendHover = false,
}: UseSceneFocusEditorLayerOptions): SceneFocusEditorLayerResult => {
	const {
		runtime: focusRuntime,
		interactiveElements,
		interactiveElementsRef,
		sourceWidth,
		sourceHeight,
	} = useFocusSceneTimelineElements({
		runtimeManager,
		sceneId: focusedNode?.sceneId ?? null,
	});
	const focusInteractions = useFocusSceneSkiaInteractions({
		width,
		height,
		camera,
		focusedNode,
		sourceWidth,
		sourceHeight,
		interactiveElements,
		interactiveElementsRef,
		timelineStore: focusRuntime?.timelineStore ?? null,
		disabled: suspendHover || !focusedNode || !focusRuntime,
	});
	const enabled = Boolean(focusedNode && focusRuntime);
	const layerProps = useMemo<FocusSceneSkiaLayerProps | null>(() => {
		if (!enabled) return null;
		return {
			width,
			height,
			elements: focusInteractions.elementLayouts,
			selectedIds: focusInteractions.selectedIds,
			hoveredId: focusInteractions.hoveredId,
			draggingId: focusInteractions.draggingId,
			selectionRectScreen: focusInteractions.selectionRectScreen,
			snapGuidesScreen: focusInteractions.snapGuidesScreen,
			selectionFrameScreen: focusInteractions.selectionFrameScreen,
			handleItems: focusInteractions.handleItems,
			activeHandle: focusInteractions.activeHandle,
			labelItems: focusInteractions.labelItems,
			disabled: suspendHover,
			onLayerPointerDown: focusInteractions.onLayerPointerDown,
			onLayerPointerMove: focusInteractions.onLayerPointerMove,
			onLayerPointerUp: focusInteractions.onLayerPointerUp,
			onLayerPointerLeave: focusInteractions.onLayerPointerLeave,
		};
	}, [
		enabled,
		focusInteractions.activeHandle,
		focusInteractions.draggingId,
		focusInteractions.elementLayouts,
		focusInteractions.handleItems,
		focusInteractions.hoveredId,
		focusInteractions.labelItems,
		focusInteractions.onLayerPointerDown,
		focusInteractions.onLayerPointerLeave,
		focusInteractions.onLayerPointerMove,
		focusInteractions.onLayerPointerUp,
		focusInteractions.selectedIds,
		focusInteractions.selectionFrameScreen,
		focusInteractions.selectionRectScreen,
		focusInteractions.snapGuidesScreen,
		height,
		suspendHover,
		width,
	]);

	return {
		enabled,
		layerProps,
	};
};
