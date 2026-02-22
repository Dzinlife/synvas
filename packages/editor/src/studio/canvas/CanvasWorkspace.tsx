import type { SceneNode } from "core/studio/types";
import type Konva from "konva";
import { Plus, Search, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import SceneTimelineDrawer from "@/editor/components/SceneTimelineDrawer";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import MaterialLibrary from "@/editor/MaterialLibrary";
import PreviewEditor from "@/editor/PreviewEditor";
import { useProjectStore } from "@/projects/projectStore";
import {
	type SceneNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { setScenePoster } from "./scenePosterCache";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const GRID_SIZE = 100;
const GRID_RANGE = 16000;

const pickLayout = (node: SceneNode): SceneNodeLayoutSnapshot => ({
	x: node.x,
	y: node.y,
	width: node.width,
	height: node.height,
	zIndex: node.zIndex,
	hidden: node.hidden,
	locked: node.locked,
});

const isLayoutEqual = (
	before: SceneNodeLayoutSnapshot,
	after: SceneNodeLayoutSnapshot,
): boolean => {
	return (
		before.x === after.x &&
		before.y === after.y &&
		before.width === after.width &&
		before.height === after.height &&
		before.zIndex === after.zIndex &&
		before.hidden === after.hidden &&
		before.locked === after.locked
	);
};

const clampZoom = (zoom: number): number => {
	return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
};

const CanvasWorkspace = () => {
	const currentProject = useProjectStore((state) => state.currentProject);
	const createSceneNode = useProjectStore((state) => state.createSceneNode);
	const updateSceneNodeLayout = useProjectStore(
		(state) => state.updateSceneNodeLayout,
	);
	const setFocusedScene = useProjectStore((state) => state.setFocusedScene);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setCanvasCamera = useProjectStore((state) => state.setCanvasCamera);
	const updateSceneTimeline = useProjectStore(
		(state) => state.updateSceneTimeline,
	);
	const updateScenePosterFrame = useProjectStore(
		(state) => state.updateScenePosterFrame,
	);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	const focusedSceneId = currentProject?.ui.focusedSceneId ?? null;
	const activeSceneId = currentProject?.ui.activeSceneId ?? null;
	const camera = currentProject?.ui.camera ?? { x: 0, y: 0, zoom: 1 };
	const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const stageRef = useRef<Konva.Stage | null>(null);
	const transformerRef = useRef<Konva.Transformer | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const dragBeforeRef = useRef<Map<string, SceneNodeLayoutSnapshot>>(new Map());
	const transformBeforeRef = useRef<Map<string, SceneNodeLayoutSnapshot>>(
		new Map(),
	);
	const dragMovedRef = useRef(false);

	const sortedNodes = useMemo(() => {
		if (!currentProject) return [];
		return [...currentProject.canvas.nodes]
			.filter((node) => !node.hidden)
			.sort((a, b) => {
				if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
				return a.createdAt - b.createdAt;
			});
	}, [currentProject]);

	const focusedScene = useMemo(() => {
		if (!focusedSceneId) return null;
		return currentProject?.scenes[focusedSceneId] ?? null;
	}, [currentProject, focusedSceneId]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			setStageSize({
				width: rect.width,
				height: rect.height,
			});
		};
		updateSize();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateSize);
			return () => window.removeEventListener("resize", updateSize);
		}
		const observer = new ResizeObserver(updateSize);
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const transformer = transformerRef.current;
		const stage = stageRef.current;
		if (!transformer || !stage) return;
		if (!selectedNodeId) {
			transformer.nodes([]);
			transformer.getLayer()?.batchDraw();
			return;
		}
		const hasSelectedNode = sortedNodes.some(
			(node) => node.id === selectedNodeId,
		);
		if (!hasSelectedNode) {
			transformer.nodes([]);
			transformer.getLayer()?.batchDraw();
			return;
		}
		const node = stage.findOne(
			`.scene-node-${selectedNodeId}`,
		) as Konva.Rect | null;
		if (!node) {
			transformer.nodes([]);
			transformer.getLayer()?.batchDraw();
			return;
		}
		transformer.nodes([node]);
		transformer.getLayer()?.batchDraw();
	}, [selectedNodeId, sortedNodes]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (!focusedSceneId) return;
			event.preventDefault();
			setFocusedScene(null);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [focusedSceneId, setFocusedScene]);

	const handleCreateScene = useCallback(() => {
		const sceneId = createSceneNode();
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject) return;
		const scene = latestProject.scenes[sceneId];
		const node = latestProject.canvas.nodes.find(
			(item) => item.sceneId === sceneId,
		);
		if (!scene || !node) return;
		pushHistory({
			kind: "canvas.scene-create",
			scene,
			node,
			focusSceneId: latestProject.ui.focusedSceneId,
		});
		setSelectedNodeId(node.id);
	}, [createSceneNode, pushHistory]);

	const handleZoomByStep = useCallback(
		(multiplier: number) => {
			const nextZoom = clampZoom(camera.zoom * multiplier);
			if (nextZoom === camera.zoom) return;
			setCanvasCamera({
				...camera,
				zoom: nextZoom,
			});
		},
		[camera, setCanvasCamera],
	);

	const handleResetView = useCallback(() => {
		setCanvasCamera({ x: 0, y: 0, zoom: 1 });
	}, [setCanvasCamera]);

	const handleExitFocus = useCallback(() => {
		if (!focusedSceneId || !focusedScene) {
			setFocusedScene(null);
			return;
		}
		const timelineState = useTimelineStore.getState();
		const posterFrame = timelineState.previewTime ?? timelineState.currentTime;
		setScenePoster(focusedSceneId, posterFrame, null);
		updateSceneTimeline(
			focusedSceneId,
			{
				...focusedScene.timeline,
			},
			{ recordHistory: false },
		);
		updateScenePosterFrame(focusedSceneId, posterFrame);
		setFocusedScene(null);
	}, [
		focusedScene,
		focusedSceneId,
		setFocusedScene,
		updateScenePosterFrame,
		updateSceneTimeline,
	]);

	const handleStageWheel = useCallback(
		(event: Konva.KonvaEventObject<WheelEvent>) => {
			event.evt.preventDefault();
			const nativeEvent = event.evt;

			if (nativeEvent.ctrlKey) {
				const stage = event.target.getStage();
				if (!stage) return;
				const pointer = stage.getPointerPosition();
				if (!pointer) return;
				const oldZoom = camera.zoom;
				const zoomDelta = nativeEvent.deltaY > 0 ? 0.92 : 1.08;
				const nextZoom = clampZoom(oldZoom * zoomDelta);
				const worldPoint = {
					x: (pointer.x - camera.x) / oldZoom,
					y: (pointer.y - camera.y) / oldZoom,
				};
				setCanvasCamera({
					x: pointer.x - worldPoint.x * nextZoom,
					y: pointer.y - worldPoint.y * nextZoom,
					zoom: nextZoom,
				});
				return;
			}

			const deltaX = nativeEvent.shiftKey
				? nativeEvent.deltaY
				: nativeEvent.deltaX;
			const deltaY = nativeEvent.shiftKey ? 0 : nativeEvent.deltaY;
			setCanvasCamera({
				x: camera.x - deltaX,
				y: camera.y - deltaY,
				zoom: camera.zoom,
			});
		},
		[camera, setCanvasCamera],
	);

	const handleStageMouseDown = useCallback(
		(event: Konva.KonvaEventObject<MouseEvent>) => {
			if (event.target !== event.target.getStage()) return;
			setSelectedNodeId(null);
		},
		[],
	);

	const handleNodeDragStart = useCallback((node: SceneNode) => {
		dragMovedRef.current = false;
		dragBeforeRef.current.set(node.id, pickLayout(node));
	}, []);

	const handleNodeDragMove = useCallback(() => {
		dragMovedRef.current = true;
	}, []);

	const handleNodeDragEnd = useCallback(
		(node: SceneNode, event: Konva.KonvaEventObject<DragEvent>) => {
			const before = dragBeforeRef.current.get(node.id);
			dragBeforeRef.current.delete(node.id);
			const currentNode = event.target;
			const after: SceneNodeLayoutSnapshot = {
				...pickLayout(node),
				x: currentNode.x(),
				y: currentNode.y(),
			};
			updateSceneNodeLayout(node.id, after);
			if (before && !isLayoutEqual(before, after)) {
				pushHistory({
					kind: "canvas.scene-node-layout",
					nodeId: node.id,
					before,
					after,
					focusSceneId: focusedSceneId,
				});
			}
		},
		[focusedSceneId, pushHistory, updateSceneNodeLayout],
	);

	const handleTransformStart = useCallback((node: SceneNode) => {
		transformBeforeRef.current.set(node.id, pickLayout(node));
	}, []);

	const handleTransformEnd = useCallback(
		(node: SceneNode, event: Konva.KonvaEventObject<Event>) => {
			const before = transformBeforeRef.current.get(node.id);
			transformBeforeRef.current.delete(node.id);
			const shape = event.target as Konva.Rect;
			const scaleX = shape.scaleX() || 1;
			const scaleY = shape.scaleY() || 1;
			const nextWidth = Math.max(80, Math.round(shape.width() * scaleX));
			const nextHeight = Math.max(45, Math.round(shape.height() * scaleY));
			shape.scaleX(1);
			shape.scaleY(1);
			shape.width(nextWidth);
			shape.height(nextHeight);
			const after: SceneNodeLayoutSnapshot = {
				...pickLayout(node),
				x: shape.x(),
				y: shape.y(),
				width: nextWidth,
				height: nextHeight,
			};
			updateSceneNodeLayout(node.id, after);
			if (before && !isLayoutEqual(before, after)) {
				pushHistory({
					kind: "canvas.scene-node-layout",
					nodeId: node.id,
					before,
					after,
					focusSceneId: focusedSceneId,
				});
			}
		},
		[focusedSceneId, pushHistory, updateSceneNodeLayout],
	);

	const gridLines = useMemo(() => {
		const lines: React.ReactNode[] = [];
		for (let x = -GRID_RANGE; x <= GRID_RANGE; x += GRID_SIZE) {
			lines.push(
				<Line
					key={`grid-v-${x}`}
					points={[x, -GRID_RANGE, x, GRID_RANGE]}
					stroke={x === 0 ? "#444" : "#2a2a2a"}
					strokeWidth={x === 0 ? 2 : 1}
					listening={false}
				/>,
			);
		}
		for (let y = -GRID_RANGE; y <= GRID_RANGE; y += GRID_SIZE) {
			lines.push(
				<Line
					key={`grid-h-${y}`}
					points={[-GRID_RANGE, y, GRID_RANGE, y]}
					stroke={y === 0 ? "#444" : "#2a2a2a"}
					strokeWidth={y === 0 ? 2 : 1}
					listening={false}
				/>,
			);
		}
		return lines;
	}, []);

	if (!currentProject) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				Loading...
			</div>
		);
	}

	return (
		<div ref={containerRef} className="relative h-full w-full overflow-hidden">
			{focusedSceneId ? (
				<div className="absolute inset-0">
					<PreviewEditor />
					<div
						data-testid="focus-material-library"
						className="absolute left-4 top-4 z-50 w-60 max-h-[45vh] overflow-y-auto rounded-xl border border-white/10 bg-neutral-900/85 p-3 backdrop-blur-xl"
					>
						<div className="mb-2 text-xs font-medium text-white/80">素材库</div>
						<MaterialLibrary />
					</div>
					<SceneTimelineDrawer onExitFocus={handleExitFocus} />
				</div>
			) : (
				<>
					<div className="absolute left-4 top-4 z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white backdrop-blur">
						<button
							type="button"
							onClick={handleCreateScene}
							className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20"
						>
							<Plus className="size-3" />
							<span>新建 Scene</span>
						</button>
						<button
							type="button"
							onClick={() => handleZoomByStep(1.1)}
							className="rounded bg-white/10 p-1 hover:bg-white/20"
							aria-label="放大"
						>
							<Search className="size-3" />
						</button>
						<button
							type="button"
							onClick={() => handleZoomByStep(0.9)}
							className="rounded bg-white/10 p-1 hover:bg-white/20"
							aria-label="缩小"
						>
							<SearchX className="size-3" />
						</button>
						<button
							type="button"
							onClick={handleResetView}
							className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
						>
							重置视图
						</button>
						<span className="text-white/70">
							{Math.round(camera.zoom * 100)}%
						</span>
					</div>
					<Stage
						ref={stageRef}
						width={stageSize.width}
						height={stageSize.height}
						onWheel={handleStageWheel}
						onMouseDown={handleStageMouseDown}
					>
						<Layer>
							<Rect
								x={0}
								y={0}
								width={stageSize.width}
								height={stageSize.height}
								fill="#111"
								listening={false}
							/>
						</Layer>
						<Layer
							x={camera.x}
							y={camera.y}
							scaleX={camera.zoom}
							scaleY={camera.zoom}
						>
							{gridLines}
							{sortedNodes.map((node) => {
								const isActive = node.sceneId === activeSceneId;
								const scene = currentProject.scenes[node.sceneId];
								return [
									<Rect
										key={node.id}
										className={`scene-node-${node.id}`}
										x={node.x}
										y={node.y}
										width={node.width}
										height={node.height}
										cornerRadius={10}
										fill={isActive ? "#1f2937" : "#202020"}
										stroke={selectedNodeId === node.id ? "#f97316" : "#3f3f46"}
										strokeWidth={selectedNodeId === node.id ? 3 : 1}
										draggable={!node.locked}
										onClick={() => {
											if (dragMovedRef.current) {
												dragMovedRef.current = false;
												return;
											}
											setSelectedNodeId(node.id);
											setActiveScene(node.sceneId);
											setFocusedScene(node.sceneId);
										}}
										onDragStart={() => handleNodeDragStart(node)}
										onDragMove={handleNodeDragMove}
										onDragEnd={(event) => handleNodeDragEnd(node, event)}
										onTransformStart={() => handleTransformStart(node)}
										onTransformEnd={(event) => handleTransformEnd(node, event)}
									/>,
									<Text
										key={`${node.id}-label`}
										x={node.x + 12}
										y={node.y + 12}
										text={`${scene?.name ?? node.name}\nPoster: ${scene?.posterFrame ?? 0}f`}
										fontSize={16}
										fill="#f5f5f5"
										listening={false}
									/>,
								];
							})}
							<Transformer
								ref={transformerRef}
								enabledAnchors={[
									"top-left",
									"top-right",
									"bottom-left",
									"bottom-right",
								]}
								rotateEnabled={false}
								ignoreStroke
							/>
						</Layer>
					</Stage>
				</>
			)}
		</div>
	);
};

export default CanvasWorkspace;
