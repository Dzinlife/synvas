import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createTransitionModel, type TransitionProps } from "./model";
import TransitionRenderer from "./renderer";
import { TransitionTimeline } from "./timeline";

export { createTransitionModel, type TransitionProps } from "./model";
export { renderNodeToImage, renderNodeToPicture } from "./picture";
export { TransitionTimeline } from "./timeline";

export const TransitionDefinition: ElementComponentDefinition<TransitionProps> = {
	type: "Transition",
	component: "transition/crossfade",
	createModel: createTransitionModel,
	Renderer: TransitionRenderer,
	transitionInputMode: "texture",
	Timeline: TransitionTimeline,
	meta: {
		name: "Crossfade",
		category: "transition",
		trackRole: "clip",
		description: "Crossfade between adjacent clips",
		defaultProps: {},
	},
};

componentRegistry.register(TransitionDefinition);

export default TransitionRenderer;
