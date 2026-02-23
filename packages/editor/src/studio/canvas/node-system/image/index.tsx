import type { ImageCanvasNode } from "core/studio/types";
import { Rect } from "react-skia-lite";
import { registerCanvasNodeDefinition } from "../registryCore";
import type {
	CanvasNodeDefinition,
	CanvasNodeSkiaRenderProps,
	CanvasNodeToolbarProps,
} from "../types";

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

const ImageNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<ImageCanvasNode>
> = ({ node }) => {
	if (node.type !== "image") return null;
	return (
		<Rect
			x={0}
			y={0}
			width={Math.max(1, node.width)}
			height={Math.max(1, node.height)}
			color="#312e81"
		/>
	);
};

const ImageNodeToolbar = ({ asset }: CanvasNodeToolbarProps<ImageCanvasNode>) => {
	return (
		<div className="text-xs text-white/90">
			Image Source: {asset?.uri ?? "未绑定图片素材"}
		</div>
	);
};

const imageDefinition: CanvasNodeDefinition<ImageCanvasNode> = {
	type: "image",
	title: "Image",
	create: () => ({ type: "image" }),
	skiaRenderer: ImageNodeSkiaRenderer,
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

registerCanvasNodeDefinition(imageDefinition);
