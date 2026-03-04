import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import {
	createTransitionModel,
	type TransitionProps,
} from "../Transition/model";
import { TransitionTimeline } from "../Transition/timeline";
import RippleDissolveTransitionRenderer from "./renderer";

export const RippleDissolveTransitionDefinition: ElementComponentDefinition<TransitionProps> =
	{
		type: "Transition",
		component: "transition/ripple-dissolve",
		createModel: createTransitionModel,
		Renderer: RippleDissolveTransitionRenderer,
		Timeline: TransitionTimeline,
		meta: {
			name: "Ripple Dissolve",
			category: "transition",
			trackRole: "clip",
			description: "Ripple dissolve shader transition",
			defaultProps: {},
		},
	};

componentRegistry.register(RippleDissolveTransitionDefinition);

export default RippleDissolveTransitionDefinition;
