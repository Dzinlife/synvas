import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import {
	type ColorFilterLayerProps,
	createColorFilterLayerModel,
} from "./model";
import ColorFilterLayer from "./renderer";
import { ColorFilterLayerTimeline } from "./timeline";

export {
	type ColorFilterLayerProps,
	createColorFilterLayerModel,
} from "./model";
export { ColorFilterLayerTimeline } from "./timeline";

// 组件定义
export const ColorFilterLayerDefinition: DSLComponentDefinition<ColorFilterLayerProps> =
	{
		type: "Filter",
		component: "filter/color-filter",
		createModel: createColorFilterLayerModel,
		Renderer: ColorFilterLayer,
		Timeline: ColorFilterLayerTimeline,
		meta: {
			name: "Color Filter",
			category: "effect",
			trackRole: "effect",
			description: "Color adjustment and filter effects",
		},
	};

// 注册到全局组件注册表
componentRegistry.register(ColorFilterLayerDefinition);

export default ColorFilterLayer;
