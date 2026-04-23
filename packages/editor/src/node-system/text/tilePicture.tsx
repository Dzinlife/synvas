import { renderNodeToPicture } from "core/render-system/renderNodeSnapshot";
import type { TextCanvasNode } from "@/studio/project/types";
import { Paragraph } from "react-skia-lite";
import { fontRegistry } from "@/typography/fontRegistry";
import type { CanvasNodeTilePictureCapability } from "../types";
import {
	buildTextNodeParagraph,
	clampTextNodeFontSize,
	disposeTextNodeParagraph,
} from "./paragraph";

const resolveTextTilePictureSignature = (node: TextCanvasNode): string => {
	return JSON.stringify({
		text: typeof node.text === "string" ? node.text : "",
		fontSize: clampTextNodeFontSize(node.fontSize),
		width: Math.max(1, Math.round(Math.abs(node.width))),
		height: Math.max(1, Math.round(Math.abs(node.height))),
	});
};

export const textNodeTilePictureCapability: CanvasNodeTilePictureCapability<TextCanvasNode> =
	{
		getSourceSignature: ({ node }) => {
			return resolveTextTilePictureSignature(node);
		},
		generate: async ({ node }) => {
			const text = typeof node.text === "string" ? node.text : "";
			const sourceWidth = Math.max(1, Math.round(Math.abs(node.width)));
			const sourceHeight = Math.max(1, Math.round(Math.abs(node.height)));

			if (text) {
				try {
					await fontRegistry.ensureCoverage({ text });
				} catch {}
			}
			let fontProvider = null;
			try {
				fontProvider = await fontRegistry.getFontProvider();
			} catch {}
			const paragraph = buildTextNodeParagraph({
				text,
				fontSize: node.fontSize,
				fontProvider,
			});
			if (!paragraph) return null;
			try {
				paragraph.layout(sourceWidth);
			} catch {
				disposeTextNodeParagraph(paragraph);
				return null;
			}
			const picture = renderNodeToPicture(
				<Paragraph paragraph={paragraph} x={0} y={0} width={sourceWidth} />,
				{
					width: sourceWidth,
					height: sourceHeight,
				},
			);
			if (!picture) {
				disposeTextNodeParagraph(paragraph);
				return null;
			}
			return {
				picture,
				sourceWidth,
				sourceHeight,
				dispose: () => {
					disposeTextNodeParagraph(paragraph);
					try {
						picture.dispose?.();
					} catch {}
				},
			};
		},
	};
