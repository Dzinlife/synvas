import type { ElementComponentDefinition } from "../model/componentRegistry";
import { resolveClipboardNodeGeometry } from "../model/clipboardTransform";
import { componentRegistry } from "../model/componentRegistry";
import { type AudioClipProps, createAudioClipModel } from "./model";
import AudioClipRenderer from "./renderer";
import { AudioClipSetting } from "./setting";
import { AudioClipTimeline } from "./timeline";

export const AudioClipDefinition: ElementComponentDefinition<AudioClipProps> = {
	type: "AudioClip",
	component: "audio-clip",
	createModel: createAudioClipModel,
	Renderer: AudioClipRenderer,
	Timeline: AudioClipTimeline,
	Setting: AudioClipSetting,
	toCanvasClipboardNode: ({ element, sourceCanvasSize }) => {
		if (!element.assetId) return null;
		const geometry = resolveClipboardNodeGeometry(element, sourceCanvasSize, {
			width: 640,
			height: 180,
		});
		const duration = Math.max(
			1,
			Math.round(element.timeline.end - element.timeline.start),
		);
		return {
			type: "audio",
			assetId: element.assetId,
			name: element.name,
			duration,
			x: geometry.x,
			y: geometry.y,
			width: geometry.width,
			height: geometry.height,
		};
	},
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
