import { useEffect, useState } from "react";
import type { SkiaPointerEvent } from "react-skia-lite";
import { Group, Rect } from "react-skia-lite";

export interface TextNodeFocusFrame {
	cx: number;
	cy: number;
	width: number;
	height: number;
	rotationRad: number;
}

export interface TextNodeFocusRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TextNodeTextEditingDecorations {
	frameScreen: TextNodeFocusFrame;
	selectionRectsLocal: TextNodeFocusRect[];
	compositionRectsLocal: TextNodeFocusRect[];
	caretRectLocal: TextNodeFocusRect | null;
}

export interface TextNodeFocusSkiaLayerProps {
	width: number;
	height: number;
	frameScreen: TextNodeFocusRect;
	isEditing: boolean;
	textEditingDecorations: TextNodeTextEditingDecorations | null;
	disabled?: boolean;
	onLayerPointerDown: (event: SkiaPointerEvent) => void;
	onLayerDoubleClick: (event: SkiaPointerEvent) => void;
	onLayerPointerMove: (event: SkiaPointerEvent) => void;
	onLayerPointerUp: (event: SkiaPointerEvent) => void;
	onLayerPointerLeave: () => void;
}

export const TextNodeFocusSkiaLayer = ({
	width,
	height,
	frameScreen,
	isEditing,
	textEditingDecorations,
	disabled = false,
	onLayerPointerDown,
	onLayerDoubleClick,
	onLayerPointerMove,
	onLayerPointerUp,
	onLayerPointerLeave,
}: TextNodeFocusSkiaLayerProps) => {
	const [caretVisible, setCaretVisible] = useState(true);

	useEffect(() => {
		if (!isEditing || !textEditingDecorations?.caretRectLocal) {
			setCaretVisible(true);
			return;
		}
		setCaretVisible(true);
		const timer = window.setInterval(() => {
			setCaretVisible((previous) => !previous);
		}, 520);
		return () => {
			window.clearInterval(timer);
		};
	}, [isEditing, textEditingDecorations?.caretRectLocal]);

	if (width <= 0 || height <= 0) return null;

	return (
		<Group zIndex={2_000_000} pointerEvents={disabled ? "none" : "auto"}>
			<Group
				hitRect={{ x: 0, y: 0, width, height }}
				onPointerDown={onLayerPointerDown}
				onDoubleClick={onLayerDoubleClick}
				onPointerMove={onLayerPointerMove}
				onPointerUp={onLayerPointerUp}
				onPointerLeave={onLayerPointerLeave}
			>
				<Rect
					x={0}
					y={0}
					width={Math.max(1, width)}
					height={Math.max(1, height)}
					color="rgba(0,0,0,0.0001)"
				/>
				<Rect
					x={frameScreen.x}
					y={frameScreen.y}
					width={Math.max(1, frameScreen.width)}
					height={Math.max(1, frameScreen.height)}
					style="stroke"
					strokeWidth={1}
					color="rgba(239,68,68,0.85)"
				/>
				{isEditing && textEditingDecorations && (
					<Group
						transform={[
							{ translateX: textEditingDecorations.frameScreen.cx },
							{ translateY: textEditingDecorations.frameScreen.cy },
							{ rotate: textEditingDecorations.frameScreen.rotationRad },
						]}
						pointerEvents="none"
					>
						<Group
							transform={[
								{ translateX: -textEditingDecorations.frameScreen.width / 2 },
								{ translateY: -textEditingDecorations.frameScreen.height / 2 },
							]}
							pointerEvents="none"
						>
							{textEditingDecorations.selectionRectsLocal.map((rect) => (
								<Rect
									key={`text-node-focus-selection-${rect.x.toFixed(3)}-${rect.y.toFixed(3)}-${rect.width.toFixed(3)}-${rect.height.toFixed(3)}`}
									x={rect.x}
									y={rect.y}
									width={rect.width}
									height={rect.height}
									color="rgba(59,130,246,0.35)"
									pointerEvents="none"
								/>
							))}
							{textEditingDecorations.compositionRectsLocal.map((rect) => (
								<Rect
									key={`text-node-focus-composition-${rect.x.toFixed(3)}-${rect.y.toFixed(3)}-${rect.width.toFixed(3)}-${rect.height.toFixed(3)}`}
									x={rect.x}
									y={rect.y + Math.max(rect.height - 1, 0)}
									width={rect.width}
									height={1}
									color="rgba(37,99,235,0.9)"
									pointerEvents="none"
								/>
							))}
							{textEditingDecorations.caretRectLocal && caretVisible && (
								<Rect
									x={textEditingDecorations.caretRectLocal.x}
									y={textEditingDecorations.caretRectLocal.y}
									width={Math.max(
										1,
										textEditingDecorations.caretRectLocal.width,
									)}
									height={Math.max(
										1,
										textEditingDecorations.caretRectLocal.height,
									)}
									color="rgba(37,99,235,1)"
									pointerEvents="none"
								/>
							)}
						</Group>
					</Group>
				)}
			</Group>
		</Group>
	);
};
