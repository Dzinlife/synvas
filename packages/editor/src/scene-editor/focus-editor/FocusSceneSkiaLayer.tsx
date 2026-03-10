import type { SkFont, SkiaPointerEvent } from "react-skia-lite";
import {
	DashPathEffect,
	Group,
	Line,
	Rect,
	RoundedRect,
	Skia,
	Text,
	useFont,
} from "react-skia-lite";
import type { FocusFrame, FocusRect } from "./focusSceneCoordinates";
import type {
	FocusTransformHandle,
	FocusTransformHandleRenderItem,
} from "./focusSceneHandleGeometry";
import { FOCUS_SCENE_CORNER_HANDLE_SIZE_PX } from "./focusSceneHandleGeometry";
import type {
	FocusSceneLabelItem,
	FocusSnapGuides,
} from "./useFocusSceneSkiaInteractions";

interface FocusSceneSkiaLayerElement {
	id: string;
	frameScreen: FocusFrame;
}

export interface FocusSceneSkiaLayerProps {
	width: number;
	height: number;
	elements: FocusSceneSkiaLayerElement[];
	selectedIds: string[];
	hoveredId: string | null;
	draggingId: string | null;
	selectionRectScreen: FocusRect | null;
	snapGuidesScreen: FocusSnapGuides;
	selectionFrameScreen: FocusFrame | null;
	handleItems: FocusTransformHandleRenderItem[];
	activeHandle: FocusTransformHandle | null;
	labelItems: FocusSceneLabelItem[];
	disabled?: boolean;
	onLayerPointerDown: (event: SkiaPointerEvent) => void;
	onLayerPointerMove: (event: SkiaPointerEvent) => void;
	onLayerPointerUp: (event: SkiaPointerEvent) => void;
	onLayerPointerLeave: () => void;
}

const HANDLE_SIZE_PX = FOCUS_SCENE_CORNER_HANDLE_SIZE_PX;
const LABEL_FONT_SIZE_PX = 12;
const LABEL_HORIZONTAL_PADDING_PX = 12;
const LABEL_VERTICAL_PADDING_PX = 4;
const LABEL_GAP_PX = 20;
const LABEL_FONT_URI = "/Roboto-Medium.ttf";
let cachedLabelFont: ReturnType<typeof Skia.Font> | null = null;

const normalizeLabelRotationDeg = (rotationDeg: number): number => {
	let normalizedRotation = rotationDeg % 90;
	if (rotationDeg % 90 > 45) {
		normalizedRotation -= 90 * Math.ceil(normalizedRotation / 90);
	} else if (rotationDeg % 90 < -45) {
		normalizedRotation -= 90 * Math.floor(normalizedRotation / 90);
	}
	return normalizedRotation;
};

const resolveLabelTranslateY = (
	rotationDeg: number,
	screenWidth: number,
	screenHeight: number,
): number => {
	const rotationMod180 = Math.abs(rotationDeg % 180);
	if (rotationMod180 > 45 && rotationMod180 < 135) {
		return screenWidth / 2 + LABEL_GAP_PX;
	}
	return screenHeight / 2 + LABEL_GAP_PX;
};

const resolveLabelFont = () => {
	if (cachedLabelFont) return cachedLabelFont;
	cachedLabelFont = Skia.Font(undefined, LABEL_FONT_SIZE_PX);
	return cachedLabelFont;
};

const estimateTextWidth = (text: string): number => {
	let units = 0;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x7f) {
			units += 0.6;
			continue;
		}
		if (code >= 0x4e00 && code <= 0x9fff) {
			units += 1;
			continue;
		}
		units += 0.8;
	}
	return Math.max(LABEL_FONT_SIZE_PX * 2, units * LABEL_FONT_SIZE_PX);
};

const resolveTextMetrics = (font: SkFont | null, text: string) => {
	const fallbackAscent = -LABEL_FONT_SIZE_PX * 0.78;
	const fallbackHeight = LABEL_FONT_SIZE_PX;
	const widthFromFont = font ? font.getTextWidth(text) : 0;
	const textWidth =
		Number.isFinite(widthFromFont) && widthFromFont > 0
			? widthFromFont
			: estimateTextWidth(text);
	const metrics = font?.getMetrics();
	const heightFromFont = metrics
		? metrics.descent - metrics.ascent
		: Number.NaN;
	const textHeight =
		Number.isFinite(heightFromFont) && heightFromFont > 0
			? heightFromFont
			: fallbackHeight;
	const ascent =
		metrics && Number.isFinite(metrics.ascent) && metrics.ascent < 0
			? metrics.ascent
			: fallbackAscent;
	return {
		textWidth,
		textHeight,
		ascent,
	};
};

