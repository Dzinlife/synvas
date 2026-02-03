import { useCallback } from "react";
import { Group, Rect, Skottie } from "react-skia-lite";
import { useFps, useRenderTime, useTimelineStore } from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import { useRenderLayout } from "../useRenderLayout";
import type { LottieInternal, LottieProps } from "./model";

interface LottieRendererProps extends LottieProps {
	id: string;
	uri?: string;
	speed?: number;
	loop?: boolean;
}

const useLottieSelector = createModelSelector<LottieProps, LottieInternal>();

const Lottie: React.FC<LottieRendererProps> = ({
	id,
	speed = 1.0,
	loop = true,
}) => {
	const currentTime = useRenderTime();
	const { fps } = useFps();

	// 直接从 TimelineStore 读取元素的 timeline 数据
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
	);

	// 将中心坐标转换为左上角坐标
	const {
		cx,
		cy,
		w: width,
		h: height,
		rotation: rotate = 0,
	} = useRenderLayout(id);
	const x = cx - width / 2;
	const y = cy - height / 2;

	// 从 model 获取动画和状态
	const animation = useLottieSelector(id, (state) => state.internal.animation);
	const isLoading = useLottieSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useLottieSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);

	// 计算当前帧数
	const getCurrentFrame = useCallback(() => {
		if (!animation || !timeline) return 0;

		// 计算相对于组件开始时间的当前时间
		const startSeconds = framesToSeconds(timeline.start, fps);
		const endSeconds = framesToSeconds(timeline.end, fps);
		const currentSeconds = framesToSeconds(currentTime, fps);
		const relativeTime = Math.max(0, currentSeconds - startSeconds);
		const componentDuration = endSeconds - startSeconds;
		const totalFrames = animation.duration() * animation.fps();

		// 如果超出结束时间，根据是否循环决定
		if (relativeTime > componentDuration) {
			if (loop) {
				// 循环播放：取模
				const loopedTime = relativeTime % componentDuration;
				const frame = (loopedTime * animation.fps() * speed) % totalFrames;
				return Math.floor(frame);
			} else {
				// 不循环：停留在最后一帧
				return Math.floor(totalFrames - 1);
			}
		}

		// 正常播放：根据时间和速度计算帧数
		const frame = relativeTime * animation.fps() * speed;
		// 确保帧数在有效范围内
		if (loop) {
			return Math.floor(frame % totalFrames);
		} else {
			return Math.min(Math.floor(frame), totalFrames - 1);
		}
	}, [animation, currentTime, timeline, speed, loop, fps]);

	const currentFrame = animation ? getCurrentFrame() : 0;

	// 如果不在可见时间范围内，不渲染
	if (
		timeline &&
		(currentTime < timeline.start || currentTime > timeline.end)
	) {
		return null;
	}

	// 如果正在加载或出错，显示占位符
	if (isLoading || hasError || !animation) {
		return (
			<Group>
				<Rect
					x={x}
					y={y}
					width={width}
					height={height}
					transform={[{ rotate: rotate ?? 0 }]}
					origin={{ x, y }}
					color={hasError ? "rgba(255, 0, 0, 0.3)" : "transparent"}
				/>
			</Group>
		);
	}

	// 获取动画的原始尺寸
	const animationSize = animation.size();
	const animationWidth = animationSize.width;
	const animationHeight = animationSize.height;

	// 计算缩放比例以适应目标尺寸
	const scaleX = width / animationWidth;
	const scaleY = height / animationHeight;
	const scale = Math.min(scaleX, scaleY); // 保持宽高比

	// 计算居中偏移
	const scaledWidth = animationWidth * scale;
	const scaledHeight = animationHeight * scale;
	const offsetX = (width - scaledWidth) / 2;
	const offsetY = (height - scaledHeight) / 2;

	return (
		<Group>
			<Rect
				x={x}
				y={y}
				width={width}
				height={height}
				transform={[{ rotate: rotate ?? 0 }]}
				color="transparent"
				origin={{ x, y }}
			>
				<Group
					transform={[
						{ translateX: x + offsetX },
						{ translateY: y + offsetY },
						{ scale },
					]}
				>
					<Skottie animation={animation} frame={currentFrame} />
				</Group>
			</Rect>
		</Group>
	);
};

export default Lottie;
