import type { TimelineElement } from "core/element/types";
import type Konva from "konva";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { transformMetaToRenderLayout } from "@/element/layout";
import type { PinchState } from "../contexts/PreviewProvider";
import type { CanvasConvertOptions } from "./utils";

// LabelLayer 组件：从 Konva 节点获取实际位置来显示 label
export interface LabelLayerProps {
	elements: TimelineElement[];
	selectedIds: string[];
	stageRef: React.RefObject<Konva.Stage | null>;
	groupProxyRef?: React.RefObject<Konva.Rect | null>;
	canvasConvertOptions: CanvasConvertOptions;
	offsetX: number;
	offsetY: number;
	zoomLevel: number;
	pinchState: PinchState;
	groupProxyBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
		rotation: number;
	} | null;
}

export const LabelLayer: React.FC<LabelLayerProps> = ({
	elements,
	selectedIds,
	stageRef,
	groupProxyRef,
	canvasConvertOptions,
	offsetX,
	offsetY,
	zoomLevel,
	pinchState,
	groupProxyBox,
}) => {
	const [labelPositions, setLabelPositions] = useState<
		Record<
			string,
			{
				screenX: number; // 屏幕坐标（用于定位）
				screenY: number;
				screenWidth: number; // 屏幕尺寸（用于计算 translateY）
				screenHeight: number;
				canvasWidth: number; // 画布尺寸（用于显示）
				canvasHeight: number;
				rotation: number;
			}
		>
	>({});

	// 更新 label 位置的函数
	const updateLabelPositions = useCallback(() => {
		const stage = stageRef.current;
		// 计算有效缩放比例（在回调内部计算，避免依赖问题）
		const effectiveZoom = pinchState.isPinching
			? pinchState.currentZoom
			: zoomLevel;

		const positions: Record<
			string,
			{
				screenX: number;
				screenY: number;
				screenWidth: number;
				screenHeight: number;
				canvasWidth: number;
				canvasHeight: number;
				rotation: number;
			}
		> = {};

		if (selectedIds.length > 1) {
			const groupNode = groupProxyRef?.current;
			if (groupNode && groupNode.width() > 0 && groupNode.height() > 0) {
				const absoluteMatrix = groupNode.getAbsoluteTransform().copy();
				const origin = absoluteMatrix.point({ x: 0, y: 0 });
				const xAxisEnd = absoluteMatrix.point({ x: groupNode.width(), y: 0 });
				const yAxisEnd = absoluteMatrix.point({ x: 0, y: groupNode.height() });
				const center = absoluteMatrix.point({
					x: groupNode.width() / 2,
					y: groupNode.height() / 2,
				});
				const screenWidth = Math.hypot(
					xAxisEnd.x - origin.x,
					xAxisEnd.y - origin.y,
				);
				const screenHeight = Math.hypot(
					yAxisEnd.x - origin.x,
					yAxisEnd.y - origin.y,
				);
				const rotation = absoluteMatrix.decompose().rotation;
				positions["group-selection"] = {
					screenX: center.x,
					screenY: center.y,
					screenWidth,
					screenHeight,
					canvasWidth: screenWidth / effectiveZoom,
					canvasHeight: screenHeight / effectiveZoom,
					rotation,
				};
			} else if (
				groupProxyBox &&
				groupProxyBox.width > 0 &&
				groupProxyBox.height > 0
			) {
				// 回退到缓存框，避免 group node 尚未挂载时 label 消失
				positions["group-selection"] = {
					screenX: groupProxyBox.x,
					screenY: groupProxyBox.y,
					screenWidth: groupProxyBox.width,
					screenHeight: groupProxyBox.height,
					canvasWidth: groupProxyBox.width / effectiveZoom,
					canvasHeight: groupProxyBox.height / effectiveZoom,
					rotation: groupProxyBox.rotation,
				};
			}
			setLabelPositions(positions);
			return;
		}

		elements.forEach((el) => {
			if (!selectedIds.length) return;
			if (!selectedIds.includes(el.id)) return;

			const node = stage?.findOne(`.element-${el.id}`) as
				| Konva.Node
				| undefined;

			if (!node) {
				if (!el.transform) return;
				// 如果找不到节点，基于元素中心点与尺寸回退
				const renderLayout = transformMetaToRenderLayout(
					el.transform,
					canvasConvertOptions.picture,
					canvasConvertOptions.canvas,
				);
				const screenX = renderLayout.cx * effectiveZoom + offsetX;
				const screenY = renderLayout.cy * effectiveZoom + offsetY;
				const screenWidth = renderLayout.w * effectiveZoom;
				const screenHeight = renderLayout.h * effectiveZoom;

				positions[el.id] = {
					screenX,
					screenY,
					screenWidth,
					screenHeight,
					canvasWidth: renderLayout.w,
					canvasHeight: renderLayout.h,
					rotation: (renderLayout.rotation * 180) / Math.PI,
				};
				return;
			}

			// 从 Konva 节点矩阵获取实际中心点、尺寸与旋转
			const absoluteMatrix = node.getAbsoluteTransform().copy();
			const origin = absoluteMatrix.point({ x: 0, y: 0 });
			const xAxisEnd = absoluteMatrix.point({ x: node.width(), y: 0 });
			const yAxisEnd = absoluteMatrix.point({ x: 0, y: node.height() });
			const center = absoluteMatrix.point({
				x: node.width() / 2,
				y: node.height() / 2,
			});
			const stageWidth = Math.hypot(
				xAxisEnd.x - origin.x,
				xAxisEnd.y - origin.y,
			);
			const stageHeight = Math.hypot(
				yAxisEnd.x - origin.x,
				yAxisEnd.y - origin.y,
			);
			const rotation = absoluteMatrix.decompose().rotation;

			// 画布尺寸（用于显示）
			const canvasWidth = stageWidth / effectiveZoom;
			const canvasHeight = stageHeight / effectiveZoom;

			positions[el.id] = {
				screenX: center.x,
				screenY: center.y,
				screenWidth: stageWidth,
				screenHeight: stageHeight,
				canvasWidth,
				canvasHeight,
				rotation,
			};
		});

		setLabelPositions(positions);
	}, [
		elements,
		selectedIds,
		stageRef,
		groupProxyRef,
		canvasConvertOptions,
		pinchState,
		zoomLevel,
		offsetX,
		offsetY,
		groupProxyBox,
	]);

	useEffect(() => {
		updateLabelPositions();
	}, [updateLabelPositions]);

	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				pointerEvents: "none",
			}}
		>
			{Object.entries(labelPositions).map(([id, position]) => {
				if (!position) return null;

				// 使用屏幕尺寸计算 translateY
				let translateY = 0;
				if (
					Math.abs(position.rotation % 180) > 45 &&
					Math.abs(position.rotation % 180) < 135
				) {
					translateY = position.screenWidth / 2 + 20;
				} else {
					translateY = position.screenHeight / 2 + 20;
				}

				let normalizedRotation = position.rotation % 90;
				if (position.rotation % 90 > 45) {
					normalizedRotation -= 90 * Math.ceil(normalizedRotation / 90);
				} else if (position.rotation % 90 < -45) {
					normalizedRotation -= 90 * Math.floor(normalizedRotation / 90);
				}

				return (
					<div
						key={id}
						className="absolute text-red-500 bg-black/80 border border-red-500/70 max-w-32 truncate font-medium backdrop-blur-sm backdrop-saturate-150 px-3 py-1 -top-8 rounded-full text-xs whitespace-nowrap pointer-events-none"
						style={{
							left: position.screenX,
							top: position.screenY,
							transform: `translate(-50%, -50%) rotate(${normalizedRotation}deg) translateY(${translateY}px)`,
						}}
					>
						{Math.round(position.canvasWidth)} &times;{" "}
						{Math.round(position.canvasHeight)}
					</div>
				);
			})}
		</div>
	);
};
