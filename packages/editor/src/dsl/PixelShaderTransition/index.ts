import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createTransitionModel, type TransitionProps } from "../Transition/model";
import { TransitionTimeline } from "../Transition/timeline";
import PixelShaderTransitionRenderer from "./renderer";

export const PixelShaderTransitionDefinition: DSLComponentDefinition<
	TransitionProps
> = {
	type: "Transition",
	component: "transition/pixel-shader",
	createModel: createTransitionModel,
	Renderer: PixelShaderTransitionRenderer,
	Timeline: TransitionTimeline,
	meta: {
		name: "Pixel Shader",
		category: "transition",
		trackRole: "clip",
		description: "Pixel-style shader transition",
		defaultProps: {},
	},
};

componentRegistry.register(PixelShaderTransitionDefinition);

export default PixelShaderTransitionDefinition;
