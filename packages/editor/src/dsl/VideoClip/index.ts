import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createVideoClipModel, type VideoClipProps } from "./model";
import VideoClipRenderer from "./renderer";
import { VideoClipTimeline } from "./timeline";

// 组件定义
export const VideoClipDefinition: DSLComponentDefinition<VideoClipProps> = {
	type: "VideoClip",
	component: "video-clip",
	createModel: createVideoClipModel,
	Renderer: VideoClipRenderer,
	prepareRenderFrame: async ({
		element,
		displayTime,
		fps,
		modelStore,
	}) => {
		await modelStore?.getState()?.prepareFrame?.({
			element,
			displayTime,
			fps,
			phase: "beforeRender",
		});
	},
	Timeline: VideoClipTimeline,
	meta: {
		name: "Video Clip",
		category: "media",
		trackRole: "clip",
		description: "Video clip with support for trimming and playback",
		defaultProps: {
			reversed: false,
			start: 0,
			end: 5,
		},
	},
};

// 注册到全局组件注册表
componentRegistry.register(VideoClipDefinition);

export default VideoClipRenderer;
