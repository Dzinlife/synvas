import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import {
	createFreezeFrameModel,
	type FreezeFrameInternal,
	type FreezeFrameProps,
} from "./model";
import FreezeFrameRenderer from "./renderer";
import { FreezeFrameTimeline } from "./timeline";

export const FreezeFrameDefinition: DSLComponentDefinition<
	FreezeFrameProps,
	FreezeFrameInternal
> = {
	type: "FreezeFrame",
	component: "freeze-frame",
	createModel: createFreezeFrameModel,
	Renderer: FreezeFrameRenderer,
	Timeline: FreezeFrameTimeline,
	meta: {
		name: "Freeze Frame",
		category: "media",
		trackRole: "clip",
		description: "Freeze frame clip",
		hiddenInMaterialLibrary: true,
	},
};

componentRegistry.register(FreezeFrameDefinition);

export default FreezeFrameRenderer;
