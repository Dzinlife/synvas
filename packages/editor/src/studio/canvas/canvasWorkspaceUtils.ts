import type { CanvasNode } from "core/studio/types";
import type { TimelineContextMenuAction } from "@/scene-editor/components/TimelineContextMenu";
import {
	CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
	CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	CANVAS_NODE_DRAWER_MIN_HEIGHT,
} from "@/studio/canvas/CanvasNodeDrawerShell";
import type {
	CanvasNodeContextMenuAction,
	CanvasNodeDrawerOptions,
	CanvasNodeDrawerTrigger,
} from "@/studio/canvas/node-system/types";
import type { CanvasNodeLayoutSnapshot } from "@/studio/history/studioHistoryStore";
import type { CameraSafeInsets } from "./canvasOverlayLayout";

export const MIN_ZOOM = 0.2;
export const DEFAULT_MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const GRID_SIZE = 120;
export const CAMERA_ZOOM_EPSILON = 1e-6;
export const DROP_GRID_COLUMNS = 4;
export const DROP_GRID_OFFSET_X = 48;
export const DROP_GRID_OFFSET_Y = 40;
export const FILE_PREFIX = "file://";
export const FOCUS_VIEW_PADDING = 80;
export const SIDEBAR_VIEW_PADDING_PX = 24;
export const CAMERA_SMOOTH_DURATION_MS = 220;

export interface CameraState {
	x: number;
	y: number;
	zoom: number;
}

export interface CanvasWorldBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export type CameraTransitionMode = "smooth" | "instant";

export interface ApplyCameraOptions {
	transition?: CameraTransitionMode;
}

export interface ClampZoomOptions {
	minZoom?: number;
	maxZoom?: number;
}

export const DEFAULT_CAMERA: CameraState = {
	x: 0,
	y: 0,
	zoom: 1,
};

export interface NodeFitCameraInput {
	node: CanvasNode;
	stageWidth: number;
	stageHeight: number;
	safeInsets: CameraSafeInsets;
}

export interface NodePanCameraInput {
	node: CanvasNode;
	camera: CameraState;
	stageWidth: number;
	stageHeight: number;
	safeInsets: CameraSafeInsets;
	paddingPx: number;
}

interface SafeViewportRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

type FileWithPath = File & { path?: string };

export interface ResolvedCanvasDrawerOptions {
	trigger: CanvasNodeDrawerTrigger;
	resizable: boolean;
	defaultHeight: number;
	minHeight: number;
	maxHeightRatio: number;
}

export const clampZoom = (zoom: number, options?: ClampZoomOptions): number => {
	const minZoom = Number.isFinite(options?.minZoom)
		? Math.max(CAMERA_ZOOM_EPSILON, options?.minZoom ?? MIN_ZOOM)
		: MIN_ZOOM;
	const maxZoom = Number.isFinite(options?.maxZoom)
		? Math.max(minZoom, options?.maxZoom ?? MAX_ZOOM)
		: Math.max(minZoom, MAX_ZOOM);
	return Math.max(minZoom, Math.min(maxZoom, zoom));
};

const resolveSafeViewportRect = (
	stageWidth: number,
	stageHeight: number,
	safeInsets: CameraSafeInsets,
): SafeViewportRect => {
	const safeLeft = Math.max(0, safeInsets.left);
	const safeTop = Math.max(0, safeInsets.top);
	const safeRight = Math.max(
		safeLeft + 1,
		stageWidth - Math.max(0, safeInsets.right),
	);
	const safeBottom = Math.max(
		safeTop + 1,
		stageHeight - Math.max(0, safeInsets.bottom),
	);
	return {
		left: safeLeft,
		top: safeTop,
		right: safeRight,
		bottom: safeBottom,
		width: Math.max(1, safeRight - safeLeft),
		height: Math.max(1, safeBottom - safeTop),
	};
};

export const buildNodeFitCamera = ({
	node,
	stageWidth,
	stageHeight,
	safeInsets,
}: NodeFitCameraInput): CameraState => {
	const safeNodeWidth = Math.max(1, Math.abs(node.width));
	const safeNodeHeight = Math.max(1, Math.abs(node.height));
	const viewport = resolveSafeViewportRect(stageWidth, stageHeight, safeInsets);
	const availableWidth = Math.max(1, viewport.width - FOCUS_VIEW_PADDING * 2);
	const availableHeight = Math.max(1, viewport.height - FOCUS_VIEW_PADDING * 2);
	const zoomX = availableWidth / safeNodeWidth;
	const zoomY = availableHeight / safeNodeHeight;
	const nextZoom = clampZoom(Math.min(zoomX, zoomY));
	const safeZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
	const worldCenterX = node.x + node.width / 2;
	const worldCenterY = node.y + node.height / 2;
	const viewportCenterX = viewport.left + viewport.width / 2;
	const viewportCenterY = viewport.top + viewport.height / 2;
	return {
		x: viewportCenterX / safeZoom - worldCenterX,
		y: viewportCenterY / safeZoom - worldCenterY,
		zoom: nextZoom,
	};
};

