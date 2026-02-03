import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { type BackdropZoomProps, createBackdropZoomModel } from "./model";
import BackdropZoom from "./renderer";
import { BackdropZoomTimeline } from "./timeline";

export { type BackdropZoomProps, createBackdropZoomModel } from "./model";
export { BackdropZoomTimeline } from "./timeline";

// 组件定义
export const BackdropZoomDefinition: DSLComponentDefinition<BackdropZoomProps> =
	{
		type: "Filter",
		component: "filter/backdrop-zoom",
		createModel: createBackdropZoomModel,
		Renderer: BackdropZoom,
		Timeline: BackdropZoomTimeline,
		meta: {
			name: "Backdrop Zoom",
			category: "effect",
			trackRole: "effect",
			description: "Zoom effect for backdrop elements",
		},
	};

// 注册到全局组件注册表
componentRegistry.register(BackdropZoomDefinition);

export default BackdropZoom;
