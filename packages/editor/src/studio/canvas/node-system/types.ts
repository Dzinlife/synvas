import type { TimelineAsset } from "core/dsl/types";
import type { CanvasNode, SceneDocument } from "core/studio/types";
import type React from "react";
import type { StudioRuntimeManager } from "@/editor/runtime/types";
import type { CanvasNodeCreateInput } from "@/projects/projectStore";

export interface CanvasNodeSkiaRenderProps<TNode extends CanvasNode = CanvasNode> {
	node: TNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
	isActive: boolean;
	isFocused: boolean;
	isDimmed: boolean;
	runtimeManager: StudioRuntimeManager;
}

export interface CanvasNodeToolbarProps<TNode extends CanvasNode = CanvasNode> {
	node: TNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
	updateNode: (patch: Record<string, unknown>) => void;
	setFocusedScene: (sceneId: string | null) => void;
	setActiveScene: (sceneId: string | null) => void;
}

export interface CanvasExternalFileContext {
	projectId: string;
	fps: number;
	ensureProjectAssetByUri: (input: {
		uri: string;
		kind: TimelineAsset["kind"];
		name?: string;
	}) => string;
	resolveExternalFileUri: (
		file: File,
		kind: "video" | "audio" | "image",
	) => Promise<string>;
}

export type CanvasExternalFileResult = CanvasNodeCreateInput | null;

export interface CanvasNodeDefinition<TNode extends CanvasNode = CanvasNode> {
	type: TNode["type"];
	title: string;
	create: (input?: Record<string, unknown>) => CanvasNodeCreateInput;
	skiaRenderer: React.FC<CanvasNodeSkiaRenderProps<TNode>>;
	toolbar: React.FC<CanvasNodeToolbarProps<TNode>>;
	fromExternalFile?: (
		file: File,
		context: CanvasExternalFileContext,
	) => Promise<CanvasExternalFileResult>;
}
