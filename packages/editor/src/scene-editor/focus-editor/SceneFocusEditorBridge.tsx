import type { SceneNode } from "core/studio/types";
import { useEffect } from "react";
import { HeadlessTextInputBridge } from "@/scene-editor/text-editing";
import type { CanvasNodeFocusEditorBridgeProps } from "@/studio/canvas/node-system/types";
import { useSceneFocusEditorLayer } from "./useSceneFocusEditorLayer";

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

	if (!focusEditor.bridgeProps) return null;

	return (
		<HeadlessTextInputBridge
			key={focusEditor.bridgeProps.sessionId}
			sessionId={focusEditor.bridgeProps.sessionId}
			value={focusEditor.bridgeProps.value}
			selection={focusEditor.bridgeProps.selection}
			isComposing={focusEditor.bridgeProps.isComposing}
			overlayRect={focusEditor.bridgeProps.overlayRectScreen}
			onValueChange={focusEditor.bridgeProps.onValueChange}
			onSelectionChange={focusEditor.bridgeProps.onSelectionChange}
			onCompositionStart={focusEditor.bridgeProps.onCompositionStart}
			onCompositionUpdate={focusEditor.bridgeProps.onCompositionUpdate}
			onCompositionEnd={focusEditor.bridgeProps.onCompositionEnd}
			onCommit={focusEditor.bridgeProps.onCommit}
			onCancel={focusEditor.bridgeProps.onCancel}
			onBlur={focusEditor.bridgeProps.onBlur}
		/>
	);
};
