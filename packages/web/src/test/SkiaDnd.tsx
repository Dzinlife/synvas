import Konva from "konva";
import { useCallback, useRef, useState } from "react";
import { Rect as KonvaRect, Layer, Stage } from "react-konva";
import { Canvas, Fill, Group, Rect } from "react-skia-lite";

interface RectData {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
}

const initialRects: RectData[] = [
	{ id: "1", x: 50, y: 50, width: 100, height: 80, color: "#3b82f6" },
	{ id: "2", x: 200, y: 100, width: 120, height: 90, color: "#10b981" },
	{ id: "3", x: 100, y: 220, width: 150, height: 70, color: "#f59e0b" },
	{ id: "4", x: 300, y: 180, width: 90, height: 100, color: "#ef4444" },
	{ id: "5", x: 180, y: 320, width: 110, height: 85, color: "#8b5cf6" },
];

export default function SkiaDnd() {
	const [rects, setRects] = useState<RectData[]>(initialRects);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const stageRef = useRef<Konva.Stage>(null);

	const canvasWidth = 600;
	const canvasHeight = 500;

	const handleDragStart = useCallback((id: string) => {
		setDraggingId(id);
	}, []);

	const handleDrag = useCallback(
		(id: string, e: Konva.KonvaEventObject<DragEvent>) => {
			const node = e.target;
			const newX = node.x();
			const newY = node.y();

			setRects((prev) =>
				prev.map((rect) =>
					rect.id === id ? { ...rect, x: newX, y: newY } : rect,
				),
			);
		},
		[],
	);

	const handleDragEnd = useCallback(
		(id: string, e: Konva.KonvaEventObject<DragEvent>) => {
			handleDrag(id, e);
			setDraggingId(null);
		},
		[handleDrag],
	);

	const handleMouseEnter = useCallback(
		(id: string) => {
			if (!draggingId) {
				setHoveredId(id);
			}
		},
		[draggingId],
	);

	const handleMouseLeave = useCallback(() => {
		if (!draggingId) {
			setHoveredId(null);
		}
	}, [draggingId]);

	console.log(rects[0].x, rects[0].y);

	return (
		<div className="canvas-container" style={{ padding: "20px" }}>
			<h2>Skia DnD Demo</h2>
			<p style={{ marginBottom: "20px", color: "#666" }}>
				下层使用 Skia Canvas 绘制，上层使用 Konva 实现交互（hover 高亮和拖动）
			</p>
			<div
				style={{
					position: "relative",
					width: canvasWidth,
					height: canvasHeight,
					border: "1px solid #ddd",
					borderRadius: "8px",
					overflow: "hidden",
					backgroundColor: "#f9fafb",
				}}
			>
				{/* 下层：Skia Canvas */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						pointerEvents: "none",
					}}
				>
					<Canvas style={{ width: canvasWidth, height: canvasHeight }}>
						<Fill color="#f9fafb" />
						<Group>
							{rects.map((rect) => (
								<Rect
									key={rect.id}
									x={rect.x}
									y={rect.y}
									width={rect.width}
									height={rect.height}
									color={rect.color}
								/>
							))}
						</Group>
					</Canvas>
				</div>

				{/* 上层：Konva 交互层 */}
				<Stage
					ref={stageRef}
					width={canvasWidth}
					height={canvasHeight}
					style={{ position: "absolute", top: 0, left: 0 }}
				>
					<Layer>
						{rects.map((rect) => {
							const isHovered = hoveredId === rect.id;
							const isDragging = draggingId === rect.id;

							return (
								<KonvaRect
									key={rect.id}
									x={rect.x}
									y={rect.y}
									width={rect.width}
									height={rect.height}
									fill="transparent"
									stroke={isHovered || isDragging ? "#6366f1" : "transparent"}
									strokeWidth={isHovered || isDragging ? 3 : 0}
									dash={isHovered && !isDragging ? [5, 5] : undefined}
									draggable
									onDragStart={() => handleDragStart(rect.id)}
									onDragMove={(e: Konva.KonvaEventObject<DragEvent>) =>
										handleDrag(rect.id, e)
									}
									onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) =>
										handleDragEnd(rect.id, e)
									}
									onMouseEnter={() => handleMouseEnter(rect.id)}
									onMouseLeave={handleMouseLeave}
									cursor="move"
									shadowBlur={isDragging ? 10 : 0}
									shadowColor={isDragging ? "rgba(0,0,0,0.3)" : undefined}
									shadowOffsetX={isDragging ? 5 : 0}
									shadowOffsetY={isDragging ? 5 : 0}
								/>
							);
						})}
					</Layer>
				</Stage>
			</div>
		</div>
	);
}
