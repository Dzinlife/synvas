import type { ColorManagementSettings, TimelineAsset } from "core";
import type {
	OtCommand,
	OtOpEnvelope,
	OtStreamCursorState,
	OtTransaction,
} from "core/timeline-system/ot";
import type { TimelineJSON } from "core/timeline-system/loader";

export type CanvasNodeType =
	| "scene"
	| "video"
	| "audio"
	| "text"
	| "image"
	| "board"
	| "hdr-test";

export type HdrTestColorPreset =
	| "sdr-white"
	| "p3-red"
	| "hdr-white"
	| "hdr-red"
	| "hdr-gradient";

export interface CanvasNodeThumbnail {
	assetId: string;
	sourceSignature: string;
	frame: number;
	generatedAt: number;
	version: 1;
}

export interface CanvasNodeBase {
	id: string;
	type: CanvasNodeType;
	name: string;
	parentId?: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	siblingOrder: number;
	locked: boolean;
	hidden: boolean;
	createdAt: number;
	updatedAt: number;
	thumbnail?: CanvasNodeThumbnail;
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

export interface BoardCanvasNode extends CanvasNodeBase {
	type: "board";
	layoutMode?: "free" | "auto";
}

export interface HdrTestCanvasNode extends CanvasNodeBase {
	type: "hdr-test";
	colorPreset: HdrTestColorPreset;
	brightness: number;
}

export type CanvasNode =
	| SceneCanvasNode
	| VideoCanvasNode
	| AudioCanvasNode
	| TextCanvasNode
	| ImageCanvasNode
	| BoardCanvasNode
	| HdrTestCanvasNode;

// 兼容存量命名：scene 仍是一等节点
export type SceneNode = SceneCanvasNode;

export interface CanvasDocument {
	nodes: CanvasNode[];
}

export interface SceneDocument {
	id: string;
	name: string;
	timeline: TimelineJSON;
	color?: Partial<ColorManagementSettings>;
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
	color?: ColorManagementSettings;
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
