import type { ElementComponentDefinition } from "../model/componentRegistry";
import { resolveClipboardNodeGeometry } from "../model/clipboardTransform";
import { componentRegistry } from "../model/componentRegistry";
import { createImageModel, type ImageProps } from "./model";
import ImageRenderer from "./renderer";
import { ImageTimeline } from "./timeline";

export { createImageModel, type ImageInternal, type ImageProps } from "./model";
export { ImageTimeline } from "./timeline";

// 组件定义
export const ImageDefinition: ElementComponentDefinition<ImageProps> = {
	type: "Image",
	component: "image",
	createModel: createImageModel,
	Renderer: ImageRenderer,
	Timeline: ImageTimeline,
	toCanvasClipboardNode: ({ element, sourceCanvasSize }) => {
		if (!element.assetId) return null;
		const geometry = resolveClipboardNodeGeometry(element, sourceCanvasSize, {
			width: 640,
			height: 360,
		});
		return {
			type: "image",
			assetId: element.assetId,
			name: element.name,
			x: geometry.x,
			y: geometry.y,
			width: geometry.width,
			height: geometry.height,
		};
	},
	meta: {
		name: "Image",
		category: "media",
		trackRole: "clip",
		description: "Static image component",
	},
};

// 注册到全局组件注册表
componentRegistry.register(ImageDefinition);

export default ImageRenderer;
