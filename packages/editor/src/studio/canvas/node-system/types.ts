import type { TimelineAsset, TimelineElement } from "core/element/types";
import type {
	CanvasNode,
	SceneDocument,
	StudioProject,
} from "core/studio/types";
import type React from "react";
import type { IngestExternalFileAssetResult } from "@/projects/assetIngest";
import type { StudioRuntimeManager } from "@/scene-editor/runtime/types";
import type {
	CanvasNodeCreateInput,
	EnsureProjectAssetInput,
} from "@/projects/projectStore";
import type { StudioTimelineCanvasDropRequest } from "@/studio/clipboard/studioClipboardStore";

export interface CanvasNodeSkiaRenderProps<
	TNode extends CanvasNode = CanvasNode,
> {
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
	onDropTimelineElementsToCanvas?: (
		request: StudioTimelineCanvasDropRequest,
	) => boolean;
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

export interface CanvasNodeResizeConstraints {
	lockAspectRatio?: boolean;
	aspectRatio?: number;
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
}

export interface CanvasNodeResizeConstraintContext<
	TNode extends CanvasNode = CanvasNode,
> {
	node: TNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
}

export interface CanvasNodeContextMenuContext<
	TNode extends CanvasNode = CanvasNode,
> {
	node: TNode;
	project: StudioProject;
	sceneOptions: CanvasNodeContextMenuSceneOption[];
	onInsertNodeToScene: (sceneId: string) => void;
}

export interface CanvasNodeToTimelineElementContext<
	TNode extends CanvasNode = CanvasNode,
> {
	node: TNode;
	project: StudioProject;
	targetSceneId?: string | null;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
	fps: number;
	startFrame: number;
	trackIndex: number;
	createElementId: () => string;
}

export interface CanvasExternalFileContext {
	projectId: string;
	fps: number;
	ensureProjectAsset: (input: EnsureProjectAssetInput) => string;
	updateProjectAssetMeta: (
		assetId: string,
		updater: (
			prev: TimelineAsset["meta"] | undefined,
		) => TimelineAsset["meta"] | undefined,
	) => void;
	ingestExternalFileAsset: (
		file: File,
		kind: "video" | "audio" | "image",
	) => Promise<IngestExternalFileAssetResult>;
}

export type CanvasExternalFileResult = CanvasNodeCreateInput | null;

export interface CanvasNodeFocusEditorLayerState {
	enabled: boolean;
	layerProps: Record<string, unknown> | null;
}

export interface CanvasNodeFocusEditorBridgeProps<
	TNode extends CanvasNode = CanvasNode,
> {
	width: number;
	height: number;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	runtimeManager: StudioRuntimeManager;
	focusedNode: TNode;
	suspendHover?: boolean;
	onLayerChange: (state: CanvasNodeFocusEditorLayerState) => void;
}

export interface CanvasNodeDefinition<TNode extends CanvasNode = CanvasNode> {
	type: TNode["type"];
	title: string;
	create: (input?: Record<string, unknown>) => CanvasNodeCreateInput;
	skiaRenderer: React.FC<CanvasNodeSkiaRenderProps<TNode>>;
	focusEditorLayer?: React.ComponentType<unknown>;
	focusEditorBridge?: React.FC<CanvasNodeFocusEditorBridgeProps<TNode>>;
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
	resolveResizeConstraints?: (
		context: CanvasNodeResizeConstraintContext<TNode>,
	) => CanvasNodeResizeConstraints;
	fromExternalFile?: (
		file: File,
		context: CanvasExternalFileContext,
	) => Promise<CanvasExternalFileResult>;
	toTimelineClipboardElement?: (
		context: CanvasNodeToTimelineElementContext<TNode>,
	) => TimelineElement | null;
}
