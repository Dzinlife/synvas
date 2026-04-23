import type { TextCanvasNode } from "@/studio/project/types";
import { useEffect, useMemo, useState } from "react";
import {
	Paragraph,
	type SkParagraph,
	type SkTypefaceFontProvider,
} from "react-skia-lite";
import { fontRegistry } from "@/typography/fontRegistry";
import type { CanvasNodeSkiaRenderProps } from "../types";
import {
	buildTextNodeParagraph,
	clampTextNodeFontSize,
	disposeTextNodeParagraph,
} from "./paragraph";

export const TextNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<TextCanvasNode>
> = ({ node }) => {
	const [fontProvider, setFontProvider] =
		useState<SkTypefaceFontProvider | null>(null);
	const [fontRevision, setFontRevision] = useState(0);
	const text = typeof node.text === "string" ? node.text : "";
	const width = Math.max(1, Math.abs(node.width));
	const fontSize = clampTextNodeFontSize(node.fontSize);

	useEffect(() => {
		let disposed = false;
		void fontRegistry
			.getFontProvider()
			.then((provider) => {
				if (disposed) return;
				setFontProvider(provider);
			})
			.catch((error) => {
				console.warn("[TextNodeRenderer] Failed to init font provider:", error);
			});
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		const unsubscribe = fontRegistry.subscribe(() => {
			setFontRevision((previous) => previous + 1);
			void fontRegistry
				.getFontProvider()
				.then((provider) => {
					setFontProvider(provider);
				})
				.catch((error) => {
					console.warn(
						"[TextNodeRenderer] Failed to refresh font provider:",
						error,
					);
				});
		});
		return () => {
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		void fontRevision;
		if (!text) return;
		void fontRegistry.ensureCoverage({ text }).catch((error) => {
			console.warn("[TextNodeRenderer] Failed to ensure font coverage:", error);
		});
	}, [fontRevision, text]);

	const paragraph = useMemo<SkParagraph | null>(() => {
		void fontRevision;
		const built = buildTextNodeParagraph({
			text,
			fontSize,
			fontProvider,
		});
		if (!built) return null;
		try {
			built.layout(width);
		} catch (error) {
			console.warn("[TextNodeRenderer] Failed to layout paragraph:", error);
		}
		return built;
	}, [fontProvider, fontRevision, fontSize, text, width]);

	useEffect(() => {
		return () => {
			disposeTextNodeParagraph(paragraph);
		};
	}, [paragraph]);

	if (!paragraph) return null;

	return <Paragraph paragraph={paragraph} x={0} y={0} width={width} />;
};
