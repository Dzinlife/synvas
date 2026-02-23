import type { CanvasNode } from "core/studio/types";
import { isAudioFile, readAudioMetadata } from "@/asr/opfsAudio";
import {
	getFallbackVideoMetadata,
	isVideoFile,
	readVideoMetadata,
} from "@/editor/utils/externalVideo";
import type {
	CanvasNodeDefinition,
	CanvasNodeRenderProps,
	CanvasNodeToolbarProps,
} from "./types";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif",
	"bmp",
	"svg",
	"heic",
	"heif",
	"tiff",
	"tif",
	"avif",
]);

const isImageFile = (file: File): boolean => {
	if (file.type.startsWith("image/")) return true;
	const parts = file.name.toLowerCase().split(".");
	if (parts.length < 2) return false;
	const ext = parts[parts.length - 1];
	return IMAGE_EXTENSIONS.has(ext);
};

const readImageMetadata = async (
	file: File,
): Promise<{ width: number; height: number }> => {
	const url = URL.createObjectURL(file);
	const image = new Image();
	image.src = url;
	try {
		const metadata = await new Promise<{ width: number; height: number }>(
			(resolve, reject) => {
				image.onload = () => {
					resolve({
						width: image.naturalWidth || 1920,
						height: image.naturalHeight || 1080,
					});
				};
				image.onerror = () => {
					reject(new Error("读取图片元数据失败"));
				};
			},
		);
		return metadata;
	} finally {
		image.src = "";
		URL.revokeObjectURL(url);
	}
};

const SceneNodeRenderer = ({
	node,
	scene,
	isFocused,
	isPreviewPlaying,
	onTogglePreview,
}: CanvasNodeRenderProps) => {
	if (node.type !== "scene") return null;
	return (
		<div className="flex h-full w-full flex-col rounded-lg bg-slate-900/30 p-3 text-white">
			<div className="truncate text-sm font-medium">
				{scene?.name ?? node.name}
			</div>
			<div className="mt-1 text-[11px] text-white/70">Scene Node</div>
			{!isFocused && (
				<button
					type="button"
					className="mt-auto h-6 w-10 rounded bg-black/35 text-xs hover:bg-black/55"
					onClick={(event) => {
						event.stopPropagation();
						onTogglePreview();
					}}
					data-testid={`scene-preview-toggle-${node.id}`}
				>
					{isPreviewPlaying ? "⏸" : "▶"}
				</button>
			)}
		</div>
	);
};

const VideoNodeRenderer = ({ asset }: CanvasNodeRenderProps) => {
	return (
		<div className="flex h-full w-full flex-col rounded-lg bg-sky-950/35 p-3 text-white">
			<div className="text-sm font-medium">Video</div>
			<div className="mt-1 line-clamp-2 text-[11px] text-white/75 break-all">
				{asset?.uri ?? "未绑定视频素材"}
			</div>
		</div>
	);
};

const AudioNodeRenderer = ({ asset }: CanvasNodeRenderProps) => {
	return (
		<div className="flex h-full w-full flex-col rounded-lg bg-emerald-950/35 p-3 text-white">
			<div className="text-sm font-medium">Audio</div>
			<div className="mt-1 line-clamp-2 text-[11px] text-white/75 break-all">
				{asset?.uri ?? "未绑定音频素材"}
			</div>
		</div>
	);
};

const ImageNodeRenderer = ({ asset }: CanvasNodeRenderProps) => {
	return (
		<div className="flex h-full w-full flex-col rounded-lg bg-indigo-950/35 p-3 text-white">
			<div className="text-sm font-medium">Image</div>
			<div className="mt-1 line-clamp-2 text-[11px] text-white/75 break-all">
				{asset?.uri ?? "未绑定图片素材"}
			</div>
		</div>
	);
};

const TextNodeRenderer = ({ node }: CanvasNodeRenderProps) => {
	if (node.type !== "text") return null;
	return (
		<div className="flex h-full w-full flex-col rounded-lg bg-amber-950/35 p-3 text-white">
			<div className="text-sm font-medium">Text</div>
			<div className="mt-1 line-clamp-3 text-[12px] text-white/75">
				{node.text}
			</div>
		</div>
	);
};

const SceneNodeToolbar = ({
	node,
	scene,
	setActiveScene,
	setFocusedScene,
}: CanvasNodeToolbarProps) => {
	if (node.type !== "scene") return null;
	return (
		<div className="flex items-center gap-3 text-xs text-white/90">
			<div className="font-medium">{scene?.name ?? node.name}</div>
			<div className="text-white/60">{node.sceneId}</div>
			<button
				type="button"
				className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
				onClick={() => {
					setActiveScene(node.sceneId);
					setFocusedScene(node.sceneId);
				}}
			>
				聚焦 Scene
			</button>
			<button
				type="button"
				className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
				onClick={() => {
					setFocusedScene(null);
				}}
			>
				退出聚焦
			</button>
		</div>
	);
};

