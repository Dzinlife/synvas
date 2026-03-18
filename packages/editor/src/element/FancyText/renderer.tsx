import React, { useEffect, useMemo } from "react";
import {
	FontEdging,
	FontHinting,
	Glyphs,
	Group,
	Path,
	Paragraph,
	Skia,
	type SkPath,
} from "react-skia-lite";
import {
	useRenderTime,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { createModelSelector } from "../model/registry";
import {
	buildFancyGlyphSlices,
	type FancyGlyphSlice,
} from "./helpers";
import type { FancyTextInternal, FancyTextProps } from "./model";

interface FancyTextRendererProps {
	id: string;
}

const useFancyTextSelector = createModelSelector<FancyTextProps, FancyTextInternal>();

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

const FancyTextRenderer: React.FC<FancyTextRendererProps> = ({ id }) => {
	const paragraph = useFancyTextSelector(id, (state) => state.internal.paragraph);
	const typeface = useFancyTextSelector(id, (state) => state.internal.typeface);
	const color = useFancyTextSelector(id, (state) => state.props.color);
	const fontSize = useFancyTextSelector(id, (state) => state.props.fontSize);
	const waveRadius = useFancyTextSelector(id, (state) => state.props.waveRadius);
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

	const renderFont = useMemo(() => {
		if (!typeface) return null;
		const nextFont = Skia.Font(typeface, fontSize);
		nextFont.setEdging(FontEdging.SubpixelAntiAlias);
		nextFont.setEmbeddedBitmaps(false);
		nextFont.setHinting(FontHinting.None);
		nextFont.setSubpixel(true);
		nextFont.setLinearMetrics(true);
		return nextFont;
	}, [fontSize, typeface]);

	useEffect(() => {
		return () => {
			renderFont?.dispose();
		};
	}, [renderFont]);

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
		if (!renderFont || !layoutData || layoutData.glyphSlices.length === 0) {
			return {
				glyphSlices: layoutData?.glyphSlices ?? [],
				pathItems: [] as Array<{ key: string; path: SkPath }>,
			};
		}

		let flowCursor = 0;
		const preparedSlices = layoutData.glyphSlices.map((slice) => {
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
				preparedGlyphs,
			};
		});

		const totalFlowLength = flowCursor;
		if (!Number.isFinite(totalFlowLength) || totalFlowLength <= 0) {
			return {
				glyphSlices: layoutData.glyphSlices,
				pathItems: [] as Array<{ key: string; path: SkPath }>,
			};
		}

		const travelStart = -safeWaveRadius;
		const travelEnd = totalFlowLength + safeWaveRadius;
		const windowCenter = travelStart + (travelEnd - travelStart) * sweepProgress;

		const glyphSlices: FancyGlyphSlice[] = [];
		const pathItems: Array<{ key: string; path: SkPath }> = [];

		preparedSlices.forEach(({ slice, preparedGlyphs }, sliceIndex) => {
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
				glyphSlices.push(slice);
				return;
			}

			const path = Skia.Path.MakeFromRSXformGlyphs(
				slice.glyphIds,
				rsxforms,
				renderFont,
			);
			if (!path) {
				glyphSlices.push(slice);
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
		};
	}, [
		layoutData,
		renderFont,
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
		};
	}, [renderData.pathItems]);

	if (!paragraph) return null;
	if (!renderFont || !layoutData) {
		return <Paragraph paragraph={paragraph} x={0} y={0} width={width} />;
	}

	return (
		<Group>
			{renderData.glyphSlices.map((slice, index) => (
				<Glyphs
					key={`inactive-${slice.start}-${slice.end}-${index}`}
					font={renderFont}
					glyphs={buildGlyphObjects(slice)}
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
