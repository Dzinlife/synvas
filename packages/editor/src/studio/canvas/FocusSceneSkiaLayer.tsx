import { DashPathEffect, Group, Line, Rect } from "react-skia-lite";
import type {
	FocusSnapGuides,
	FocusTransformHandle,
	FocusTransformHandleRenderItem,
} from "./useFocusSceneSkiaInteractions";
import { FOCUS_SCENE_HANDLE_SIZE_PX } from "./focusSceneHandleGeometry";
import type { FocusFrame, FocusRect } from "./focusSceneCoordinates";
import type { SkiaPointerEvent } from "react-skia-lite";

interface FocusSceneSkiaLayerElement {
	id: string;
	frameScreen: FocusFrame;
}

interface FocusSceneSkiaLayerProps {
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

const HANDLE_SIZE_PX = FOCUS_SCENE_HANDLE_SIZE_PX;

const resolveHandleCursor = (handle: FocusTransformHandle): string => {
	switch (handle) {
		case "top-left":
		case "bottom-right":
			return "nwse-resize";
		case "top-right":
		case "bottom-left":
			return "nesw-resize";
		case "top-center":
		case "bottom-center":
			return "ns-resize";
		case "middle-left":
		case "middle-right":
			return "ew-resize";
		case "rotater":
			return "grab";
		default:
			return "default";
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
						<Rect
							x={-selectionFrameScreen.width / 2}
							y={-selectionFrameScreen.height / 2}
							width={selectionFrameScreen.width}
							height={selectionFrameScreen.height}
							style="stroke"
							strokeWidth={1}
							color="rgba(255,0,0,0.7)"
						/>
					</Group>
				)}
				{handleItems.map((item) => {
					const isActive = activeHandle === item.handle;
					const isRotater = item.handle === "rotater";
					if (isRotater) {
						return (
							<Rect
								key={`focus-scene-handle-${item.handle}`}
								x={item.screenX - HANDLE_SIZE_PX / 2}
								y={item.screenY - HANDLE_SIZE_PX / 2}
								width={HANDLE_SIZE_PX}
								height={HANDLE_SIZE_PX}
								style="stroke"
								strokeWidth={1.25}
								color={isActive ? "rgba(255,0,0,1)" : "rgba(255,255,255,1)"}
								cursor={resolveHandleCursor(item.handle)}
							/>
						);
					}
					return (
						<Rect
							key={`focus-scene-handle-${item.handle}`}
							x={item.screenX - HANDLE_SIZE_PX / 2}
							y={item.screenY - HANDLE_SIZE_PX / 2}
							width={HANDLE_SIZE_PX}
							height={HANDLE_SIZE_PX}
							color={isActive ? "rgba(255,0,0,1)" : "rgba(0,0,0,1)"}
							cursor={resolveHandleCursor(item.handle)}
						/>
					);
				})}
				{handleItems
					.filter((item) => item.handle !== "rotater")
					.map((item) => (
						<Rect
							key={`focus-scene-handle-border-${item.handle}`}
							x={item.screenX - HANDLE_SIZE_PX / 2}
							y={item.screenY - HANDLE_SIZE_PX / 2}
							width={HANDLE_SIZE_PX}
							height={HANDLE_SIZE_PX}
							style="stroke"
							strokeWidth={1}
							color="rgba(255,255,255,1)"
							pointerEvents="none"
						/>
					))}
			</Group>
		</Group>
	);
};
