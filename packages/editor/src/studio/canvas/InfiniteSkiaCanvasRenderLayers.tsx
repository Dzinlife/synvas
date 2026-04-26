import type React from "react";
import { memo, useMemo } from "react";
import {
	Group,
	Image,
	type Matrix4,
	Rect,
	type SharedValue,
	Text,
	useDerivedValue,
	useFont,
} from "react-skia-lite";
import type { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import type { CanvasNode, StudioProject } from "@/studio/project/types";
import { getCanvasNodeDefinition } from "@/node-system/registry";
import type { CanvasNodeSkiaRenderProps } from "@/node-system/types";
import type { CanvasNodeLayoutState } from "./canvasNodeLabelUtils";
import { resolveCanvasNodeLayoutWorldRect } from "./canvasNodeLabelUtils";
import type { CameraState } from "./canvasWorkspaceUtils";
import type { TileAabb, TileDebugItem, TileDrawItem } from "./tile";
import { TILE_CAMERA_EPSILON } from "./tile";
import type { FrozenNodeRasterSnapshot } from "./infiniteSkiaCanvasTilePipeline";
import { resolveTileDrawBleed } from "./infiniteSkiaCanvasTilePipeline";
import { LAYOUT_EPSILON } from "./infiniteSkiaCanvasNodeUtils";

const TILE_DEBUG_COORD_LABEL_LIMIT = 96;
const TILE_DEBUG_FONT_URI = "/Roboto-Medium.ttf";
const TILE_DEBUG_FONT_SIZE_PX = 10;
const TILE_DEBUG_TEXT_COLOR = "rgba(255,255,255,0.96)";
const TILE_DEBUG_LABEL_OFFSET_X = 4;
const TILE_DEBUG_LABEL_OFFSET_Y = 4;

const resolvePixelRoundedTileClip = (
	tile: TileDrawItem,
	camera: CameraState,
) => {
	const safeZoom = Math.max(camera.zoom, TILE_CAMERA_EPSILON);
	const screenLeft = Math.round((tile.left + camera.x) * safeZoom);
	const screenTop = Math.round((tile.top + camera.y) * safeZoom);
	const screenRight = Math.round((tile.left + tile.size + camera.x) * safeZoom);
	const screenBottom = Math.round((tile.top + tile.size + camera.y) * safeZoom);
	return {
		x: screenLeft / safeZoom - camera.x,
		y: screenTop / safeZoom - camera.y,
		width: Math.max(0, (screenRight - screenLeft) / safeZoom),
		height: Math.max(0, (screenBottom - screenTop) / safeZoom),
	};
};

const resolveClippedWorldRect = (
	layout: CanvasNodeLayoutState,
	ancestorClipAabbs: readonly TileAabb[],
) => {
	const worldRect = resolveCanvasNodeLayoutWorldRect(layout);
	let left = worldRect.left;
	let top = worldRect.top;
	let right = worldRect.right;
	let bottom = worldRect.bottom;
	for (const clipAabb of ancestorClipAabbs) {
		left = Math.max(left, clipAabb.left);
		top = Math.max(top, clipAabb.top);
		right = Math.min(right, clipAabb.right);
		bottom = Math.min(bottom, clipAabb.bottom);
		if (left >= right || top >= bottom) {
			return {
				x: left,
				y: top,
				width: 0,
				height: 0,
			};
		}
	}
	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	};
};

interface CanvasNodeRenderItemProps {
	node: CanvasNode;
	layout: SharedValue<CanvasNodeLayoutState>;
	scene: StudioProject["scenes"][string] | null;
	asset: StudioProject["assets"][number] | null;
	isActive: boolean;
	isFocused: boolean;
	ancestorClipAabbs: readonly TileAabb[];
	runtimeManager: ReturnType<typeof useStudioRuntimeManager>;
}

