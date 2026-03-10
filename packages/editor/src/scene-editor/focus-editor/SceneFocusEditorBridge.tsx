import type { SceneNode } from "core/studio/types";
import { useEffect } from "react";
import { useSceneFocusEditorLayer } from "./useSceneFocusEditorLayer";
import type { CanvasNodeFocusEditorBridgeProps } from "@/studio/canvas/node-system/types";

export const SceneFocusEditorBridge = ({
	width,
	height,
	camera,
	runtimeManager,
	focusedNode,
	suspendHover = false,
	onLayerChange,
}: CanvasNodeFocusEditorBridgeProps<SceneNode>) => {
	const focusEditor = useSceneFocusEditorLayer({
		width,
		height,
		camera,
		runtimeManager,
		focusedNode,
		suspendHover,
	});

	useEffect(() => {
		onLayerChange({
			enabled: focusEditor.enabled,
			layerProps: focusEditor.layerProps as Record<string, unknown> | null,
		});
	}, [focusEditor.enabled, focusEditor.layerProps, onLayerChange]);

	useEffect(() => {
		return () => {
			onLayerChange({
				enabled: false,
				layerProps: null,
			});
		};
	}, [onLayerChange]);
	return null;
};
