import type { TimelineJSON } from "../editor/timelineLoader";

export type CanvasNodeType = "scene";

export interface SceneNode {
	id: string;
	type: CanvasNodeType;
	sceneId: string;
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

export interface CanvasDocument {
	nodes: SceneNode[];
}

export interface SceneDocument {
	id: string;
	name: string;
	timeline: TimelineJSON;
	posterFrame: number;
	createdAt: number;
	updatedAt: number;
}

export interface StudioProject {
	id: string;
	revision: number;
	canvas: CanvasDocument;
	scenes: Record<string, SceneDocument>;
	ui: {
		activeSceneId: string | null;
		focusedSceneId: string | null;
		camera: {
			x: number;
			y: number;
			zoom: number;
		};
	};
	createdAt: number;
	updatedAt: number;
}
