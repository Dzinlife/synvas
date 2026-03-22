import type { CanvasNode } from "core/studio/types";
import { useMemo } from "react";
import {
	Group,
	Image,
	type SharedValue,
	useDerivedValue,
} from "react-skia-lite";
import { useSkiaUiTextSprites } from "@/studio/canvas/skia-text";
import {
	type CanvasCameraState,
	type CanvasNodeLayoutState,
	isCanvasScreenRectVisible,
	resolveCanvasNodeLayoutScreenFrame,
	resolveCanvasViewportRect,
} from "./canvasNodeLabelUtils";

const LABEL_FONT_SIZE_PX = 12;
const LABEL_FONT_WEIGHT = 400;
const LABEL_LINE_HEIGHT_MULTIPLIER = 1.2;
const LABEL_LINE_HEIGHT_PX = LABEL_FONT_SIZE_PX * LABEL_LINE_HEIGHT_MULTIPLIER;
const LABEL_TEXT_HEIGHT_PX = Math.ceil(LABEL_LINE_HEIGHT_PX);
const LABEL_FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
const LABEL_TEXT_COLOR = "rgba(255,255,255,0.92)";
const LABEL_GAP_PX = 6;
const LABEL_DIMMED_OPACITY = 0.45;
const LABEL_MIN_VISIBLE_WIDTH_PX = 24;
const LABEL_TEXT_STYLE = {
	fontFamily: LABEL_FONT_FAMILY,
	fontSizePx: LABEL_FONT_SIZE_PX,
	fontWeight: LABEL_FONT_WEIGHT,
	lineHeightPx: LABEL_LINE_HEIGHT_PX,
	color: LABEL_TEXT_COLOR,
	paddingPx: 0,
};

interface CanvasNodeLabelLayerProps {
	width: number;
	height: number;
	camera: SharedValue<CanvasCameraState>;
	getNodeLayout: (nodeId: string) => SharedValue<CanvasNodeLayoutState> | null;
	nodes: CanvasNode[];
	focusedNodeId: string | null;
}

interface CanvasNodeLabelCandidate {
	nodeId: string;
	node: CanvasNode;
	text: string;
	opacity: number;
}

interface CanvasNodeLabelSpriteProps {
	camera: SharedValue<CanvasCameraState>;
	candidate: CanvasNodeLabelCandidate;
	getNodeLayout: (nodeId: string) => SharedValue<CanvasNodeLayoutState> | null;
	viewport: ReturnType<typeof resolveCanvasViewportRect>;
}

const CanvasNodeLabelSprite = ({
	camera,
	candidate,
	getNodeLayout,
	viewport,
}: CanvasNodeLabelSpriteProps) => {
	const layout = getNodeLayout(candidate.nodeId);
	const maxWidthPx = useDerivedValue(() => {
		const frame = resolveCanvasNodeLayoutScreenFrame(
			layout?.value ?? candidate.node,
			camera.value,
		);
		const frameWidthPx = Math.max(0, Math.floor(frame.width));
		return frameWidthPx >= LABEL_MIN_VISIBLE_WIDTH_PX ? frameWidthPx : 0;
	});
	const labelRequests = useMemo(() => {
		return [
			{
				text: candidate.text,
				maxWidthPx,
				slotKey: candidate.nodeId,
				style: LABEL_TEXT_STYLE,
			},
		];
	}, [candidate.nodeId, candidate.text, maxWidthPx]);
	const [sprite] = useSkiaUiTextSprites(labelRequests);
	const renderableImage = sprite?.image ?? null;
	const hasRenderableSprite = Boolean(sprite?.text && renderableImage);
	const textWidth = Math.max(1, sprite?.textWidth ?? 1);
	const textHeight = Math.max(
		1,
		sprite?.textHeight || Math.ceil(LABEL_LINE_HEIGHT_PX),
	);
	const transform = useDerivedValue(() => {
		const frame = resolveCanvasNodeLayoutScreenFrame(
			layout?.value ?? candidate.node,
			camera.value,
		);
		return [
			{ translateX: frame.x },
			{ translateY: frame.y - LABEL_GAP_PX - LABEL_TEXT_HEIGHT_PX },
		];
	});
	const clip = useDerivedValue(() => {
		const frame = resolveCanvasNodeLayoutScreenFrame(
			layout?.value ?? candidate.node,
			camera.value,
		);
		const isVisibleByWidth = frame.width >= LABEL_MIN_VISIBLE_WIDTH_PX;
		if (!isCanvasScreenRectVisible(frame, viewport) || !isVisibleByWidth) {
			return {
				x: 0,
				y: 0,
				width: 0,
				height: textHeight,
			};
		}
		return {
			x: 0,
			y: 0,
			width: Math.max(0, Math.min(frame.width, textWidth)),
			height: textHeight,
		};
	});
	const opacity = useDerivedValue(() => {
		const frame = resolveCanvasNodeLayoutScreenFrame(
			layout?.value ?? candidate.node,
			camera.value,
		);
		const isVisibleByWidth = frame.width >= LABEL_MIN_VISIBLE_WIDTH_PX;
		return isCanvasScreenRectVisible(frame, viewport) && isVisibleByWidth
			? candidate.opacity
			: 0;
	});
	if (!hasRenderableSprite || !renderableImage) return null;

	return (
		<Group
			transform={transform}
			opacity={opacity}
			pointerEvents="none"
			clip={clip}
		>
			<Image
				image={renderableImage}
				x={0}
				y={0}
				width={textWidth}
				height={textHeight}
				fit="fill"
				pointerEvents="none"
			/>
		</Group>
	);
};

export const CanvasNodeLabelLayer = ({
	width,
	height,
	camera,
	getNodeLayout,
	nodes,
	focusedNodeId,
}: CanvasNodeLabelLayerProps) => {
	const viewport = useMemo(() => {
		return resolveCanvasViewportRect(width, height);
	}, [height, width]);
	const labelCandidates = useMemo<CanvasNodeLabelCandidate[]>(() => {
		if (width <= 0 || height <= 0) return [];
		return nodes
			.map((node) => {
				const labelText = node.name.trim();
				if (!labelText) return null;
				return {
					nodeId: node.id,
					node,
					text: labelText,
					opacity:
						focusedNodeId && node.id !== focusedNodeId
							? LABEL_DIMMED_OPACITY
							: 1,
				};
			})
			.filter((candidate): candidate is CanvasNodeLabelCandidate => {
				return candidate !== null;
			});
	}, [focusedNodeId, height, nodes, width]);

	if (width <= 0 || height <= 0 || labelCandidates.length === 0) {
		return null;
	}

	return (
		<Group zIndex={999_999} pointerEvents="none">
			{labelCandidates.map((candidate) => {
				return (
					<CanvasNodeLabelSprite
						key={`canvas-node-label-${candidate.nodeId}`}
						camera={camera}
						candidate={candidate}
						getNodeLayout={getNodeLayout}
						viewport={viewport}
					/>
				);
			})}
		</Group>
	);
};
