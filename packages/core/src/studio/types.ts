import type { TimelineAsset } from "../element/types";
import type {
	OtCommand,
	OtOpEnvelope,
	OtStreamCursorState,
	OtTransaction,
} from "../editor/ot";
import type { TimelineJSON } from "../editor/timelineLoader";

export type CanvasNodeType = "scene" | "video" | "audio" | "text" | "image";

export interface CanvasNodeBase {
	id: string;
	type: CanvasNodeType;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	zIndex: number;
	locked: boolean;
	hidden: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface SceneCanvasNode extends CanvasNodeBase {
	type: "scene";
	sceneId: string;
}

export interface VideoCanvasNode extends CanvasNodeBase {
	type: "video";
	assetId: string;
	duration?: number;
}

export interface AudioCanvasNode extends CanvasNodeBase {
	type: "audio";
	assetId: string;
	duration?: number;
}

export interface TextCanvasNode extends CanvasNodeBase {
	type: "text";
	text: string;
	fontSize: number;
}

export interface ImageCanvasNode extends CanvasNodeBase {
	type: "image";
	assetId: string;
}

export type CanvasNode =
	| SceneCanvasNode
	| VideoCanvasNode
	| AudioCanvasNode
	| TextCanvasNode
	| ImageCanvasNode;

// 兼容存量命名：scene 仍是一等节点
export type SceneNode = SceneCanvasNode;

export interface CanvasDocument {
	nodes: CanvasNode[];
}

export interface SceneDocument {
	id: string;
	name: string;
	timeline: TimelineJSON;
	posterFrame: number;
	createdAt: number;
	updatedAt: number;
}

export interface StudioOtTombstoneScene {
	scene: SceneDocument;
	node: SceneNode;
	deletedAt: number;
}

export interface StudioProjectOt {
	version: 1;
	actorId: string;
	lamport: number;
	streams: Record<string, OtStreamCursorState>;
	ops: OtOpEnvelope<OtCommand>[];
	transactions: OtTransaction<OtCommand>[];
	tombstones: {
		scenes: Record<string, StudioOtTombstoneScene>;
	};
}

export interface StudioProject {
	id: string;
	revision: number;
	canvas: CanvasDocument;
	scenes: Record<string, SceneDocument>;
	assets: TimelineAsset[];
	ot?: StudioProjectOt;
	ui: {
		activeSceneId: string | null;
		focusedNodeId: string | null;
		activeNodeId: string | null;
		canvasSnapEnabled: boolean;
		camera: {
			x: number;
			y: number;
			zoom: number;
		};
	};
	createdAt: number;
	updatedAt: number;
}
