import React, { useEffect, useRef } from "react";
import { framesToTimecode } from "@/utils/timecode";

interface TimelineRulerProps {
	scrollLeft: number;
	ratio: number;
	width: number;
	height?: number;
	fps?: number;
	paddingLeft?: number;
	className?: string;
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({
	scrollLeft,
	ratio,
	width,
	height = 24,
	fps = 30, // mock fps
	paddingLeft = 0,
	className,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// 设置 canvas 尺寸（考虑 DPR）
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.scale(dpr, dpr);

		// 清除画布
		ctx.clearRect(0, 0, width, height);

		// 配置绘制样式
		ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
		ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";

		ctx.font = "11px monospace";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";

		// 根据 ratio 计算主刻度间隔（帧）
		const { interval, useFrames } = calculateInterval(ratio, fps);

		// 计算可见范围（帧），考虑 paddingLeft
		const startFrame = (scrollLeft - paddingLeft) / ratio;
		const endFrame = (scrollLeft - paddingLeft + width) / ratio;

		if (useFrames) {
			// 帧模式：整数秒必须显示，帧刻度在整数秒之间显示
			const frameInterval = Math.max(1, Math.round(interval)); // 帧间隔（帧）
			const startSec = Math.floor(startFrame / fps);
			const endSec = Math.ceil(endFrame / fps);

			for (let sec = Math.max(0, startSec - 1); sec <= endSec + 1; sec++) {
				// 绘制整数秒刻度
				const secX = sec * fps * ratio - scrollLeft + paddingLeft;
				if (secX >= -50 && secX <= width + 50) {
					ctx.beginPath();
					ctx.moveTo(secX, height - 15);
					ctx.lineTo(secX, height);
					ctx.stroke();

					const label = framesToTimecode(sec * fps, fps);
					ctx.fillText(label, secX + 5, height / 2 + 2);
				}

				// 绘制该秒内的帧刻度
				for (let f = frameInterval; f < fps; f += frameInterval) {
					const frameX = (sec * fps + f) * ratio - scrollLeft + paddingLeft;

					if (frameX >= 0 && frameX <= width) {
						ctx.beginPath();
						ctx.moveTo(frameX, height - 4);
						ctx.lineTo(frameX, height);
						ctx.stroke();

						// 显示帧数
						const textWidth = ctx.measureText(`${f}f`).width;
						ctx.fillText(`${f}f`, frameX - textWidth / 2, height / 2 + 2);
					}
				}
			}
		} else {
			// 秒/分钟模式（基于帧）
			const framesPerSecond = Math.max(1, Math.round(fps));
			const startTime = Math.floor(startFrame / interval) * interval;
			const endTime = Math.ceil(endFrame / interval) * interval + interval;
			const isOneSecondInterval = interval === framesPerSecond;
			const labelPadding = 100;
			const minLabelPixelGap =
				ctx.measureText(framesToTimecode(0, fps)).width + labelPadding;
			const labelEvery = isOneSecondInterval
				? Math.max(1, Math.ceil(minLabelPixelGap / (interval * ratio)))
				: 1;

			// 绘制主刻度
			for (
				let time = Math.max(0, startTime);
				time <= endTime;
				time += interval
			) {
				const x = time * ratio - scrollLeft + paddingLeft;

				if (x < -50 || x > width + 50) continue;

				// 绘制主刻度线
				ctx.beginPath();
				ctx.moveTo(x, height - 15);
				ctx.lineTo(x, height);
				ctx.stroke();

				// 绘制时间文字（在刻度线右方）
				const tickIndex = Math.round(time / interval);
				if (!isOneSecondInterval || tickIndex % labelEvery === 0) {
					const label = framesToTimecode(Math.round(time), fps);
					ctx.fillText(label, x + 5, height / 2 + 2);
				}
			}

			// 绘制次刻度（在主刻度之间）
			const minorInterval = Math.max(1, Math.round(interval / 5));
			if (minorInterval * ratio >= 8) {
				for (
					let time = Math.max(0, startTime);
					time <= endTime;
					time += minorInterval
				) {
					if (time % interval === 0) continue;

					const x = time * ratio - scrollLeft + paddingLeft;
					if (x < 0 || x > width) continue;

					ctx.beginPath();
					ctx.moveTo(x, height - 5);
					ctx.lineTo(x, height);
					ctx.stroke();
				}
			}
		}
	}, [scrollLeft, ratio, width, height, fps, paddingLeft, dpr]);

	return (
		<canvas
			ref={canvasRef}
			className={className}
			style={{
				width,
				height,
			}}
		/>
	);
};

// 根据 ratio 计算合适的刻度间隔（帧）
function calculateInterval(
	ratio: number,
	fps: number,
): { interval: number; useFrames: boolean } {
	// ratio 是每帧对应的像素数
	// 目标：主刻度之间间隔 200-300 像素左右

	const targetPixelGap = 250;
	const rawInterval = targetPixelGap / ratio; // 帧

	// 可选的间隔值（帧级别 + 秒级别）
	const framesPerSecond = Math.max(1, Math.round(fps));
	const intervals = [
		1, // 1帧
		5, // 5帧
		10, // 10帧
		15, // 15帧
		framesPerSecond, // 1秒
		framesPerSecond * 5, // 5秒
		framesPerSecond * 10, // 10秒
		framesPerSecond * 15, // 15秒
		framesPerSecond * 30, // 30秒
		framesPerSecond * 60, // 1分钟
		framesPerSecond * 300, // 5分钟
		framesPerSecond * 600, // 10分钟
		framesPerSecond * 900, // 15分钟
		framesPerSecond * 1800, // 30分钟
		framesPerSecond * 3600, // 1小时
	];

	// 找到最接近目标的间隔
	let bestInterval = intervals[0];
	let bestDiff = Math.abs(intervals[0] - rawInterval);

	for (const interval of intervals) {
		const diff = Math.abs(interval - rawInterval);
		if (diff < bestDiff) {
			bestDiff = diff;
			bestInterval = interval;
		}
	}

	// 判断是否使用帧单位（小于 1 秒）
	const useFrames = bestInterval < framesPerSecond;

	return { interval: bestInterval, useFrames };
}

export default TimelineRuler;