const CanvasNodeRenderItemComponent = ({
	node,
	layout,
	scene,
	asset,
	isActive,
	isFocused,
	ancestorClipAabbs,
	runtimeManager,
}: CanvasNodeRenderItemProps) => {
	const definition = getCanvasNodeDefinition(node.type);
	const Renderer = definition.skiaRenderer as React.ComponentType<
		CanvasNodeSkiaRenderProps<CanvasNode>
	>;
	const clip = useDerivedValue(() => {
		return resolveClippedWorldRect(layout.value, ancestorClipAabbs);
	});
	const renderTransform = useDerivedValue(() => {
		const safeWidth = Math.max(Math.abs(node.width), LAYOUT_EPSILON);
		const safeHeight = Math.max(Math.abs(node.height), LAYOUT_EPSILON);
		const scaleX = layout.value.width / safeWidth;
		const scaleY = layout.value.height / safeHeight;
		const matrix: Matrix4 = [
			scaleX,
			0,
			0,
			layout.value.x,
			0,
			scaleY,
			0,
			layout.value.y,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
		];
		return [
			{
				matrix,
			},
		];
	});

	return (
		<Group clip={clip}>
			<Group transform={renderTransform}>
				<Renderer
					node={node}
					scene={scene}
					asset={asset}
					isActive={isActive}
					isFocused={isFocused}
					runtimeManager={runtimeManager}
				/>
			</Group>
		</Group>
	);
};

const CanvasNodeRenderItem = memo(CanvasNodeRenderItemComponent);
CanvasNodeRenderItem.displayName = "CanvasNodeRenderItem";

interface CanvasNodeFrozenRenderItemProps {
	node: CanvasNode;
	layout: SharedValue<CanvasNodeLayoutState>;
	ancestorClipAabbs: readonly TileAabb[];
	snapshot: FrozenNodeRasterSnapshot;
}

const CanvasNodeFrozenRenderItemComponent = ({
	node,
	layout,
	ancestorClipAabbs,
	snapshot,
}: CanvasNodeFrozenRenderItemProps) => {
	const clip = useDerivedValue(() => {
		return resolveClippedWorldRect(layout.value, ancestorClipAabbs);
	});
	const renderTransform = useDerivedValue(() => {
		const safeWidth = Math.max(Math.abs(node.width), LAYOUT_EPSILON);
		const safeHeight = Math.max(Math.abs(node.height), LAYOUT_EPSILON);
		const scaleX = layout.value.width / safeWidth;
		const scaleY = layout.value.height / safeHeight;
		const matrix: Matrix4 = [
			scaleX,
			0,
			0,
			layout.value.x,
			0,
			scaleY,
			0,
			layout.value.y,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
		];
		return [
			{
				matrix,
			},
		];
	});
	const width = Math.max(1, Math.abs(node.width));
	const height = Math.max(1, Math.abs(node.height));

	return (
		<Group clip={clip}>
			<Group transform={renderTransform}>
				<Image
					image={snapshot.image}
					x={0}
					y={0}
					width={width}
					height={height}
					fit="fill"
				/>
			</Group>
		</Group>
	);
};

const CanvasNodeFrozenRenderItem = memo(CanvasNodeFrozenRenderItemComponent);
CanvasNodeFrozenRenderItem.displayName = "CanvasNodeFrozenRenderItem";

const StaticTileImageItemComponent = ({
	tile,
	camera,
}: {
	tile: TileDrawItem;
	camera: SharedValue<CameraState>;
}) => {
	// Image 仍保留 bleed，clip 只把 tile 归属边界吸附到屏幕像素，避免半透明边界叠画。
	const clip = useDerivedValue(() => {
		return resolvePixelRoundedTileClip(tile, camera.value);
	});
	// 按纹理 texel 轻微外扩，避免缩放/采样导致 tile 边界出现黑缝
	const bleed = resolveTileDrawBleed(tile);
	const drawX = tile.left - bleed;
	const drawY = tile.top - bleed;
	const drawSize = tile.size + bleed * 2;
	return (
		<Group clip={clip} pointerEvents="none">
			<Image
				image={tile.image}
				x={drawX}
				y={drawY}
				width={drawSize}
				height={drawSize}
				fit="fill"
				pointerEvents="none"
			/>
		</Group>
	);
};

const StaticTileImageItem = memo(StaticTileImageItemComponent);
StaticTileImageItem.displayName = "StaticTileImageItem";

const StaticTileLayerComponent = ({
	drawItems,
	camera,
}: {
	drawItems: TileDrawItem[];
	camera: SharedValue<CameraState>;
}) => {
	if (drawItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{drawItems.map((tile) => (
				<StaticTileImageItem
					key={`tile-ready-${tile.key}`}
					tile={tile}
					camera={camera}
				/>
			))}
		</Group>
	);
};
const StaticTileLayer = memo(StaticTileLayerComponent);
StaticTileLayer.displayName = "StaticTileLayer";

