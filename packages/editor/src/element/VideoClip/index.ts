import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createVideoClipModel, type VideoClipProps } from "./model";
import VideoClipRenderer from "./renderer";
import { VideoClipSetting } from "./setting";
import { VideoClipTimeline } from "./timeline";

// 组件定义
export const VideoClipDefinition: ElementComponentDefinition<VideoClipProps> = {
	type: "VideoClip",
	component: "video-clip",
	createModel: createVideoClipModel,
	Renderer: VideoClipRenderer,
	prepareRenderFrame: async ({
		element,
		displayTime,
		fps,
		frameChannel,
		modelStore,
	}) => {
		await modelStore?.getState()?.prepareFrame?.({
			element,
			displayTime,
			fps,
			phase: "beforeRender",
			frameChannel,
		});
	},
	Timeline: VideoClipTimeline,
	Setting: VideoClipSetting,
	meta: {
		name: "Video Clip",
		category: "media",
		trackRole: "clip",
		description: "Video clip with support for trimming and playback",
	},
};

// 注册到全局组件注册表
componentRegistry.register(VideoClipDefinition);

export default VideoClipRenderer;