const resolveAnchorHitDrawPriority = (
	item: FocusTransformHandleRenderItem,
): number => {
	switch (item.kind) {
		case "resize-edge":
			return 0;
		case "rotate-corner":
			return 1;
		case "resize-corner":
			return 2;
		default:
			return 0;
	}
};

export const FocusSceneSkiaLayer = ({
	width,
	height,
	elements,
	selectedIds,
	hoveredId,
	draggingId,
	selectionRectScreen,
	snapGuidesScreen,
	selectionFrameScreen,
	handleItems,
	activeHandle,
	labelItems,
	disabled = false,
	onLayerPointerDown,
	onLayerPointerMove,
	onLayerPointerUp,
	onLayerPointerLeave,
}: FocusSceneSkiaLayerProps) => {
	if (width <= 0 || height <= 0) return null;
	const loadedLabelFont = useFont(LABEL_FONT_URI, LABEL_FONT_SIZE_PX);
	const labelFont = loadedLabelFont ?? resolveLabelFont();

	return (
		<Group zIndex={2_000_000} pointerEvents={disabled ? "none" : "auto"}>
			<Group
				hitRect={{ x: 0, y: 0, width, height }}
				onPointerDown={onLayerPointerDown}
				onPointerMove={onLayerPointerMove}
				onPointerUp={onLayerPointerUp}
				onPointerLeave={onLayerPointerLeave}
			>
				<Rect
					x={0}
					y={0}
					width={Math.max(1, width)}
					height={Math.max(1, height)}
					color="rgba(0,0,0,0.0001)"
				/>
				{selectionRectScreen && (
					<>
						<Rect
							x={selectionRectScreen.x}
							y={selectionRectScreen.y}
							width={selectionRectScreen.width}
							height={selectionRectScreen.height}
							color="rgba(59,130,246,0.15)"
						/>
						<Rect
							x={selectionRectScreen.x}
							y={selectionRectScreen.y}
							width={selectionRectScreen.width}
							height={selectionRectScreen.height}
							style="stroke"
							strokeWidth={1}
							color="rgba(59,130,246,0.8)"
						/>
					</>
				)}
				{snapGuidesScreen.vertical.map((x) => (
					<Line
						key={`focus-scene-snap-v-${x}`}
						p1={{ x, y: 0 }}
						p2={{ x, y: height }}
						style="stroke"
						strokeWidth={1}
						color="rgba(59,130,246,0.8)"
					>
						<DashPathEffect intervals={[4, 4]} phase={0} />
					</Line>
				))}
				{snapGuidesScreen.horizontal.map((y) => (
					<Line
						key={`focus-scene-snap-h-${y}`}
						p1={{ x: 0, y }}
						p2={{ x: width, y }}
						style="stroke"
						strokeWidth={1}
						color="rgba(59,130,246,0.8)"
					>
						<DashPathEffect intervals={[4, 4]} phase={0} />
					</Line>
				))}
				{elements.map((item) => {
					const isSelected = selectedIds.includes(item.id);
					const isHovered = hoveredId === item.id;
					const isDragging = draggingId === item.id;
					const strokeColor = isSelected
						? "rgba(255,0,0,1)"
						: isDragging
							? "rgba(255,0,0,0.8)"
							: isHovered
								? "rgba(255,0,0,0.6)"
								: "transparent";
					return (
						<Group
							key={`focus-scene-element-outline-${item.id}`}
							transform={[
								{ translateX: item.frameScreen.cx },
								{ translateY: item.frameScreen.cy },
								{ rotate: item.frameScreen.rotationRad },
							]}
						>
							<Rect
								x={-item.frameScreen.width / 2}
								y={-item.frameScreen.height / 2}
								width={item.frameScreen.width}
								height={item.frameScreen.height}
								style="stroke"
								strokeWidth={1}
								color={strokeColor}
							/>
						</Group>
					);
				})}
				{selectionFrameScreen && selectedIds.length > 0 && (
					<Group
						transform={[
							{ translateX: selectionFrameScreen.cx },
							{ translateY: selectionFrameScreen.cy },
							{ rotate: selectionFrameScreen.rotationRad },
						]}
					>
						<Group
							transform={[
								{ translateX: -selectionFrameScreen.width / 2 },
								{ translateY: -selectionFrameScreen.height / 2 },
							]}
						>
							{[...handleItems]
								.sort((left, right) => {
									return (
										resolveAnchorHitDrawPriority(left) -
										resolveAnchorHitDrawPriority(right)
									);
								})
								.map((item) => (
									<Rect
										key={`focus-scene-anchor-hit-${item.id}`}
										x={item.rectLocal.x}
										y={item.rectLocal.y}
										width={item.rectLocal.width}
										height={item.rectLocal.height}
										color="rgba(0,0,0,0.0001)"
										cursor={item.cursor}
									/>
								))}
							{handleItems
								.filter((item) => item.visibleCornerMarker)
								.map((item) => {
									const isActive = activeHandle === item.handle;
									const cornerMarkerX =
										item.rectLocal.x +
										(item.rectLocal.width - HANDLE_SIZE_PX) / 2;
									const cornerMarkerY =
										item.rectLocal.y +
										(item.rectLocal.height - HANDLE_SIZE_PX) / 2;
									return (
										<Rect
											key={`focus-scene-corner-marker-${item.id}`}
											x={cornerMarkerX}
											y={cornerMarkerY}
											width={HANDLE_SIZE_PX}
											height={HANDLE_SIZE_PX}
											color={isActive ? "rgba(255,0,0,1)" : "rgba(0,0,0,1)"}
											pointerEvents="none"
										/>
									);
								})}
							{handleItems
								.filter((item) => item.visibleCornerMarker)
								.map((item) => {
									const cornerMarkerX =
										item.rectLocal.x +
										(item.rectLocal.width - HANDLE_SIZE_PX) / 2;
									const cornerMarkerY =
										item.rectLocal.y +
										(item.rectLocal.height - HANDLE_SIZE_PX) / 2;
									return (
										<Rect
											key={`focus-scene-corner-marker-border-${item.id}`}
											x={cornerMarkerX}
											y={cornerMarkerY}
											width={HANDLE_SIZE_PX}
											height={HANDLE_SIZE_PX}
											style="stroke"
											strokeWidth={1}
											color="rgba(255,255,255,1)"
											pointerEvents="none"
										/>
									);
								})}
							<Rect
								x={0}
								y={0}
								width={selectionFrameScreen.width}
								height={selectionFrameScreen.height}
								style="stroke"
								strokeWidth={1}
								color="rgba(255,0,0,0.7)"
								pointerEvents="none"
							/>
						</Group>
					</Group>
				)}
				{labelFont &&
					labelItems.map((label) => {
						const text = `${Math.round(label.canvasWidth)} × ${Math.round(
							label.canvasHeight,
						)}`;
						const { textWidth, textHeight, ascent } = resolveTextMetrics(
							labelFont,
							text,
						);
						const badgeWidth = textWidth + LABEL_HORIZONTAL_PADDING_PX * 2;
						const badgeHeight = textHeight + LABEL_VERTICAL_PADDING_PX * 2;
						const normalizedRotationDeg = normalizeLabelRotationDeg(
							label.rotationDeg,
						);
						const normalizedRotationRad =
							(normalizedRotationDeg * Math.PI) / 180;
						const translateY = resolveLabelTranslateY(
							label.rotationDeg,
							label.screenWidth,
							label.screenHeight,
						);
						return (
							<Group
								key={`focus-scene-size-label-${label.id}`}
								pointerEvents="none"
								transform={[
									{ translateX: label.screenX },
									{ translateY: label.screenY },
									{ rotate: normalizedRotationRad },
									{ translateY },
								]}
							>
								<RoundedRect
									x={-badgeWidth / 2}
									y={-badgeHeight / 2}
									width={badgeWidth}
									height={badgeHeight}
									r={badgeHeight / 2}
									color="rgba(0,0,0,0.8)"
									pointerEvents="none"
								/>
								<RoundedRect
									x={-badgeWidth / 2}
									y={-badgeHeight / 2}
									width={badgeWidth}
									height={badgeHeight}
									r={badgeHeight / 2}
									style="stroke"
									strokeWidth={1}
									color="rgba(239,68,68,0.7)"
									pointerEvents="none"
								/>
								<Text
									text={text}
									font={labelFont}
									x={-textWidth / 2}
									y={-textHeight / 2 - ascent}
									color="rgba(239,68,68,1)"
									pointerEvents="none"
								/>
							</Group>
						);
					})}
			</Group>
		</Group>
	);
};
