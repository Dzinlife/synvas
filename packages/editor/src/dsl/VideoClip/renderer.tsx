import { useEffect, useRef } from "react";
import { Group, ImageShader, Rect } from "react-skia-lite";
import {
	useFps,
	usePlaybackControl,
	useRenderTime,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import {
	calculateVideoTime,
	type VideoClipInternal,
	type VideoClipProps,
} from "./model";

interface VideoClipRendererProps extends VideoClipProps {
	id: string;
}

const useVideoClipSelector = createModelSelector<
	VideoClipProps,
	VideoClipInternal
>();

// 低于该帧数的时间抖动不触发 seek（按时间线 FPS 计算）
const SEEK_SKIP_FRAMES = 1.5;

const VideoClipRenderer: React.FC<VideoClipRendererProps> = ({ id }) => {
	// 渲染时优先使用导出帧
	const currentTimeFrames = useRenderTime();
	const { fps } = useFps();
	const { isPlaying } = usePlaybackControl();
	const isExporting = useTimelineStore((state) => state.isExporting);

	// 直接从 TimelineStore 读取元素的 timeline 数据
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
	);
	const transform = useTimelineStore(
		(state) => state.getElementById(id)?.transform,
	);
	const width = transform?.baseSize.width ?? 0;
	const height = transform?.baseSize.height ?? 0;

	// 订阅需要的状态
	const isLoading = useVideoClipSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useVideoClipSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const currentFrame = useVideoClipSelector(
		id,
		(state) => state.internal.currentFrame,
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
	const lastVideoTimeRef = useRef<number | null>(null);
	const wasExportingRef = useRef(false);

	useEffect(() => {
		void playbackEpoch;
		// sink 切换后重置播放状态，确保重新启动流式播放
		wasPlayingRef.current = false;
		lastVideoTimeRef.current = null;
	}, [playbackEpoch]);

	// 处理播放状态变化
	useEffect(() => {
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
		const seekSkipSeconds = SEEK_SKIP_FRAMES / safeFps;
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
			stepPlayback(videoTime);
			return;
		}

		// 播放状态变化：从播放到暂停
		if (wasPlayingRef.current) {
			wasPlayingRef.current = false;
			stopPlayback();
		}

		// 非播放状态：使用 seek（拖动时间轴）
		if (
			lastVideoTimeRef.current !== null &&
			Math.abs(lastVideoTimeRef.current - videoTime) < seekSkipSeconds
		) {
			return; // 时间变化太小，跳过
		}

		lastVideoTimeRef.current = videoTime;
		seekToTime(videoTime);
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
	]);

	useEffect(() => {
		if (isExporting) {
			// 导出期间只重置状态，不停止流式播放，避免频繁重启
			wasExportingRef.current = true;
			wasPlayingRef.current = false;
			lastVideoTimeRef.current = null;
			return;
		}
		if (wasExportingRef.current) {
			// 导出结束后再停止流式播放，清理资源
			wasExportingRef.current = false;
			stopPlayback();
		}
	}, [isExporting, stopPlayback]);

	// 组件卸载时仅释放会话引用，避免跨切点瞬间停流
	useEffect(() => {
		return () => {
			if (isExporting) return;
			releasePlaybackSession();
		};
	}, [isExporting, releasePlaybackSession]);

	// Loading 状态
	if (isLoading) {
		return (
			<Group>
				<Rect x={0} y={0} width={width} height={height} color="#e5e7eb" />
			</Group>
		);
	}

	// Error 状态
	if (hasError) {
		return (
			<Group>
				<Rect x={0} y={0} width={width} height={height} color="#fee2e2" />
			</Group>
		);
	}

	// 正常渲染
	return (
		<Group>
			<Rect
				x={0}
				y={0}
				width={width}
				height={height}
				color={currentFrame ? undefined : "transparent"}
			>
				{currentFrame && (
					<ImageShader
						image={currentFrame}
						fit="contain"
						x={0}
						y={0}
						width={width}
						height={height}
					/>
				)}
			</Rect>
		</Group>
	);
};

export default VideoClipRenderer;
