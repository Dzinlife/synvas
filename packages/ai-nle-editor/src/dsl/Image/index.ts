import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createImageModel, type ImageProps } from "./model";
import ImageRenderer from "./renderer";
import { ImageTimeline } from "./timeline";

export { createImageModel, type ImageInternal, type ImageProps } from "./model";
export { ImageTimeline } from "./timeline";

// 组件定义
export const ImageDefinition: DSLComponentDefinition<ImageProps> = {
	type: "Image",
	component: "image",
	createModel: createImageModel,
	Renderer: ImageRenderer,
	Timeline: ImageTimeline,
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
