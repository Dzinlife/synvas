import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { FrameCanvasNode } from "@/studio/project/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeTilePictureCapability } from "../types";

const resolveFrameTilePictureSignature = (node: FrameCanvasNode): string => {
	return JSON.stringify({
		width: Math.max(1, Math.round(Math.abs(node.width))),
		height: Math.max(1, Math.round(Math.abs(node.height))),
	});
};

export const frameNodeTilePictureCapability: CanvasNodeTilePictureCapability<FrameCanvasNode> =
	{
		getSourceSignature: ({ node }) => {
			return resolveFrameTilePictureSignature(node);
		},
		generate: async ({ node }) => {
			const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
			const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
			const picture = renderNodeToPicture(
				<Rect
					x={0}
					y={0}
					width={sourceWidth}
					height={sourceHeight}
					color="#222"
				/>
				,
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
