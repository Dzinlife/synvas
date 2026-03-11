import type { ElementComponentDefinition } from "../model/componentRegistry";
import { resolveClipboardNodeGeometry } from "../model/clipboardTransform";
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
	toCanvasClipboardNode: ({ element, sourceCanvasSize }) => {
		if (!element.assetId) return null;
		const geometry = resolveClipboardNodeGeometry(element, sourceCanvasSize, {
			width: 640,
			height: 360,
		});
		const duration = Math.max(
			1,
			Math.round(element.timeline.end - element.timeline.start),
		);
		return {
			type: "video",
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
		name: "Video Clip",
		category: "media",
		trackRole: "clip",
		description: "Video clip with support for trimming and playback",
	},
};

// 注册到全局组件注册表
componentRegistry.register(VideoClipDefinition);

export default VideoClipRenderer;
