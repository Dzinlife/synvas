import type Konva from "konva";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
	renderLayoutToTopLeft,
	transformMetaToRenderLayout,
} from "@/dsl/layout";
import type { TimelineElement } from "@/dsl/types";
import type { PinchState } from "../contexts/PreviewProvider";
import type { CanvasConvertOptions } from "./utils";

// LabelLayer 组件：从 Konva 节点获取实际位置来显示 label
export interface LabelLayerProps {
	elements: TimelineElement[];
	selectedIds: string[];
	stageRef: React.RefObject<Konva.Stage | null>;
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
			if (
				groupProxyBox &&
				groupProxyBox.width > 0 &&
				groupProxyBox.height > 0
			) {
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
				// 如果找不到节点，使用 transform 计算的位置并转换到屏幕坐标
				const renderLayout = transformMetaToRenderLayout(
					el.transform,
					canvasConvertOptions.picture,
					canvasConvertOptions.canvas,
				);
				const { x, y, width, height } = renderLayoutToTopLeft(renderLayout);
				const screenX = x * effectiveZoom + offsetX;
				const screenY = y * effectiveZoom + offsetY;
				const screenWidth = width * effectiveZoom;
				const screenHeight = height * effectiveZoom;

				positions[el.id] = {
					screenX: screenX + screenWidth / 2,
					screenY: screenY + screenHeight / 2,
					screenWidth,
					screenHeight,
					canvasWidth: width,
					canvasHeight: height,
					rotation: 0,
				};
				return;
			}

			// 从 Konva 节点获取实际位置和尺寸（Stage/屏幕坐标系）
			const stageX = node.x();
			const stageY = node.y();
			const stageWidth = node.width() * node.scaleX();
			const stageHeight = node.height() * node.scaleY();
			const rotation = node.rotation();

			// 画布尺寸（用于显示）
			const canvasWidth = stageWidth / effectiveZoom;
			const canvasHeight = stageHeight / effectiveZoom;

			// 获取 offset
			const nodeOffsetX = node.offsetX() || 0;
			const nodeOffsetY = node.offsetY() || 0;

			// 计算旋转中心点 - Stage 坐标
			const rotationCenterX = stageX + nodeOffsetX;
			const rotationCenterY = stageY + nodeOffsetY;

			// 计算未旋转时中心点相对于旋转中心的偏移（Stage 尺寸）
			const centerOffsetX = stageWidth / 2 - nodeOffsetX;
			const centerOffsetY = stageHeight / 2 - nodeOffsetY;

			const rotationRad = (rotation * Math.PI) / 180;
			const cos = Math.cos(rotationRad);
			const sin = Math.sin(rotationRad);
			const rotatedCenterX =
				rotationCenterX + centerOffsetX * cos - centerOffsetY * sin;
			const rotatedCenterY =
				rotationCenterY + centerOffsetX * sin + centerOffsetY * cos;

			positions[el.id] = {
				screenX: rotatedCenterX,
				screenY: rotatedCenterY,
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
