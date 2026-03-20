import type React from "react";
import { useCallback, useDeferredValue, useEffect, useRef } from "react";
import {
	useDragging,
	usePlaybackControl,
	usePreviewAxis,
	usePreviewTime,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
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
	const deferredCurrentTime = useDeferredValue(currentTime);
	const { previewTime } = usePreviewTime();
	const deferredPreviewTime = useDeferredValue(previewTime);
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
		const currentX = leftOffset + deferredCurrentTime * ratio - scrollLeft;
		const arrowTopY = 2;
		const arrowHalfWidth = 4;
		const arrowNeckHalfWidth = 4;
		const arrowTipY = 20;
		const cornerRadius = 1.5; // 圆角半径

		// 绘制红线顶部的箭头（带圆角）
		ctx.strokeStyle = "#ef4444"; // red-500
		ctx.lineWidth = 1;
		ctx.lineJoin = "round"; // 线条连接处使用圆角
		ctx.lineCap = "round"; // 线条端点使用圆角
		ctx.beginPath();

		// 定义关键点
		const leftTopX = currentX - arrowHalfWidth;
		const rightTopX = currentX + arrowHalfWidth;
		const rightNeckX = currentX + arrowNeckHalfWidth;
		const leftNeckX = currentX - arrowNeckHalfWidth;
		const neckY = arrowTipY - 4;

		// 从左上角开始，使用圆角过渡
		ctx.moveTo(leftTopX + cornerRadius, arrowTopY);
		ctx.lineTo(rightTopX - cornerRadius, arrowTopY);
		ctx.quadraticCurveTo(
			rightTopX,
			arrowTopY,
			rightTopX,
			arrowTopY + cornerRadius,
		);

		// 右上角到右侧颈部
		ctx.lineTo(rightNeckX, neckY - cornerRadius);
		ctx.quadraticCurveTo(
			rightNeckX,
			neckY,
			rightNeckX - cornerRadius * 0.6,
			neckY,
		);

		// 右侧颈部到尖端
		ctx.lineTo(currentX + cornerRadius * 0.4, arrowTipY - cornerRadius);
		ctx.quadraticCurveTo(
			currentX,
			arrowTipY,
			currentX - cornerRadius * 0.4,
			arrowTipY - cornerRadius,
		);

		// 尖端到左侧颈部
		ctx.lineTo(leftNeckX + cornerRadius * 0.6, neckY);
		ctx.quadraticCurveTo(leftNeckX, neckY, leftNeckX, neckY - cornerRadius);

		// 左侧颈部到左上角
		ctx.lineTo(leftTopX, arrowTopY + cornerRadius);
		ctx.quadraticCurveTo(
			leftTopX,
			arrowTopY,
			leftTopX + cornerRadius,
			arrowTopY,
		);

		ctx.closePath();
		// 填充半透明红色
		ctx.fillStyle = "rgba(239, 68, 68, 0.3)"; // red-500 with 30% opacity
		ctx.fill();
		// 绘制边框
		ctx.stroke();

		// 绘制红色竖线（从箭头尖端开始）
		ctx.strokeStyle = "#ef4444"; // red-500
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(currentX, arrowTipY);
		ctx.lineTo(currentX, displayHeight);
		ctx.stroke();

		// 绘制蓝色竖线 - 预览时间（previewTime，如果存在且非播放/拖拽状态）
		if (
			previewAxisEnabled &&
			deferredPreviewTime !== null &&
			!isPlaying &&
			!isDragging
		) {
			const previewX = leftOffset + deferredPreviewTime * ratio - scrollLeft;
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
		deferredCurrentTime,
		deferredPreviewTime,
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