const resolveTileDebugStrokeColor = (state: TileDebugItem["state"]): string => {
	if (state === "READY") return "rgba(34,197,94,0.96)";
	if (state === "QUEUED") return "rgba(245,158,11,0.96)";
	if (state === "RENDERING") return "rgba(56,189,248,0.96)";
	if (state === "STALE") return "rgba(239,68,68,0.96)";
	return "rgba(156,163,175,0.96)";
};

const resolveTileDebugFillColor = (state: TileDebugItem["state"]): string => {
	if (state === "READY") return "rgba(34,197,94,0.12)";
	if (state === "QUEUED") return "rgba(245,158,11,0.12)";
	if (state === "RENDERING") return "rgba(56,189,248,0.12)";
	if (state === "STALE") return "rgba(239,68,68,0.12)";
	return "rgba(156,163,175,0.08)";
};

const resolveTileDebugLabel = (
	item: TileDebugItem,
	includeCoord: boolean,
): string => {
	const parts = [
		`L${item.lod}`,
		item.state,
		item.queued ? "Q1" : "Q0",
		item.hasImage ? "I1" : "I0",
		item.coverMode,
		`E${item.lastRenderedEpoch}`,
	];
	if (item.coverSourceLod !== null) {
		parts.push(`S${item.coverSourceLod}`);
	}
	if (item.isFallback) {
		parts.push("FB1");
	}
	if (includeCoord) {
		parts.unshift(`${item.tx},${item.ty}`);
	}
	return parts.join(" ");
};

const resolveTileDebugTextTransform = (
	left: number,
	top: number,
	inverseZoom: number,
): Array<{ matrix: Matrix4 }> => {
	const matrix: Matrix4 = [
		inverseZoom,
		0,
		0,
		left + TILE_DEBUG_LABEL_OFFSET_X * inverseZoom,
		0,
		inverseZoom,
		0,
		top + (TILE_DEBUG_LABEL_OFFSET_Y + TILE_DEBUG_FONT_SIZE_PX) * inverseZoom,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
	];
	return [{ matrix }];
};

const TileDebugLayerComponent = ({
	debugItems,
	cameraZoom,
}: {
	debugItems: TileDebugItem[];
	cameraZoom: number;
}) => {
	const labeledItems = useMemo(() => {
		const includeCoord = debugItems.length <= TILE_DEBUG_COORD_LABEL_LIMIT;
		return debugItems.map((item) => {
			return {
				item,
				label: resolveTileDebugLabel(item, includeCoord),
			};
		});
	}, [debugItems]);
	const tileDebugFont = useFont(TILE_DEBUG_FONT_URI, TILE_DEBUG_FONT_SIZE_PX);
	const safeZoom = Math.max(cameraZoom, TILE_CAMERA_EPSILON);
	const inverseZoom = 1 / safeZoom;

	if (labeledItems.length <= 0) return null;
	return (
		<Group pointerEvents="none">
			{labeledItems.map(({ item, label }) => {
				return (
					<Group key={`tile-debug-${item.key}`} pointerEvents="none">
						<Rect
							x={item.left}
							y={item.top}
							width={item.size}
							height={item.size}
							color={resolveTileDebugFillColor(item.state)}
							pointerEvents="none"
						/>
						<Rect
							x={item.left}
							y={item.top}
							width={item.size}
							height={item.size}
							style="stroke"
							strokeWidth={1}
							color={resolveTileDebugStrokeColor(item.state)}
							pointerEvents="none"
						/>
						{tileDebugFont && (
							<Group
								transform={resolveTileDebugTextTransform(
									item.left,
									item.top,
									inverseZoom,
								)}
								pointerEvents="none"
							>
								<Text
									text={label}
									x={0}
									y={0}
									font={tileDebugFont}
									color={TILE_DEBUG_TEXT_COLOR}
									pointerEvents="none"
								/>
							</Group>
						)}
					</Group>
				);
			})}
		</Group>
	);
};
const TileDebugLayer = memo(TileDebugLayerComponent);
TileDebugLayer.displayName = "TileDebugLayer";

export {
	CanvasNodeFrozenRenderItem,
	CanvasNodeRenderItem,
	StaticTileLayer,
	TileDebugLayer,
};
