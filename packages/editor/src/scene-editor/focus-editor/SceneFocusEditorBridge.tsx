import type { SceneNode } from "@/studio/project/types";
import { useEffect } from "react";
import type { CanvasNodeFocusEditorBridgeProps } from "@/node-system/types";
import { HeadlessTextInputBridge } from "@/studio/canvas/text-editing";
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
			canUndo={focusEditor.bridgeProps.canUndo}
			canRedo={focusEditor.bridgeProps.canRedo}
			overlayRect={focusEditor.bridgeProps.overlayRectScreen}
			onValueChange={focusEditor.bridgeProps.onValueChange}
			onSelectionChange={focusEditor.bridgeProps.onSelectionChange}
			onCompositionStart={focusEditor.bridgeProps.onCompositionStart}
			onCompositionUpdate={focusEditor.bridgeProps.onCompositionUpdate}
			onCompositionEnd={focusEditor.bridgeProps.onCompositionEnd}
			onUndo={focusEditor.bridgeProps.onUndo}
			onRedo={focusEditor.bridgeProps.onRedo}
			onCommit={focusEditor.bridgeProps.onCommit}
			onCancel={focusEditor.bridgeProps.onCancel}
			onBlur={focusEditor.bridgeProps.onBlur}
		/>
	);
};
