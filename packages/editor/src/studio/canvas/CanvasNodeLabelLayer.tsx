import type { CanvasNode } from "core/studio/types";
import { useMemo } from "react";
import { Group, Image } from "react-skia-lite";
import { useSkiaUiTextSprites } from "@/studio/canvas/skia-text";
import {
	type CanvasCameraState,
	isCanvasScreenRectVisible,
	resolveCanvasNodeLabelLayout,
	resolveCanvasNodeScreenFrame,
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

interface CanvasNodeLabelLayerProps {
	width: number;
	height: number;
	camera: CanvasCameraState;
	nodes: CanvasNode[];
	focusedNodeId: string | null;
}

interface CanvasNodeLabelCandidate {
	nodeId: string;
	text: string;
	x: number;
	y: number;
	availableWidth: number;
	opacity: number;
}

export const CanvasNodeLabelLayer = ({
	width,
	height,
	camera,
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
				const frame = resolveCanvasNodeScreenFrame(node, camera);
				if (!isCanvasScreenRectVisible(frame, viewport)) return null;
				const layout = resolveCanvasNodeLabelLayout({
					frame,
					badgeHeight: LABEL_TEXT_HEIGHT_PX,
					gap: LABEL_GAP_PX,
				});
				if (!layout) return null;
				return {
					nodeId: node.id,
					text: labelText,
					x: layout.x,
					y: layout.y,
					availableWidth: layout.availableWidth,
					opacity:
						focusedNodeId && node.id !== focusedNodeId
							? LABEL_DIMMED_OPACITY
							: 1,
				};
			})
			.filter((candidate): candidate is CanvasNodeLabelCandidate => {
				return candidate !== null;
			});
	}, [camera, focusedNodeId, height, nodes, viewport, width]);
	const labelRequests = useMemo(() => {
		return labelCandidates.map((candidate) => ({
			text: candidate.text,
			maxWidthPx: Math.max(0, candidate.availableWidth),
			slotKey: candidate.nodeId,
			style: {
				fontFamily: LABEL_FONT_FAMILY,
				fontSizePx: LABEL_FONT_SIZE_PX,
				fontWeight: LABEL_FONT_WEIGHT,
				lineHeightPx: LABEL_LINE_HEIGHT_PX,
				color: LABEL_TEXT_COLOR,
				paddingPx: 0,
			},
		}));
	}, [labelCandidates]);
	const labelSprites = useSkiaUiTextSprites(labelRequests);

	if (width <= 0 || height <= 0 || labelCandidates.length === 0) {
		return null;
	}

	return (
		<Group zIndex={999_999} pointerEvents="none">
			{labelCandidates.map((candidate, index) => {
				const sprite = labelSprites[index];
				if (!sprite?.text || !sprite.image) return null;
				const textWidth = Math.max(1, sprite.textWidth);
				const textHeight = Math.max(
					1,
					sprite.textHeight || Math.ceil(LABEL_LINE_HEIGHT_PX),
				);
				const drawWidth = Math.min(candidate.availableWidth, textWidth);
				if (drawWidth <= 0) return null;
				return (
					<Group
						key={`canvas-node-label-${candidate.nodeId}`}
						transform={[
							{ translateX: candidate.x },
							{ translateY: candidate.y },
						]}
						opacity={candidate.opacity}
						pointerEvents="none"
						clip={{
							x: 0,
							y: 0,
							width: drawWidth,
							height: textHeight,
						}}
					>
						<Image
							image={sprite.image}
							x={0}
							y={0}
							width={textWidth}
							height={textHeight}
							fit="fill"
							pointerEvents="none"
						/>
					</Group>
				);
			})}
		</Group>
	);
};
