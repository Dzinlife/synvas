import type { TextCanvasNode } from "core/studio/types";
import { useEffect } from "react";
import { HeadlessTextInputBridge } from "@/studio/canvas/text-editing";
import type { CanvasNodeFocusEditorBridgeProps } from "../types";
import { useTextNodeFocusEditorLayer } from "./useTextNodeFocusEditorLayer";

export const TextNodeFocusEditorBridge = ({
	width,
	height,
	camera,
	focusedNode,
	suspendHover = false,
	onLayerChange,
}: CanvasNodeFocusEditorBridgeProps<TextCanvasNode>) => {
	const focusEditor = useTextNodeFocusEditorLayer({
		width,
		height,
		camera,
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
			isActive={focusEditor.bridgeProps.isActive}
			canUndo={focusEditor.bridgeProps.canUndo}
			canRedo={focusEditor.bridgeProps.canRedo}
			useNativeUndoRedo={true}
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
