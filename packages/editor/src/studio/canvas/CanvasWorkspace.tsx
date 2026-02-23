import type { CanvasNode, SceneNode } from "core/studio/types";
import type Konva from "konva";
import { Plus, Search, SearchX } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SceneTimelineDrawer, {
	SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT,
} from "@/editor/components/SceneTimelineDrawer";
import TimelineContextMenu from "@/editor/components/TimelineContextMenu";
import MaterialLibrary from "@/editor/MaterialLibrary";
import { writeAudioToOpfs } from "@/asr/opfsAudio";
import { writeProjectFileToOpfs } from "@/lib/projectOpfsStorage";
import {
	type CanvasNodeLayoutSnapshot,
	useStudioHistoryStore,
} from "@/studio/history/studioHistoryStore";
import { useProjectStore } from "@/projects/projectStore";
import {
	canvasNodeDefinitionList,
	getCanvasNodeDefinition,
} from "@/studio/canvas/node-system/registry";
import {
	resolveExternalVideoUri,
} from "@/editor/utils/externalVideo";
import FocusSceneKonvaLayer from "./FocusSceneKonvaLayer";
import InfiniteSkiaCanvas from "./InfiniteSkiaCanvas";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const GRID_SIZE = 120;
const CAMERA_ZOOM_EPSILON = 1e-6;
const DROP_GRID_COLUMNS = 4;
const DROP_GRID_OFFSET_X = 48;
const DROP_GRID_OFFSET_Y = 40;
const FILE_PREFIX = "file://";

interface CameraState {
	x: number;
	y: number;
	zoom: number;
}

type CanvasContextMenuState =
	| { open: false }
	| {
			open: true;
			x: number;
			y: number;
			worldX: number;
			worldY: number;
	  };

interface DragState {
	nodeId: string;
	startClientX: number;
	startClientY: number;
	startNodeX: number;
	startNodeY: number;
	before: CanvasNodeLayoutSnapshot;
	moved: boolean;
}

type FileWithPath = File & { path?: string };

const clampZoom = (zoom: number): number => {
	return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
};

const pickLayout = (node: CanvasNode): CanvasNodeLayoutSnapshot => ({
	x: node.x,
	y: node.y,
	width: node.width,
	height: node.height,
	zIndex: node.zIndex,
	hidden: node.hidden,
	locked: node.locked,
});

