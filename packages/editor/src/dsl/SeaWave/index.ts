import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createSeaWaveModel, type SeaWaveProps } from "./model";
import SeaWaveRenderer from "./renderer";
import { SeaWaveTimeline } from "./timeline";

export const SeaWaveDefinition: DSLComponentDefinition<SeaWaveProps> = {
	type: "Background",
	component: "background/sea-wave",
	createModel: createSeaWaveModel,
	Renderer: SeaWaveRenderer,
	Timeline: SeaWaveTimeline,
	meta: {
		name: "Sea Wave",
		category: "Background",
		trackRole: "clip",
		description: "A turbulent sea wave shader effect",
		defaultProps: {
			speed: 1.0,
			amplitude: 1.0,
			frequency: 2.0,
			waveColor: "#1e3a8a",
			foamColor: "#ffffff",
			deepWaterColor: "#0f172a",
		},
	},
};

componentRegistry.register(SeaWaveDefinition);

export default SeaWaveDefinition;
