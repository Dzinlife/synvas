import { DashPathEffect, Group, Line, Rect } from "react-skia-lite";
import {
	FOCUS_SCENE_CORNER_HANDLE_SIZE_PX,
} from "./focusSceneHandleGeometry";
import type { FocusSnapGuides } from "./useFocusSceneSkiaInteractions";
import type {
	FocusTransformHandle,
	FocusTransformHandleRenderItem,
} from "./focusSceneHandleGeometry";
import type { FocusFrame, FocusRect } from "./focusSceneCoordinates";
import type { SkiaPointerEvent } from "react-skia-lite";

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
	disabled?: boolean;
	onLayerPointerDown: (event: SkiaPointerEvent) => void;
	onLayerPointerMove: (event: SkiaPointerEvent) => void;
	onLayerPointerUp: (event: SkiaPointerEvent) => void;
	onLayerPointerLeave: () => void;
}

const HANDLE_SIZE_PX = FOCUS_SCENE_CORNER_HANDLE_SIZE_PX;

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
	disabled = false,
	onLayerPointerDown,
	onLayerPointerMove,
	onLayerPointerUp,
	onLayerPointerLeave,
}: FocusSceneSkiaLayerProps) => {
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
			</Group>
		</Group>
	);
};
