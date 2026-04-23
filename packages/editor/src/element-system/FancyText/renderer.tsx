import type React from "react";
import { useEffect, useMemo } from "react";
import {
	FontEdging,
	FontHinting,
	Glyphs,
	Group,
	Paragraph,
	Path,
	type SkFont,
	Skia,
	type SkPath,
	type SkTypeface,
} from "react-skia-lite";
import {
	useRenderTime,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import { buildFancyGlyphSlices, type FancyGlyphSlice } from "./helpers";
import type { FancyTextInternal, FancyTextProps } from "./model";

interface FancyTextRendererProps {
	id: string;
}

const useFancyTextSelector = createModelSelector<
	FancyTextProps,
	FancyTextInternal
>();

const resolveGlyphWindowInfluence = (
	center: number,
	glyphStart: number,
	glyphEnd: number,
	radius: number,
): number => {
	if (radius <= 0) return 0;
	const glyphCenter = (glyphStart + glyphEnd) * 0.5;
	const distance = Math.abs(center - glyphCenter);
	if (distance >= radius) {
		return 0;
	}
	const normalizedDistance = distance / radius;
	return Math.cos(normalizedDistance * Math.PI * 0.5) ** 2;
};

const buildGlyphObjects = (slice: FancyGlyphSlice) => {
	return slice.glyphIds.map((glyphId, index) => ({
		id: glyphId,
		pos: slice.positions[index] ?? { x: 0, y: 0 },
	}));
};

const createRenderFont = (typeface: SkTypeface, fontSize: number): SkFont => {
	const font = Skia.Font(typeface, fontSize);
	font.setEdging(FontEdging.SubpixelAntiAlias);
	font.setEmbeddedBitmaps(false);
	font.setHinting(FontHinting.None);
	font.setSubpixel(true);
	font.setLinearMetrics(true);
	return font;
};

const FancyTextRenderer: React.FC<FancyTextRendererProps> = ({ id }) => {
	const paragraph = useFancyTextSelector(
		id,
		(state) => state.internal.paragraph,
	);
	const color = useFancyTextSelector(id, (state) => state.props.color);
	const waveRadius = useFancyTextSelector(
		id,
		(state) => state.props.waveRadius,
	);
	const waveTranslateY = useFancyTextSelector(
		id,
		(state) => state.props.waveTranslateY,
	);
	const waveScale = useFancyTextSelector(id, (state) => state.props.waveScale);
	const currentTime = useRenderTime();
	const element = useTimelineStore((state) => state.getElementById(id));
	const width = Math.max(1, element?.transform?.baseSize.width ?? 1);
	const start = element?.timeline.start ?? 0;
	const end = element?.timeline.end ?? start + 1;
	const safeWaveRadius = waveRadius ?? 48;
	const safeWaveTranslateY = waveTranslateY ?? 8;
	const safeWaveScale = waveScale ?? 0.16;

	const sweepProgress = useMemo(() => {
		const duration = end - start;
		if (!Number.isFinite(duration) || duration <= 0) {
			return 1;
		}
		const relativeTime = Math.min(
			Math.max(0, currentTime - start),
			Math.max(0, duration),
		);
		return relativeTime / duration;
	}, [currentTime, end, start]);

	const layoutData = useMemo(() => {
		if (!paragraph) return null;
		try {
			paragraph.layout(width);
			const shapedLines = paragraph.getShapedLines();
			return {
				glyphSlices: buildFancyGlyphSlices(shapedLines, null).inactiveSlices,
			};
		} catch (error) {
			console.warn("FancyText layout failed:", error);
			return null;
		}
	}, [paragraph, width]);

	const renderData = useMemo(() => {
		const disposableFonts: SkFont[] = [];
		const resolveSliceFontCache = new WeakMap<
			SkTypeface,
			Map<number, SkFont>
		>();
		const resolveSliceFont = (slice: FancyGlyphSlice): SkFont | null => {
			if (!slice.typeface) return null;
			let fontBySize = resolveSliceFontCache.get(slice.typeface);
			if (!fontBySize) {
				fontBySize = new Map<number, SkFont>();
				resolveSliceFontCache.set(slice.typeface, fontBySize);
			}
			const cached = fontBySize.get(slice.fontSize);
			if (cached) {
				return cached;
			}
			const created = createRenderFont(slice.typeface, slice.fontSize);
			fontBySize.set(slice.fontSize, created);
			disposableFonts.push(created);
			return created;
		};

		if (!layoutData || layoutData.glyphSlices.length === 0) {
			return {
				glyphSlices: [] as Array<{ slice: FancyGlyphSlice; font: SkFont }>,
				pathItems: [] as Array<{ key: string; path: SkPath }>,
				fonts: disposableFonts,
				canRenderGlyphs: true,
			};
		}

		const slicesWithFonts = layoutData.glyphSlices.map((slice) => ({
			slice,
			font: resolveSliceFont(slice),
		}));
		if (slicesWithFonts.some((item) => item.font === null)) {
			return {
				glyphSlices: [] as Array<{ slice: FancyGlyphSlice; font: SkFont }>,
				pathItems: [] as Array<{ key: string; path: SkPath }>,
				fonts: disposableFonts,
				canRenderGlyphs: false,
			};
		}

		let flowCursor = 0;
		const preparedSlices = slicesWithFonts.map((item) => {
			const { slice, font } = item;
			const preparedGlyphs = slice.glyphIds.map((_glyphId, glyphIndex) => {
				const advance = slice.advances[glyphIndex] ?? 1;
				const glyphStart = flowCursor;
				const glyphEnd = glyphStart + advance;
				flowCursor = glyphEnd;
				return {
					glyphStart,
					glyphEnd,
				};
			});
			return {
				slice,
				font: font as SkFont,
				preparedGlyphs,
			};
		});

		const totalFlowLength = flowCursor;
		if (!Number.isFinite(totalFlowLength) || totalFlowLength <= 0) {
			return {
				glyphSlices: preparedSlices.map((item) => ({
					slice: item.slice,
					font: item.font,
				})),
				pathItems: [] as Array<{ key: string; path: SkPath }>,
				fonts: disposableFonts,
				canRenderGlyphs: true,
			};
		}

		const travelStart = -safeWaveRadius;
		const travelEnd = totalFlowLength + safeWaveRadius;
		const windowCenter =
			travelStart + (travelEnd - travelStart) * sweepProgress;

		const glyphSlices: Array<{ slice: FancyGlyphSlice; font: SkFont }> = [];
		const pathItems: Array<{ key: string; path: SkPath }> = [];

		preparedSlices.forEach(({ slice, font, preparedGlyphs }, sliceIndex) => {
			let hasInfluence = false;
			const rsxforms = slice.positions.map((position, glyphIndex) => {
				const advance = slice.advances[glyphIndex] ?? 1;
				const preparedGlyph = preparedGlyphs[glyphIndex];
				const glyphStart = preparedGlyph?.glyphStart ?? 0;
				const glyphEnd = preparedGlyph?.glyphEnd ?? glyphStart + advance;
				const influence = resolveGlyphWindowInfluence(
					windowCenter,
					glyphStart,
					glyphEnd,
					safeWaveRadius,
				);
				if (influence > 0.0001) {
					hasInfluence = true;
				}
				const scale = 1 + safeWaveScale * influence;
				const translateY = -safeWaveTranslateY * influence;
				return Skia.RSXform(scale, 0, position.x, position.y + translateY);
			});

			if (!hasInfluence) {
				glyphSlices.push({
					slice,
					font,
				});
				return;
			}

			const path = Skia.Path.MakeFromRSXformGlyphs(
				slice.glyphIds,
				rsxforms,
				font,
			);
			if (!path) {
				glyphSlices.push({
					slice,
					font,
				});
				return;
			}

			pathItems.push({
				key: `${slice.start}-${slice.end}-${sliceIndex}`,
				path,
			});
		});

		return {
			glyphSlices,
			pathItems,
			fonts: disposableFonts,
			canRenderGlyphs: true,
		};
	}, [
		layoutData,
		safeWaveRadius,
		safeWaveScale,
		safeWaveTranslateY,
		sweepProgress,
	]);

	useEffect(() => {
		return () => {
			for (const item of renderData.pathItems) {
				item.path.dispose();
			}
			for (const font of renderData.fonts) {
				font.dispose();
			}
		};
	}, [renderData.fonts, renderData.pathItems]);

	if (!paragraph) return null;
	if (!layoutData || !renderData.canRenderGlyphs) {
		return <Paragraph paragraph={paragraph} x={0} y={0} width={width} />;
	}

	return (
		<Group>
			{renderData.glyphSlices.map((item, index) => (
				<Glyphs
					key={`inactive-${item.slice.start}-${item.slice.end}-${index}`}
					font={item.font}
					glyphs={buildGlyphObjects(item.slice)}
					color={color}
				/>
			))}
			{renderData.pathItems.map((item) => (
				<Path key={item.key} path={item.path} color={color} />
			))}
		</Group>
	);
};

export default FancyTextRenderer;