const isLayoutEqual = (
	before: CanvasNodeLayoutSnapshot,
	after: CanvasNodeLayoutSnapshot,
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

const isSceneNode = (node: CanvasNode): node is SceneNode => {
	return node.type === "scene";
};

const isWorldPointInNode = (
	node: CanvasNode,
	worldX: number,
	worldY: number,
): boolean => {
	const left = Math.min(node.x, node.x + node.width);
	const right = Math.max(node.x, node.x + node.width);
	const top = Math.min(node.y, node.y + node.height);
	const bottom = Math.max(node.y, node.y + node.height);
	return worldX >= left && worldX <= right && worldY >= top && worldY <= bottom;
};

const isCameraAlmostEqual = (
	left: CameraState,
	right: CameraState,
): boolean => {
	return (
		Math.abs(left.x - right.x) < 0.5 &&
		Math.abs(left.y - right.y) < 0.5 &&
		Math.abs(left.zoom - right.zoom) < 0.0001
	);
};

const isElectronEnv = (): boolean => {
	return typeof window !== "undefined" && "aiNleElectron" in window;
};

const getFilePath = (file: File): string | null => {
	const rawPath = (file as FileWithPath).path;
	if (typeof rawPath !== "string") return null;
	const trimmed = rawPath.trim();
	return trimmed ? trimmed : null;
};

const getElectronFilePath = (file: File): string | null => {
	if (typeof window === "undefined") return null;
	const bridge = (
		window as Window & {
			aiNleElectron?: {
				webUtils?: {
					getPathForFile?: (file: File) => string | null | undefined;
				};
			};
		}
	).aiNleElectron;
	const resolved = bridge?.webUtils?.getPathForFile?.(file);
	if (typeof resolved !== "string") return null;
	const trimmed = resolved.trim();
	return trimmed ? trimmed : null;
};

const buildFileUrlFromPath = (rawPath: string): string => {
	if (rawPath.startsWith(FILE_PREFIX)) return rawPath;
	const normalized = rawPath.replace(/\\/g, "/");
	let pathPart = normalized;
	let isUnc = false;
	if (pathPart.startsWith("//")) {
		isUnc = true;
		pathPart = pathPart.slice(2);
	} else if (/^[a-zA-Z]:\//.test(pathPart)) {
		pathPart = `/${pathPart}`;
	} else if (!pathPart.startsWith("/")) {
		pathPart = `/${pathPart}`;
	}
	const encoded = pathPart
		.split("/")
		.map((segment) => {
			if (!segment) return "";
			if (!isUnc && /^[a-zA-Z]:$/.test(segment)) return segment;
			return encodeURIComponent(segment);
		})
		.join("/");
	return `${FILE_PREFIX}${encoded}`;
};

const resolveDroppedFiles = (dataTransfer: DataTransfer | null): File[] => {
	if (!dataTransfer) return [];
	if (dataTransfer.files && dataTransfer.files.length > 0) {
		return Array.from(dataTransfer.files);
	}
	if (!dataTransfer.items) return [];
	return Array.from(dataTransfer.items)
		.map((item) => (item.kind === "file" ? item.getAsFile() : null))
		.filter((file): file is File => Boolean(file));
};

const CanvasWorkspace = () => {
	const currentProject = useProjectStore((state) => state.currentProject);
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const createCanvasNode = useProjectStore((state) => state.createCanvasNode);
	const updateCanvasNode = useProjectStore((state) => state.updateCanvasNode);
	const updateCanvasNodeLayout = useProjectStore(
		(state) => state.updateCanvasNodeLayout,
	);
	const ensureProjectAssetByUri = useProjectStore(
		(state) => state.ensureProjectAssetByUri,
	);
	const setFocusedScene = useProjectStore((state) => state.setFocusedScene);
	const setActiveScene = useProjectStore((state) => state.setActiveScene);
	const setActiveNode = useProjectStore((state) => state.setActiveNode);
	const setCanvasCamera = useProjectStore((state) => state.setCanvasCamera);
	const pushHistory = useStudioHistoryStore((state) => state.push);

	const focusedSceneId = currentProject?.ui.focusedSceneId ?? null;
	const activeSceneId = currentProject?.ui.activeSceneId ?? null;
	const activeNodeId = currentProject?.ui.activeNodeId ?? null;
	const camera = currentProject?.ui.camera ?? { x: 0, y: 0, zoom: 1 };
	const isCanvasInteractionLocked = Boolean(focusedSceneId);
	const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
	const [focusTimelineDrawerHeight, setFocusTimelineDrawerHeight] = useState(
		SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT,
	);
	const [contextMenuState, setContextMenuState] =
		useState<CanvasContextMenuState>({ open: false });
	const containerRef = useRef<HTMLDivElement | null>(null);
	const preFocusCameraRef = useRef<CameraState | null>(null);
	const prevFocusedSceneIdRef = useRef<string | null>(focusedSceneId);
	const dragStateRef = useRef<DragState | null>(null);

	const sortedNodes = useMemo(() => {
		if (!currentProject) return [];
		return [...currentProject.canvas.nodes]
			.filter((node) => !node.hidden)
			.sort((a, b) => {
				if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
				return a.createdAt - b.createdAt;
			});
	}, [currentProject]);

	const sceneNodes = useMemo(() => {
		return sortedNodes.filter((node): node is SceneNode => isSceneNode(node));
	}, [sortedNodes]);

	const focusedNode = useMemo(() => {
		if (!focusedSceneId) return null;
		return sceneNodes.find((node) => node.sceneId === focusedSceneId) ?? null;
	}, [focusedSceneId, sceneNodes]);

	const activeNode = useMemo(() => {
		if (!activeNodeId) return null;
		return (
			currentProject?.canvas.nodes.find((node) => node.id === activeNodeId) ?? null
		);
	}, [activeNodeId, currentProject]);

	const activeNodeDefinition = useMemo(() => {
		if (!activeNode) return null;
		return getCanvasNodeDefinition(activeNode.type);
	}, [activeNode]);
	const ActiveNodeToolbar = activeNodeDefinition?.toolbar ?? null;

	const activeNodeScene = useMemo(() => {
		if (!activeNode || activeNode.type !== "scene") return null;
		return currentProject?.scenes[activeNode.sceneId] ?? null;
	}, [activeNode, currentProject]);

	const activeNodeAsset = useMemo(() => {
		if (!activeNode || !("assetId" in activeNode)) return null;
		return (
			currentProject?.assets.find((asset) => asset.id === activeNode.assetId) ??
			null
		);
	}, [activeNode, currentProject]);

	const resolveWorldPoint = useCallback(
		(clientX: number, clientY: number) => {
			const container = containerRef.current;
			if (!container) return { x: 0, y: 0 };
			const rect = container.getBoundingClientRect();
			const safeClientX = Number.isFinite(clientX) ? clientX : rect.left;
			const safeClientY = Number.isFinite(clientY) ? clientY : rect.top;
			const localX = safeClientX - rect.left;
			const localY = safeClientY - rect.top;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			return {
				x: localX / safeZoom - camera.x,
				y: localY / safeZoom - camera.y,
			};
		},
		[camera],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const updateSize = () => {
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			setStageSize({ width: rect.width, height: rect.height });
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
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (!focusedSceneId) return;
			event.preventDefault();
			setFocusedScene(null);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [focusedSceneId, setFocusedScene]);

	useEffect(() => {
		if (focusedSceneId) return;
		setFocusTimelineDrawerHeight(SCENE_TIMELINE_DRAWER_DEFAULT_HEIGHT);
	}, [focusedSceneId]);

	useEffect(() => {
		const prevFocusedSceneId = prevFocusedSceneIdRef.current;
		if (!prevFocusedSceneId && focusedSceneId) {
			preFocusCameraRef.current = camera;
		}
		if (prevFocusedSceneId && !focusedSceneId) {
			const previous = preFocusCameraRef.current;
			preFocusCameraRef.current = null;
			if (previous && !isCameraAlmostEqual(previous, camera)) {
				setCanvasCamera(previous);
			}
		}
		prevFocusedSceneIdRef.current = focusedSceneId;
	}, [camera, focusedSceneId, setCanvasCamera]);

	useEffect(() => {
		if (!focusedSceneId) return;
		if (!focusedNode) return;
		if (stageSize.width <= 0 || stageSize.height <= 0) return;
		const viewPadding = 80;
		const visibleCanvasHeight = Math.max(
			1,
			stageSize.height - focusTimelineDrawerHeight,
		);
		const availableWidth = Math.max(1, stageSize.width - viewPadding * 2);
		const availableHeight = Math.max(1, visibleCanvasHeight - viewPadding * 2);
		const zoomX = availableWidth / focusedNode.width;
		const zoomY = availableHeight / focusedNode.height;
		const nextZoom = clampZoom(Math.min(zoomX, zoomY));
		const safeZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
		const worldCenterX = focusedNode.x + focusedNode.width / 2;
		const worldCenterY = focusedNode.y + focusedNode.height / 2;
		const nextCamera = {
			x: stageSize.width / 2 / safeZoom - worldCenterX,
			y: visibleCanvasHeight / 2 / safeZoom - worldCenterY,
			zoom: nextZoom,
		};
		if (isCameraAlmostEqual(camera, nextCamera)) return;
		setCanvasCamera(nextCamera);
	}, [
		camera,
		focusTimelineDrawerHeight,
		focusedNode,
		focusedSceneId,
		setCanvasCamera,
		stageSize.height,
		stageSize.width,
	]);

	const handleCreateScene = useCallback(() => {
		const nodeId = createCanvasNode({ type: "scene" });
		const latestProject = useProjectStore.getState().currentProject;
		if (!latestProject) return;
		const node = latestProject.canvas.nodes.find((item) => item.id === nodeId);
		if (!node || node.type !== "scene") return;
		const scene = latestProject.scenes[node.sceneId];
		pushHistory({
			kind: "canvas.node-create",
			node,
			scene,
			focusSceneId: latestProject.ui.focusedSceneId,
		});
	}, [createCanvasNode, pushHistory]);

	const handleZoomByStep = useCallback(
		(multiplier: number) => {
			const nextZoom = clampZoom(camera.zoom * multiplier);
			if (nextZoom === camera.zoom) return;
			const safeCurrentZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
			const anchorX = stageSize.width > 0 ? stageSize.width / 2 : 0;
			const anchorY = stageSize.height > 0 ? stageSize.height / 2 : 0;
			const anchorWorldX = anchorX / safeCurrentZoom - camera.x;
			const anchorWorldY = anchorY / safeCurrentZoom - camera.y;
			setCanvasCamera({
				x: anchorX / safeNextZoom - anchorWorldX,
				y: anchorY / safeNextZoom - anchorWorldY,
				zoom: nextZoom,
			});
		},
		[camera, setCanvasCamera, stageSize.height, stageSize.width],
	);

	const handleResetView = useCallback(() => {
		setCanvasCamera({ x: 0, y: 0, zoom: 1 });
	}, [setCanvasCamera]);

	const handleExitFocus = useCallback(() => {
		setFocusedScene(null);
	}, [setFocusedScene]);

	const handleStageWheel = useCallback(
		(event: Konva.KonvaEventObject<WheelEvent>) => {
			if (event.evt.cancelable) {
				event.evt.preventDefault();
			}
			const nativeEvent = event.evt;
			if (nativeEvent.ctrlKey || nativeEvent.metaKey) {
				const stage = event.target.getStage();
				if (!stage) return;
				const pointer = stage.getPointerPosition();
				if (!pointer) return;
				const oldZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
				const zoomDelta = nativeEvent.deltaY > 0 ? 0.92 : 1.08;
				const nextZoom = clampZoom(oldZoom * zoomDelta);
				const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
				const worldPoint = {
					x: pointer.x / oldZoom - camera.x,
					y: pointer.y / oldZoom - camera.y,
				};
				setCanvasCamera({
					x: pointer.x / safeNextZoom - worldPoint.x,
					y: pointer.y / safeNextZoom - worldPoint.y,
					zoom: nextZoom,
				});
				return;
			}
			const deltaX = nativeEvent.shiftKey
				? nativeEvent.deltaY
				: nativeEvent.deltaX;
			const deltaY = nativeEvent.shiftKey ? 0 : nativeEvent.deltaY;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			setCanvasCamera({
				x: camera.x - deltaX / safeZoom,
				y: camera.y - deltaY / safeZoom,
				zoom: camera.zoom,
			});
		},
		[camera, setCanvasCamera],
	);

	const handleContainerWheel = useCallback(
		(event: WheelEvent) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				const oldZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
				const zoomDelta = event.deltaY > 0 ? 0.92 : 1.08;
				const nextZoom = clampZoom(oldZoom * zoomDelta);
				const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
				const container = containerRef.current;
				if (!container) return;
				const rect = container.getBoundingClientRect();
				const pointerX = event.clientX - rect.left;
				const pointerY = event.clientY - rect.top;
				const worldPoint = {
					x: pointerX / oldZoom - camera.x,
					y: pointerY / oldZoom - camera.y,
				};
				setCanvasCamera({
					x: pointerX / safeNextZoom - worldPoint.x,
					y: pointerY / safeNextZoom - worldPoint.y,
					zoom: nextZoom,
				});
				return;
			}
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			setCanvasCamera({
				x: camera.x - event.deltaX / safeZoom,
				y: camera.y - event.deltaY / safeZoom,
				zoom: camera.zoom,
			});
		},
		[camera, setCanvasCamera],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const listener = (event: WheelEvent) => {
			handleContainerWheel(event);
		};
		container.addEventListener("wheel", listener, { passive: false });
		return () => {
			container.removeEventListener("wheel", listener);
		};
	}, [handleContainerWheel]);

	const getTopHitNode = useCallback(
		(worldX: number, worldY: number): CanvasNode | null => {
			for (let index = sortedNodes.length - 1; index >= 0; index -= 1) {
				const node = sortedNodes[index];
				if (!node) continue;
				const canInteractNode =
					!isCanvasInteractionLocked ||
					(node.type === "scene" && node.sceneId === focusedSceneId);
				if (!canInteractNode) continue;
				if (!isWorldPointInNode(node, worldX, worldY)) continue;
				return node;
			}
			return null;
		},
		[focusedSceneId, isCanvasInteractionLocked, sortedNodes],
	);

	const handleNodeActivate = useCallback(
		(node: CanvasNode) => {
			const canInteractNode =
				!isCanvasInteractionLocked ||
				(node.type === "scene" && node.sceneId === focusedSceneId);
			if (!canInteractNode) return;
			setActiveNode(node.id);
			if (node.type === "scene") {
				setActiveScene(node.sceneId);
				if (!focusedSceneId) {
					setFocusedScene(node.sceneId);
				}
			}
		},
		[
			focusedSceneId,
			isCanvasInteractionLocked,
			setActiveNode,
			setActiveScene,
			setFocusedScene,
		],
	);

	const handleNodeHitLayerPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const node = getTopHitNode(world.x, world.y);
			if (!node) {
				if (!isCanvasInteractionLocked) {
					setActiveNode(null);
				}
				return;
			}
			if (node.locked) {
				handleNodeActivate(node);
				return;
			}
			setActiveNode(node.id);
			if (typeof event.currentTarget.setPointerCapture === "function") {
				event.currentTarget.setPointerCapture(event.pointerId);
			}
			dragStateRef.current = {
				nodeId: node.id,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startNodeX: node.x,
				startNodeY: node.y,
				before: pickLayout(node),
				moved: false,
			};
		},
		[
			getTopHitNode,
			handleNodeActivate,
			isCanvasInteractionLocked,
			resolveWorldPoint,
			setActiveNode,
		],
	);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const dragState = dragStateRef.current;
			if (!dragState) return;
			const deltaX = event.clientX - dragState.startClientX;
			const deltaY = event.clientY - dragState.startClientY;
			const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
			const nextX = dragState.startNodeX + deltaX / safeZoom;
			const nextY = dragState.startNodeY + deltaY / safeZoom;
			dragState.moved = dragState.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2;
			updateCanvasNodeLayout(dragState.nodeId, {
				x: nextX,
				y: nextY,
			});
		};

		const handlePointerUp = () => {
			const dragState = dragStateRef.current;
			dragStateRef.current = null;
			if (!dragState) return;
			if (!dragState.moved) {
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) return;
				const node = latestProject.canvas.nodes.find(
					(item) => item.id === dragState.nodeId,
				);
				if (!node) return;
				handleNodeActivate(node);
				return;
			}
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const node = latestProject.canvas.nodes.find(
				(item) => item.id === dragState.nodeId,
			);
			if (!node) return;
			const after = pickLayout(node);
			if (isLayoutEqual(dragState.before, after)) return;
			pushHistory({
				kind: "canvas.node-layout",
				nodeId: node.id,
				before: dragState.before,
				after,
				focusSceneId: latestProject.ui.focusedSceneId,
			});
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};
	}, [camera.zoom, handleNodeActivate, pushHistory, updateCanvasNodeLayout]);

	const handleCanvasContextMenu = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (isCanvasInteractionLocked) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			setContextMenuState({
				open: true,
				x: event.clientX,
				y: event.clientY,
				worldX: world.x,
				worldY: world.y,
			});
		},
		[isCanvasInteractionLocked, resolveWorldPoint],
	);

	const closeContextMenu = useCallback(() => {
		setContextMenuState({ open: false });
	}, []);

	const handleCreateTextNodeAt = useCallback(
		(worldX: number, worldY: number) => {
			const textNodeDefinition = getCanvasNodeDefinition("text");
			const nodeId = createCanvasNode({
				...textNodeDefinition.create(),
				x: worldX,
				y: worldY,
			});
			const latestProject = useProjectStore.getState().currentProject;
			if (!latestProject) return;
			const node = latestProject.canvas.nodes.find((item) => item.id === nodeId);
			if (!node) return;
			pushHistory({
				kind: "canvas.node-create",
				node,
				focusSceneId: latestProject.ui.focusedSceneId,
			});
		},
		[createCanvasNode, pushHistory],
	);

	const handleCanvasDrop = useCallback(
		async (event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			if (!currentProjectId || !currentProject) return;
			const files = resolveDroppedFiles(event.dataTransfer);
			if (files.length === 0) return;
			const world = resolveWorldPoint(event.clientX, event.clientY);
			const activeSceneTimeline =
				(activeSceneId
					? currentProject.scenes[activeSceneId]?.timeline
					: undefined) ?? Object.values(currentProject.scenes)[0]?.timeline;
			const fps = activeSceneTimeline?.fps ?? 30;

			const resolveExternalFileUri = async (
				file: File,
				kind: "video" | "audio" | "image",
			): Promise<string> => {
				if (kind === "video") {
					return resolveExternalVideoUri(file, currentProjectId);
				}
				if (isElectronEnv()) {
					const filePath = getFilePath(file) ?? getElectronFilePath(file);
					if (!filePath) {
						throw new Error("无法读取本地文件路径");
					}
					return buildFileUrlFromPath(filePath);
				}
				if (kind === "audio") {
					const { uri } = await writeAudioToOpfs(file, currentProjectId);
					return uri;
				}
				const { uri } = await writeProjectFileToOpfs(
					file,
					currentProjectId,
					"images",
				);
				return uri;
			};

			const nodeInputs: Array<{
				input: Parameters<typeof createCanvasNode>[0];
				index: number;
			}> = [];

			for (const [index, file] of files.entries()) {
				let resolvedInput: Parameters<typeof createCanvasNode>[0] | null = null;
				for (const definition of canvasNodeDefinitionList) {
					if (!definition.fromExternalFile) continue;
					const matched = await definition.fromExternalFile(file, {
						projectId: currentProjectId,
						fps,
						ensureProjectAssetByUri,
						resolveExternalFileUri,
					});
					if (!matched) continue;
					resolvedInput = matched;
					break;
				}
				if (!resolvedInput) continue;
				nodeInputs.push({ input: resolvedInput, index });
			}

			for (const item of nodeInputs) {
				const column = item.index % DROP_GRID_COLUMNS;
				const row = Math.floor(item.index / DROP_GRID_COLUMNS);
				const nodeId = createCanvasNode({
					...item.input,
					x: world.x + column * DROP_GRID_OFFSET_X,
					y: world.y + row * DROP_GRID_OFFSET_Y,
				});
				const latestProject = useProjectStore.getState().currentProject;
				if (!latestProject) continue;
				const node = latestProject.canvas.nodes.find(
					(candidate) => candidate.id === nodeId,
				);
				if (!node) continue;
				if (node.type === "scene") continue;
				pushHistory({
					kind: "canvas.node-create",
					node,
					focusSceneId: latestProject.ui.focusedSceneId,
				});
			}
		},
		[
			activeSceneId,
			createCanvasNode,
			currentProject,
			currentProjectId,
			ensureProjectAssetByUri,
			pushHistory,
			resolveWorldPoint,
		],
	);

	if (!currentProject) {
		return (
			<div className="flex h-full w-full items-center justify-center">Loading...</div>
		);
	}

	const gridSizePx = Math.max(20, GRID_SIZE * camera.zoom);
	const gridOffsetX = (camera.x * camera.zoom) % gridSizePx;
	const gridOffsetY = (camera.y * camera.zoom) % gridSizePx;

	const toolbarActions =
		contextMenuState.open && !focusedSceneId
			? [
					{
						key: "new-text-node",
						label: "新建文本节点",
						onSelect: () => {
							handleCreateTextNodeAt(
								contextMenuState.worldX,
								contextMenuState.worldY,
							);
						},
					},
			  ]
			: [];

	return (
		<div
			ref={containerRef}
			data-testid="canvas-workspace"
			className="relative h-full w-full overflow-hidden"
			onContextMenu={handleCanvasContextMenu}
			onDragOver={(event) => {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}}
			onDrop={handleCanvasDrop}
		>
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					backgroundImage:
						"linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
					backgroundSize: `${gridSizePx}px ${gridSizePx}px`,
					backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
				}}
			/>

			<InfiniteSkiaCanvas
				width={stageSize.width}
				height={stageSize.height}
				camera={camera}
				nodes={sortedNodes}
				scenes={currentProject.scenes}
				assets={currentProject.assets}
				activeNodeId={activeNodeId}
				focusedSceneId={focusedSceneId}
			/>

			<div
				data-testid="canvas-node-hit-layer"
				className="absolute inset-0 z-20"
				onPointerDown={handleNodeHitLayerPointerDown}
			/>

			{activeNode && ActiveNodeToolbar && (
				<div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl border border-white/10 bg-black/65 px-3 py-2 backdrop-blur">
					<ActiveNodeToolbar
						node={activeNode}
						scene={activeNodeScene}
						asset={activeNodeAsset}
						updateNode={(patch) => {
							updateCanvasNode(activeNode.id, patch as never);
						}}
						setFocusedScene={setFocusedScene}
						setActiveScene={setActiveScene}
					/>
				</div>
			)}

			{!focusedSceneId && (
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
					<span className="text-white/70">{Math.round(camera.zoom * 100)}%</span>
				</div>
			)}

			{focusedSceneId && focusedNode && (
				<FocusSceneKonvaLayer
					width={stageSize.width}
					height={stageSize.height}
					camera={camera}
					focusedNode={focusedNode}
					sceneId={focusedSceneId}
					onWheel={handleStageWheel}
				/>
			)}

			{focusedSceneId && (
				<>
					<div
						data-testid="focus-material-library"
						className="absolute left-4 top-4 z-50 max-h-[45vh] w-60 overflow-y-auto rounded-xl border border-white/10 bg-neutral-900/85 p-3 backdrop-blur-xl"
					>
						<div className="mb-2 text-xs font-medium text-white/80">素材库</div>
						<MaterialLibrary />
					</div>
					<SceneTimelineDrawer
						onExitFocus={handleExitFocus}
						onHeightChange={setFocusTimelineDrawerHeight}
					/>
				</>
			)}

			<TimelineContextMenu
				open={contextMenuState.open}
				x={contextMenuState.open ? contextMenuState.x : 0}
				y={contextMenuState.open ? contextMenuState.y : 0}
				actions={toolbarActions}
				onClose={closeContextMenu}
			/>
		</div>
	);
};

export default CanvasWorkspace;
