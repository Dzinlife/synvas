import type { CompositionProps } from "core/timeline-system/types";
import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createCompositionModel } from "./model";
import { CompositionTimeline } from "./timeline";

const CompositionRenderer: React.FC = () => {
	return null;
};

export const CompositionDefinition: ElementComponentDefinition<CompositionProps> =
	{
		type: "Composition",
		component: "composition",
		createModel: createCompositionModel,
		Renderer: CompositionRenderer,
		Timeline: CompositionTimeline,
		meta: {
			name: "Composition",
			category: "media",
			trackRole: "clip",
			description: "Nested scene composition",
			hiddenInMaterialLibrary: true,
		},
	};

componentRegistry.register(CompositionDefinition);

export default CompositionRenderer;
