import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { type AudioClipProps, createAudioClipModel } from "./model";
import AudioClipRenderer from "./renderer";
import { AudioClipTimeline } from "./timeline";

export const AudioClipDefinition: DSLComponentDefinition<AudioClipProps> = {
	type: "AudioClip",
	component: "audio-clip",
	createModel: createAudioClipModel,
	Renderer: AudioClipRenderer,
	Timeline: AudioClipTimeline,
	meta: {
		name: "Audio Clip",
		category: "media",
		trackRole: "audio",
		description: "Audio clip for timeline",
		defaultProps: {},
	},
};

componentRegistry.register(AudioClipDefinition);

export default AudioClipRenderer;