export const buildNodePanCamera = ({
	node,
	camera,
	stageWidth,
	stageHeight,
	safeInsets,
	paddingPx,
}: NodePanCameraInput): CameraState => {
	const safeZoom = Math.max(camera.zoom, CAMERA_ZOOM_EPSILON);
	const viewport = resolveSafeViewportRect(stageWidth, stageHeight, safeInsets);
	const nodeLeft = Math.min(node.x, node.x + node.width);
	const nodeRight = Math.max(node.x, node.x + node.width);
	const nodeTop = Math.min(node.y, node.y + node.height);
	const nodeBottom = Math.max(node.y, node.y + node.height);
	const stageLeft = (nodeLeft + camera.x) * safeZoom;
	const stageRight = (nodeRight + camera.x) * safeZoom;
	const stageTop = (nodeTop + camera.y) * safeZoom;
	const stageBottom = (nodeBottom + camera.y) * safeZoom;
	const viewportLeft = viewport.left + paddingPx;
	const viewportRight = Math.max(viewportLeft + 1, viewport.right - paddingPx);
	const viewportTop = viewport.top + paddingPx;
	const viewportBottom = Math.max(viewportTop + 1, viewport.bottom - paddingPx);
	const viewportWidth = viewportRight - viewportLeft;
	const viewportHeight = viewportBottom - viewportTop;

	const resolveAxisShift = (
		nodeStart: number,
		nodeEnd: number,
		viewportStart: number,
		viewportEnd: number,
		viewportSize: number,
	): number => {
		const nodeSize = nodeEnd - nodeStart;
		if (nodeSize > viewportSize) {
			const viewportCenter = viewportStart + viewportSize / 2;
			const nodeCenter = nodeStart + nodeSize / 2;
			return viewportCenter - nodeCenter;
		}
		if (nodeStart < viewportStart) {
			return viewportStart - nodeStart;
		}
		if (nodeEnd > viewportEnd) {
			return viewportEnd - nodeEnd;
		}
		return 0;
	};

	const shiftX = resolveAxisShift(
		stageLeft,
		stageRight,
		viewportLeft,
		viewportRight,
		viewportWidth,
	);
	const shiftY = resolveAxisShift(
		stageTop,
		stageBottom,
		viewportTop,
		viewportBottom,
		viewportHeight,
	);

	if (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5) {
		return camera;
	}

	return {
		x: camera.x + shiftX / safeZoom,
		y: camera.y + shiftY / safeZoom,
		zoom: camera.zoom,
	};
};

export const pickLayout = (node: CanvasNode): CanvasNodeLayoutSnapshot => ({
	x: node.x,
	y: node.y,
	width: node.width,
	height: node.height,
	zIndex: node.zIndex,
	hidden: node.hidden,
	locked: node.locked,
});

export const resolveCanvasNodeBounds = (
	nodes: CanvasNode[],
): CanvasWorldBounds | null => {
	if (nodes.length === 0) return null;
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const node of nodes) {
		const nodeLeft = Math.min(node.x, node.x + node.width);
		const nodeRight = Math.max(node.x, node.x + node.width);
		const nodeTop = Math.min(node.y, node.y + node.height);
		const nodeBottom = Math.max(node.y, node.y + node.height);
		left = Math.min(left, nodeLeft);
		top = Math.min(top, nodeTop);
		right = Math.max(right, nodeRight);
		bottom = Math.max(bottom, nodeBottom);
	}
	if (
		!Number.isFinite(left) ||
		!Number.isFinite(top) ||
		!Number.isFinite(right) ||
		!Number.isFinite(bottom)
	) {
		return null;
	}
	return {
		left,
		top,
		right,
		bottom,
		width: Math.max(1, right - left),
		height: Math.max(1, bottom - top),
	};
};

export interface DynamicMinZoomInput {
	nodes: CanvasNode[];
	stageWidth: number;
	stageHeight: number;
	safeInsets: CameraSafeInsets;
	defaultMinZoom?: number;
}

export const resolveDynamicMinZoom = ({
	nodes,
	stageWidth,
	stageHeight,
	safeInsets,
	defaultMinZoom = DEFAULT_MIN_ZOOM,
}: DynamicMinZoomInput): number => {
	const fallbackMinZoom = Math.max(CAMERA_ZOOM_EPSILON, defaultMinZoom);
	if (stageWidth <= 0 || stageHeight <= 0) {
		return fallbackMinZoom;
	}
	if (nodes.length === 0) {
		return fallbackMinZoom;
	}
	const bounds = resolveCanvasNodeBounds(nodes);
	if (!bounds) {
		return fallbackMinZoom;
	}
	const viewport = resolveSafeViewportRect(stageWidth, stageHeight, safeInsets);
	const fitAllNodesZoom = Math.min(
		viewport.width / bounds.width,
		viewport.height / bounds.height,
	);
	if (!Number.isFinite(fitAllNodesZoom) || fitAllNodesZoom <= 0) {
		return fallbackMinZoom;
	}
	const fitHalf = fitAllNodesZoom / 2;
	return Math.max(CAMERA_ZOOM_EPSILON, Math.min(fallbackMinZoom, fitHalf));
};

