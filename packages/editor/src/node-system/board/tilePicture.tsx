import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { BoardCanvasNode } from "@/studio/project/types";
import type { CanvasNodeTilePictureCapability } from "../types";
import {
	BOARD_NODE_BACKGROUND_COLOR,
	BOARD_NODE_BORDER_COLOR,
	BOARD_NODE_BORDER_WIDTH,
	BoardNodeSurface,
} from "./renderer";

const resolveBoardTilePictureSignature = (node: BoardCanvasNode): string => {
	return JSON.stringify({
		width: Math.max(1, Math.round(Math.abs(node.width))),
		height: Math.max(1, Math.round(Math.abs(node.height))),
		backgroundColor: BOARD_NODE_BACKGROUND_COLOR,
		borderColor: BOARD_NODE_BORDER_COLOR,
		borderWidth: BOARD_NODE_BORDER_WIDTH,
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
				<BoardNodeSurface width={sourceWidth} height={sourceHeight} />,
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
