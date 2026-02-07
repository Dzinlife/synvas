import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import {
	createHalationFilterLayerModel,
	type HalationFilterLayerProps,
} from "./model";
import HalationFilterLayer from "./renderer";
import { HalationFilterLayerTimeline } from "./timeline";

export {
	createHalationFilterLayerModel,
	type HalationFilterLayerProps,
} from "./model";
export { HalationFilterLayerTimeline } from "./timeline";

export const HalationFilterLayerDefinition: DSLComponentDefinition<HalationFilterLayerProps> =
	{
		type: "Filter",
		component: "filter/halation",
		createModel: createHalationFilterLayerModel,
		Renderer: HalationFilterLayer,
		Timeline: HalationFilterLayerTimeline,
		meta: {
			name: "Halation",
			category: "effect",
			trackRole: "effect",
			description: "Film-style warm highlight halation",
			defaultProps: {
				intensity: 0.45,
				threshold: 0.78,
				radius: 8,
				diffusion: 0.55,
				warmness: 0.6,
				chromaticShift: 1.2,
				shape: "rect",
				cornerRadius: 0,
			},
		},
	};

componentRegistry.register(HalationFilterLayerDefinition);

export default HalationFilterLayer;
