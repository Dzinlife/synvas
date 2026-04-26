import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { HdrTestCanvasNode } from "@/studio/project/types";
import type { CanvasNodeTilePictureCapability } from "../types";
import { HdrTestNodeSkiaContent } from "./renderer";

const clampBrightness = (value: number): number => {
	if (!Number.isFinite(value)) return 2;
	return Math.min(4, Math.max(0, value));
};

const resolveHdrTestTilePictureSignature = (
	node: HdrTestCanvasNode,
): string => {
	return JSON.stringify({
		colorPreset: node.colorPreset,
		brightness: clampBrightness(node.brightness),
		width: Math.max(1, Math.round(Math.abs(node.width))),
		height: Math.max(1, Math.round(Math.abs(node.height))),
	});
};

export const hdrTestNodeTilePictureCapability: CanvasNodeTilePictureCapability<HdrTestCanvasNode> =
	{
		getSourceSignature: ({ node }) => {
			return resolveHdrTestTilePictureSignature(node);
		},
		generate: async ({ node }) => {
			const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
			const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
			const picture = renderNodeToPicture(
				<HdrTestNodeSkiaContent node={node} />,
				{
					width: sourceWidth,
					height: sourceHeight,
				},
			);
			if (!picture) return null;
			return {
				picture,
				sourceWidth,
				sourceHeight,
				dispose: () => {
					try {
						picture.dispose?.();
					} catch {}
				},
			};
		},
	};
