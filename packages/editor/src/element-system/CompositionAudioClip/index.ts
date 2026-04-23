import type { CompositionProps } from "core/timeline-system/types";
import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createCompositionAudioClipModel } from "../Composition/model";
import { CompositionAudioClipTimeline } from "./timeline";

const CompositionAudioClipRenderer: React.FC = () => {
	return null;
};

export const CompositionAudioClipDefinition: ElementComponentDefinition<CompositionProps> =
	{
		type: "CompositionAudioClip",
		component: "composition-audio-clip",
		createModel: createCompositionAudioClipModel,
		Renderer: CompositionAudioClipRenderer,
		Timeline: CompositionAudioClipTimeline,
		meta: {
			name: "Composition Audio Clip",
			category: "media",
			trackRole: "audio",
			description: "Audio proxy clip backed by a nested scene composition",
			hiddenInMaterialLibrary: true,
		},
	};

componentRegistry.register(CompositionAudioClipDefinition);

export default CompositionAudioClipRenderer;
