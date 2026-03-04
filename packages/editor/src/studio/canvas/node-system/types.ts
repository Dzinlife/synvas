import type { TimelineAsset } from "core/element/types";
import type { CanvasNode, SceneDocument, StudioProject } from "core/studio/types";
import type React from "react";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
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
	setFocusedNode: (nodeId: string | null) => void;
	setActiveScene: (sceneId: string | null) => void;
}

export type CanvasNodeDrawerTrigger = "focus" | "active";

export interface CanvasNodeDrawerOptions {
	trigger?: CanvasNodeDrawerTrigger;
	resizable?: boolean;
	defaultHeight?: number;
	minHeight?: number;
	maxHeightRatio?: number;
}

export interface CanvasNodeDrawerProps<TNode extends CanvasNode = CanvasNode> {
	node: TNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
	onClose: () => void;
	onHeightChange?: (height: number) => void;
}

export interface CanvasNodeContextMenuAction {
	key: string;
	label: string;
	disabled?: boolean;
	danger?: boolean;
	onSelect: () => void;
	children?: CanvasNodeContextMenuAction[];
}

export interface CanvasNodeContextMenuSceneOption {
	sceneId: string;
	label: string;
}

export interface CanvasNodeContextMenuContext<
	TNode extends CanvasNode = CanvasNode,
> {
	node: TNode;
	project: StudioProject;
	sceneOptions: CanvasNodeContextMenuSceneOption[];
	onInsertNodeToScene: (sceneId: string) => void;
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
	focusable?: boolean;
	drawer?: React.FC<CanvasNodeDrawerProps<TNode>>;
	drawerOptions?: CanvasNodeDrawerOptions;
	/**
	 * @deprecated 请使用 drawerOptions.trigger。
	 */
	drawerTrigger?: CanvasNodeDrawerTrigger;
	contextMenu?: (
		context: CanvasNodeContextMenuContext<TNode>,
	) => CanvasNodeContextMenuAction[];
	fromExternalFile?: (
		file: File,
		context: CanvasExternalFileContext,
	) => Promise<CanvasExternalFileResult>;
}