export const isWorldPointInBounds = (
	bounds: CanvasWorldBounds,
	worldX: number,
	worldY: number,
): boolean => {
	return (
		worldX >= bounds.left &&
		worldX <= bounds.right &&
		worldY >= bounds.top &&
		worldY <= bounds.bottom
	);
};

export const isLayoutEqual = (
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

export const isWorldPointInNode = (
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

export const isCameraAlmostEqual = (
	left: CameraState,
	right: CameraState,
): boolean => {
	return (
		Math.abs(left.x - right.x) < 0.5 &&
		Math.abs(left.y - right.y) < 0.5 &&
		Math.abs(left.zoom - right.zoom) < 0.0001
	);
};

export const easeOutCubic = (value: number): number => {
	return 1 - (1 - value) ** 3;
};

const lerp = (from: number, to: number, progress: number): number => {
	return from + (to - from) * progress;
};

export const lerpCamera = (
	from: CameraState,
	to: CameraState,
	progress: number,
): CameraState => {
	const nextZoom = lerp(from.zoom, to.zoom, progress);
	const safeNextZoom = Math.max(nextZoom, CAMERA_ZOOM_EPSILON);
	const nextTranslateX = lerp(from.x * from.zoom, to.x * to.zoom, progress);
	const nextTranslateY = lerp(from.y * from.zoom, to.y * to.zoom, progress);
	return {
		x: nextTranslateX / safeNextZoom,
		y: nextTranslateY / safeNextZoom,
		zoom: nextZoom,
	};
};

export const isElectronEnv = (): boolean => {
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

export const resolveExternalFileUri = async (
	file: File,
	kind: "video" | "audio" | "image",
	projectId: string,
	resolveVideoUri: (file: File, projectId: string) => Promise<string>,
	writeAudioFile: (file: File, projectId: string) => Promise<{ uri: string }>,
	writeImageFile: (
		file: File,
		projectId: string,
		kind: "images",
	) => Promise<{ uri: string }>,
): Promise<string> => {
	if (kind === "video") {
		return resolveVideoUri(file, projectId);
	}
	if (isElectronEnv()) {
		const filePath = getFilePath(file) ?? getElectronFilePath(file);
		if (!filePath) {
			throw new Error("无法读取本地文件路径");
		}
		return buildFileUrlFromPath(filePath);
	}
	if (kind === "audio") {
		const { uri } = await writeAudioFile(file, projectId);
		return uri;
	}
	const { uri } = await writeImageFile(file, projectId, "images");
	return uri;
};

export const resolveDroppedFiles = (
	dataTransfer: DataTransfer | null,
): File[] => {
	if (!dataTransfer) return [];
	if (dataTransfer.files && dataTransfer.files.length > 0) {
		return Array.from(dataTransfer.files);
	}
	if (!dataTransfer.items) return [];
	return Array.from(dataTransfer.items)
		.map((item) => (item.kind === "file" ? item.getAsFile() : null))
		.filter((file): file is File => Boolean(file));
};

const resolveDrawerTrigger = (
	trigger: CanvasNodeDrawerTrigger | undefined,
): CanvasNodeDrawerTrigger => {
	return trigger ?? "focus";
};

export const resolveDrawerOptions = (
	options: CanvasNodeDrawerOptions | undefined,
	deprecatedTrigger: CanvasNodeDrawerTrigger | undefined,
): ResolvedCanvasDrawerOptions => {
	const trigger = resolveDrawerTrigger(options?.trigger ?? deprecatedTrigger);
	return {
		trigger,
		resizable: options?.resizable ?? false,
		defaultHeight: options?.defaultHeight ?? CANVAS_NODE_DRAWER_DEFAULT_HEIGHT,
		minHeight: options?.minHeight ?? CANVAS_NODE_DRAWER_MIN_HEIGHT,
		maxHeightRatio:
			options?.maxHeightRatio ?? CANVAS_NODE_DRAWER_MAX_HEIGHT_RATIO,
	};
};

export const isOverlayWheelTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest('[data-canvas-overlay-ui="true"]'));
};

export const isCanvasSurfaceTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest('[data-canvas-surface="true"]'));
};

export const toTimelineContextMenuActions = (
	actions: CanvasNodeContextMenuAction[],
): TimelineContextMenuAction[] => {
	return actions.map((action) => ({
		key: action.key,
		label: action.label,
		disabled: action.disabled,
		danger: action.danger,
		onSelect: action.onSelect,
		children: action.children
			? toTimelineContextMenuActions(action.children)
			: undefined,
	}));
};
