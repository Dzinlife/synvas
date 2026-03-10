import { useMemo } from "react";
import type { SkiaPointerEvent } from "react-skia-lite";
import {
	DashPathEffect,
	Group,
	Image,
	Line,
	Rect,
	RoundedRect,
} from "react-skia-lite";
import { useSkiaUiTextSprites } from "@/studio/canvas/skia-text";
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
const LABEL_TEXT_COLOR = "rgba(239,68,68,1)";
const LABEL_CANVAS_TEXT_PADDING_PX = 1;
const LABEL_LINE_HEIGHT_MULTIPLIER = 1.2;
const LABEL_FONT_WEIGHT = 300;
const LABEL_FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

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
	const labelTextRequests = useMemo(
		() =>
			labelItems.map((label) => ({
				slotKey: label.id,
				text: `${Math.round(label.canvasWidth)} × ${Math.round(label.canvasHeight)}`,
				style: {
					fontFamily: LABEL_FONT_FAMILY,
					fontSizePx: LABEL_FONT_SIZE_PX,
					fontWeight: LABEL_FONT_WEIGHT,
					lineHeightPx: LABEL_FONT_SIZE_PX * LABEL_LINE_HEIGHT_MULTIPLIER,
					color: LABEL_TEXT_COLOR,
					paddingPx: LABEL_CANVAS_TEXT_PADDING_PX,
				},
			})),
		[labelItems],
	);
	const labelSprites = useSkiaUiTextSprites(labelTextRequests);

	const labelRenderItems = useMemo(() => {
		return labelItems.map((label, index) => {
			const sprite = labelSprites[index];
			return {
				label,
				image: sprite?.image ?? null,
				textWidth: sprite?.textWidth ?? LABEL_FONT_SIZE_PX * 2,
				textHeight: sprite?.textHeight ?? LABEL_FONT_SIZE_PX,
			};
		});
	}, [labelItems, labelSprites]);

	if (width <= 0 || height <= 0) return null;

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
				{labelRenderItems.map((item) => {
					const { label, image, textWidth, textHeight } = item;
					const badgeWidth = textWidth + LABEL_HORIZONTAL_PADDING_PX * 2;
					const badgeHeight = textHeight + LABEL_VERTICAL_PADDING_PX * 2;
					const normalizedRotationDeg = normalizeLabelRotationDeg(
						label.rotationDeg,
					);
					const normalizedRotationRad = (normalizedRotationDeg * Math.PI) / 180;
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
							{image && (
								<Image
									image={image}
									x={-textWidth / 2}
									y={-textHeight / 2}
									width={textWidth}
									height={textHeight}
									fit="fill"
									pointerEvents="none"
								/>
							)}
						</Group>
					);
				})}
			</Group>
		</Group>
	);
};
