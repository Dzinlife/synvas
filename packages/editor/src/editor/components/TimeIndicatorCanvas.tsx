import React, { useCallback, useEffect, useRef } from "react";
import {
	useDragging,
	usePlaybackControl,
	usePreviewAxis,
	usePreviewTime,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { cn } from "@/lib/utils";

interface CurrentTimeIndicatorCanvasProps {
	className?: string;
	leftOffset?: number;
	ratio: number;
	scrollLeft: number;
}

const CurrentTimeIndicatorCanvas: React.FC<CurrentTimeIndicatorCanvasProps> = ({
	className,
	leftOffset = 0,
	ratio,
	scrollLeft,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	// 直接从 store 获取固定时间，不受 previewTime 影响
	const currentTime = useTimelineStore((state) => state.currentTime);
	const { previewTime } = usePreviewTime();
	const { previewAxisEnabled } = usePreviewAxis();
	const { isPlaying } = usePlaybackControl();
	const { isDragging } = useDragging();

	// 绘制函数
	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// 获取画布的实际显示尺寸
		const rect = canvas.parentElement?.getBoundingClientRect();
		if (!rect) return;

		const displayHeight = rect.height;

		// 清空画布（使用实际像素尺寸）
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// 绘制红色竖线 - 固定时间（currentTime）
		const currentX = leftOffset + currentTime * ratio - scrollLeft;
		ctx.strokeStyle = "#ef4444"; // red-500
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(currentX, 0);
		ctx.lineTo(currentX, displayHeight);
		ctx.stroke();

		// 绘制蓝色竖线 - 预览时间（previewTime，如果存在且非播放/拖拽状态）
		if (previewAxisEnabled && previewTime !== null && !isPlaying && !isDragging) {
			const previewX = leftOffset + previewTime * ratio - scrollLeft;
			ctx.strokeStyle = "#3b82f6"; // blue-500
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]); // 虚线
			ctx.beginPath();
			ctx.moveTo(previewX, 0);
			ctx.lineTo(previewX, displayHeight);
			ctx.stroke();
			ctx.setLineDash([]); // 重置为实线
		}
	}, [
		leftOffset,
		ratio,
		scrollLeft,
		currentTime,
		previewTime,
		previewAxisEnabled,
		isPlaying,
		isDragging,
	]);

	// 当 currentTime、previewTime 或 scrollLeft 变化时重新绘制
	useEffect(() => {
		draw();
	}, [draw]);

	// 初始化画布大小并监听尺寸变化
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const resizeObserver = new ResizeObserver(() => {
			const rect = canvas.parentElement?.getBoundingClientRect();
			if (rect) {
				const dpr = window.devicePixelRatio || 1;
				canvas.width = rect.width * dpr;
				canvas.height = rect.height * dpr;
				canvas.style.width = `${rect.width}px`;
				canvas.style.height = `${rect.height}px`;
				const ctx = canvas.getContext("2d");
				if (ctx) {
					// 重置 transform 并应用 scale
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					ctx.scale(dpr, dpr);
				}
				draw();
			}
		});

		const container = canvas.parentElement;
		if (container) {
			resizeObserver.observe(container);
		}

		return () => {
			resizeObserver.disconnect();
		};
	}, [draw]);

	return (
		<canvas
			ref={canvasRef}
			className={cn(
				"absolute top-0 left-0 w-full h-full pointer-events-none",
				className,
			)}
		/>
	);
};

export default CurrentTimeIndicatorCanvas;
