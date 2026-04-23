import type { ImageCanvasNode } from "@/studio/project/types";
import { createTransformMeta } from "@/element-system/transform";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { secondsToFrames } from "@/utils/timecode";
import { ImageNodeSkiaRenderer } from "./renderer";
import { ImageNodeToolbar } from "./toolbar";

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

const imageDefinition: CanvasNodeDefinition<ImageCanvasNode> = {
	type: "image",
	title: "Image",
	create: () => ({ type: "image" }),
	skiaRenderer: ImageNodeSkiaRenderer,
	toolbar: ImageNodeToolbar,
	focusable: true,
	resolveResizeConstraints: ({ node, asset }) => {
		const sourceWidth = asset?.meta?.sourceSize?.width ?? node.width;
		const sourceHeight = asset?.meta?.sourceSize?.height ?? node.height;
		if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
			return {
				lockAspectRatio: true,
			};
		}
		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return {
				lockAspectRatio: true,
			};
		}
		return {
			lockAspectRatio: true,
			aspectRatio: sourceWidth / sourceHeight,
		};
	},
	contextMenu: ({ node, sceneOptions, onInsertNodeToScene }) => {
		const canInsert = Boolean(node.assetId);
		const sceneActions = sceneOptions.map((scene) => ({
			key: `insert-image-to-scene:${scene.sceneId}`,
			label: scene.label,
			disabled: !canInsert,
			onSelect: () => {
				onInsertNodeToScene(scene.sceneId);
			},
		}));
		return [
			{
				key: "insert-image-to-scene",
				label: "插入到 Scene",
				disabled: !canInsert || sceneActions.length === 0,
				onSelect: () => {},
				children: sceneActions,
			},
		];
	},
	fromExternalFile: async (file, context) => {
		if (!isImageFile(file)) return null;
		const metadata = await readImageMetadata(file).catch(() => ({
			width: 1920,
			height: 1080,
		}));
		const ingested = await context.ingestExternalFileAsset(file, "image");
		const assetId = context.ensureProjectAsset({
			kind: "image",
			name: ingested.name,
			locator: ingested.locator,
			meta: {
				...(ingested.meta ?? {}),
				sourceSize: {
					width: metadata.width,
					height: metadata.height,
				},
			},
		});
		return {
			type: "image",
			assetId,
			name: file.name,
			width: metadata.width,
			height: metadata.height,
		};
	},
	toTimelineClipboardElement: ({
		node,
		fps,
		startFrame,
		trackIndex,
		createElementId,
	}) => {
		if (!node.assetId) return null;
		const durationFrames = Math.max(1, secondsToFrames(5, fps));
		const width = Math.max(1, Math.round(Math.abs(node.width)));
		const height = Math.max(1, Math.round(Math.abs(node.height)));
		return {
			id: createElementId(),
			type: "Image",
			component: "image",
			name: node.name,
			assetId: node.assetId,
			props: {},
			transform: createTransformMeta({
				width,
				height,
				positionX: 0,
				positionY: 0,
			}),
			timeline: buildTimelineMeta(
				{
					start: startFrame,
					end: startFrame + durationFrames,
					trackIndex: trackIndex >= 0 ? trackIndex : 0,
					role: "clip",
				},
				fps,
			),
			render: {
				zIndex: 0,
				visible: true,
				opacity: 1,
			},
		};
	},
};

registerCanvasNodeDefinition(imageDefinition);
