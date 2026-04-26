import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { BoardCanvasNode } from "@/studio/project/types";
import { Rect } from "react-skia-lite";
import type { CanvasNodeTilePictureCapability } from "../types";

const resolveBoardTilePictureSignature = (node: BoardCanvasNode): string => {
	return JSON.stringify({
		width: Math.max(1, Math.round(Math.abs(node.width))),
		height: Math.max(1, Math.round(Math.abs(node.height))),
	});
};

export const boardNodeTilePictureCapability: CanvasNodeTilePictureCapability<BoardCanvasNode> =
	{
		getSourceSignature: ({ node }) => {
			return resolveBoardTilePictureSignature(node);
		},
		generate: async ({ node, offscreenSurfaceOptions }) => {
			const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
			const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));
			const picture = renderNodeToPicture(
				<Rect
					x={0}
					y={0}
					width={sourceWidth}
					height={sourceHeight}
					color="#222"
				/>,
				{
					width: sourceWidth,
					height: sourceHeight,
				},
				offscreenSurfaceOptions,
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
				disposeIncludesPicture: true,
			};
		},
	};