const VideoNodeToolbar = ({ asset }: CanvasNodeToolbarProps) => {
	return (
		<div className="text-xs text-white/90">
			Video Source: {asset?.uri ?? "未绑定视频素材"}
		</div>
	);
};

const AudioNodeToolbar = ({ asset }: CanvasNodeToolbarProps) => {
	return (
		<div className="text-xs text-white/90">
			Audio Source: {asset?.uri ?? "未绑定音频素材"}
		</div>
	);
};

const ImageNodeToolbar = ({ asset }: CanvasNodeToolbarProps) => {
	return (
		<div className="text-xs text-white/90">
			Image Source: {asset?.uri ?? "未绑定图片素材"}
		</div>
	);
};

const TextNodeToolbar = ({
	node,
	updateNode,
}: CanvasNodeToolbarProps) => {
	if (node.type !== "text") return null;
	return (
		<div className="flex items-center gap-3 text-xs text-white/90">
			<input
				type="text"
				className="h-8 min-w-56 rounded border border-white/20 bg-black/20 px-2 text-xs"
				value={node.text}
				onChange={(event) => {
					updateNode({ text: event.target.value });
				}}
			/>
			<input
				type="number"
				min={12}
				max={144}
				className="h-8 w-20 rounded border border-white/20 bg-black/20 px-2 text-xs"
				value={node.fontSize}
				onChange={(event) => {
					const nextValue = Number(event.target.value);
					if (!Number.isFinite(nextValue)) return;
					updateNode({ fontSize: Math.max(12, Math.min(144, nextValue)) });
				}}
			/>
		</div>
	);
};

const sceneDefinition: CanvasNodeDefinition = {
	type: "scene",
	title: "Scene",
	create: () => ({ type: "scene" }),
	renderer: SceneNodeRenderer,
	toolbar: SceneNodeToolbar,
};

const videoDefinition: CanvasNodeDefinition = {
	type: "video",
	title: "Video",
	create: () => ({ type: "video" }),
	renderer: VideoNodeRenderer,
	toolbar: VideoNodeToolbar,
	fromExternalFile: async (file, context) => {
		if (!isVideoFile(file)) return null;
		const metadata = await readVideoMetadata(file).catch(() =>
			getFallbackVideoMetadata(),
		);
		const uri = await context.resolveExternalFileUri(file, "video");
		const assetId = context.ensureProjectAssetByUri({
			uri,
			kind: "video",
			name: file.name,
		});
		return {
			type: "video",
			assetId,
			name: file.name,
			width: metadata.width,
			height: metadata.height,
			duration: Math.max(1, Math.round(metadata.duration * context.fps)),
			naturalWidth: metadata.width,
			naturalHeight: metadata.height,
		};
	},
};

const audioDefinition: CanvasNodeDefinition = {
	type: "audio",
	title: "Audio",
	create: () => ({ type: "audio" }),
	renderer: AudioNodeRenderer,
	toolbar: AudioNodeToolbar,
	fromExternalFile: async (file, context) => {
		if (!isAudioFile(file)) return null;
		const metadata = await readAudioMetadata(file).catch(() => ({ duration: 1 }));
		const uri = await context.resolveExternalFileUri(file, "audio");
		const assetId = context.ensureProjectAssetByUri({
			uri,
			kind: "audio",
			name: file.name,
		});
		return {
			type: "audio",
			assetId,
			name: file.name,
			duration: Math.max(1, Math.round(metadata.duration * context.fps)),
		};
	},
};

const imageDefinition: CanvasNodeDefinition = {
	type: "image",
	title: "Image",
	create: () => ({ type: "image" }),
	renderer: ImageNodeRenderer,
	toolbar: ImageNodeToolbar,
	fromExternalFile: async (file, context) => {
		if (!isImageFile(file)) return null;
		const metadata = await readImageMetadata(file).catch(() => ({
			width: 1920,
			height: 1080,
		}));
		const uri = await context.resolveExternalFileUri(file, "image");
		const assetId = context.ensureProjectAssetByUri({
			uri,
			kind: "image",
			name: file.name,
		});
		return {
			type: "image",
			assetId,
			name: file.name,
			width: metadata.width,
			height: metadata.height,
			naturalWidth: metadata.width,
			naturalHeight: metadata.height,
		};
	},
};

const textDefinition: CanvasNodeDefinition = {
	type: "text",
	title: "Text",
	create: () => ({ type: "text", text: "新建文本", name: "Text" }),
	renderer: TextNodeRenderer,
	toolbar: TextNodeToolbar,
};

export const canvasNodeDefinitions: Record<CanvasNode["type"], CanvasNodeDefinition> =
	{
		scene: sceneDefinition,
		video: videoDefinition,
		audio: audioDefinition,
		image: imageDefinition,
		text: textDefinition,
	};

export const canvasNodeDefinitionList: CanvasNodeDefinition[] =
	Object.values(canvasNodeDefinitions);

export const getCanvasNodeDefinition = (
	type: CanvasNode["type"],
): CanvasNodeDefinition => {
	return canvasNodeDefinitions[type];
};
