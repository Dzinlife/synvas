import { useEffect, useRef } from "react";
import { Group, Image } from "react-skia-lite";
import type { RenderFrameChannel } from "core/timeline-system/model/types";
import { resolveVideoImageTransform } from "@/lib/videoImageTransform";
import {
	useFps,
	usePlaybackControl,
	useRenderTime,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import {
	calculateVideoTime,
	type VideoClipInternal,
	type VideoClipProps,
} from "./model";
import { applyPlayingPlaybackStrategy } from "./playbackStrategy";

interface VideoClipRendererProps extends VideoClipProps {
	id: string;
	__disableRuntimePlaybackEffects?: boolean;
	__frameChannel?: RenderFrameChannel;
}

const useVideoClipSelector = createModelSelector<
	VideoClipProps,
	VideoClipInternal
>();

const VideoClipRenderer: React.FC<VideoClipRendererProps> = ({
	id,
	__disableRuntimePlaybackEffects = false,
	__frameChannel = "current",
}) => {
	const frameChannel = __frameChannel === "offscreen" ? "offscreen" : "current";
	// 渲染时优先使用导出帧
	const currentTimeFrames = useRenderTime();
	const { fps } = useFps();
	const { isPlaying } = usePlaybackControl();
	const isExporting = useTimelineStore((state) => state.isExporting);

	// 直接从 TimelineStore 读取元素的 timeline 数据
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
	);
	const elementTransform = useTimelineStore(
		(state) => state.getElementById(id)?.transform,
	);
	const width = elementTransform?.baseSize.width ?? 0;
	const height = elementTransform?.baseSize.height ?? 0;

	// 订阅需要的状态
	const isLoading = useVideoClipSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useVideoClipSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const renderFrame = useVideoClipSelector(
		id,
		(state) =>
			frameChannel === "offscreen"
				? state.internal.offscreenFrame
				: state.internal.currentFrame,
	);
	const videoRotation = useVideoClipSelector(
		id,
		(state) => state.internal.videoRotation,
	);
	const playbackEpoch = useVideoClipSelector(
		id,
		(state) => state.internal.playbackEpoch ?? 0,
	);
	const props = useVideoClipSelector(id, (state) => state.props);
	const videoDuration = useVideoClipSelector(
		id,
		(state) => state.internal.videoDuration,
	);
	const seekToTime = useVideoClipSelector(
		id,
		(state) => state.internal.seekToTime,
	);
	const stepPlayback = useVideoClipSelector(
		id,
		(state) => state.internal.stepPlayback,
	);
	const stopPlayback = useVideoClipSelector(
		id,
		(state) => state.internal.stopPlayback,
	);
	const releasePlaybackSession = useVideoClipSelector(
		id,
		(state) => state.internal.releasePlaybackSession,
	);
	// 跟踪播放状态
	const wasPlayingRef = useRef(false);
	const wasExportingRef = useRef(false);

	useEffect(() => {
		void playbackEpoch;
		// sink 切换后重置播放状态，确保重新启动流式播放
		wasPlayingRef.current = false;
	}, [playbackEpoch]);

	// 处理播放状态变化
	useEffect(() => {
		if (__disableRuntimePlaybackEffects) return;
		if (isExporting) return;
		if (
			isLoading ||
			hasError ||
			!props.uri ||
			videoDuration <= 0 ||
			!timeline
		) {
			return;
		}

		const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30;
		const startSeconds = framesToSeconds(timeline.start ?? 0, safeFps);
		const currentSeconds = framesToSeconds(currentTimeFrames, fps);
		const clipDurationSeconds = framesToSeconds(
			timeline.end - timeline.start,
			safeFps,
		);
		const offsetSeconds = framesToSeconds(timeline.offset ?? 0, safeFps);

		// 计算实际要 seek 的视频时间
		const videoTime = calculateVideoTime({
			start: startSeconds,
			timelineTime: currentSeconds,
			videoDuration,
			reversed: props.reversed,
			offset: offsetSeconds,
			clipDuration: clipDurationSeconds,
		});

		// 播放中：使用统一步进，跨组件跳转也能生效
		if (isPlaying) {
			if (!wasPlayingRef.current) {
				wasPlayingRef.current = true;
			}
			applyPlayingPlaybackStrategy({
				reversed: Boolean(props.reversed),
				videoTime,
				frameChannel,
				seekToTime,
				stepPlayback,
			});
			return;
		}

		// 播放状态变化：从播放到暂停
		if (wasPlayingRef.current) {
			wasPlayingRef.current = false;
			stopPlayback(frameChannel);
		}

		// 非播放状态：直接 seek，保证逐帧拖动时每一帧都刷新。
		seekToTime(videoTime, { frameChannel });
	}, [
		props.uri,
		props.reversed,
		timeline,
		videoDuration,
		isLoading,
		hasError,
		currentTimeFrames,
		fps,
		isPlaying,
		seekToTime,
		stepPlayback,
		stopPlayback,
		isExporting,
		__disableRuntimePlaybackEffects,
		frameChannel,
	]);

	useEffect(() => {
		if (isExporting) {
			// 导出期间只重置状态，不停止流式播放，避免频繁重启
			wasExportingRef.current = true;
			wasPlayingRef.current = false;
			return;
		}
		if (wasExportingRef.current) {
			// 导出结束后再停止流式播放，清理资源
			wasExportingRef.current = false;
			stopPlayback(frameChannel);
		}
	}, [isExporting, stopPlayback, frameChannel]);

	// 组件卸载时仅释放会话引用，避免跨切点瞬间停流
	useEffect(() => {
		return () => {
			if (isExporting) return;
			// 离屏树每帧都会卸载，避免频繁释放导致会话反复冷启动
			if (__disableRuntimePlaybackEffects) return;
			releasePlaybackSession(frameChannel);
		};
	}, [
		isExporting,
		releasePlaybackSession,
		frameChannel,
		__disableRuntimePlaybackEffects,
	]);

	// Loading 状态
	if (isLoading) {
		return null;
	}

	// Error 状态
	if (hasError) {
		return null;
	}

	if (!renderFrame || width <= 0 || height <= 0) {
		return null;
	}

	const sourceWidth = Math.max(1, renderFrame.width());
	const sourceHeight = Math.max(1, renderFrame.height());
	const imageTransform = resolveVideoImageTransform({
		src: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
		dst: { x: 0, y: 0, width, height },
		rotation: videoRotation,
	});

	// 正常渲染
	return (
		<Group transform={imageTransform}>
			<Image
				image={renderFrame}
				x={0}
				y={0}
				width={sourceWidth}
				height={sourceHeight}
				fit="fill"
			/>
		</Group>
	);
};

export default VideoClipRenderer;
