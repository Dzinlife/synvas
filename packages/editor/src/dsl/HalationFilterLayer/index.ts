import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import {
	createHalationFilterLayerModel,
	HALATION_FILTER_DEFAULT_PROPS,
	type HalationFilterLayerProps,
} from "./model";
import HalationFilterLayer from "./renderer";
import { HalationFilterLayerSetting } from "./setting";
import { HalationFilterLayerTimeline } from "./timeline";

export {
	createHalationFilterLayerModel,
	HALATION_FILTER_DEFAULT_PROPS,
	type HalationFilterLayerProps,
} from "./model";
export { HalationFilterLayerSetting } from "./setting";
export { HalationFilterLayerTimeline } from "./timeline";

export const HalationFilterLayerDefinition: DSLComponentDefinition<HalationFilterLayerProps> =
	{
		type: "Filter",
		component: "filter/halation",
		createModel: createHalationFilterLayerModel,
		Renderer: HalationFilterLayer,
		Timeline: HalationFilterLayerTimeline,
		Setting: HalationFilterLayerSetting,
		meta: {
			name: "Halation",
			category: "effect",
			trackRole: "effect",
			description: "Film-style warm highlight halation",
			defaultProps: HALATION_FILTER_DEFAULT_PROPS,
		},
	};

componentRegistry.register(HalationFilterLayerDefinition);

export default HalationFilterLayer;
