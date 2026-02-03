import React, { useMemo } from "react";
import { Fill, Group, Rect, Shader, Skia } from "react-skia-lite";
import { useFps, useRenderTime, useTimelineStore } from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import { parseStartEndSchema } from "../startEndSchema";
import { useRenderLayout } from "../useRenderLayout";
import type { SeaWaveInternal, SeaWaveProps } from "./model";

interface SeaWaveRendererProps extends SeaWaveProps {
	id: string;
}

const useSeaWaveSelector =
	createModelSelector<SeaWaveProps, SeaWaveInternal>();

const SeaWaveRenderer: React.FC<SeaWaveRendererProps> = ({
	id,
}) => {
	const currentTime = useRenderTime();
	const { fps } = useFps();

	// 直接从 TimelineStore 读取元素的 timeline 数据（用于计算相对时间）
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
	);

	// 获取渲染布局信息（位置、尺寸、旋转）
	const {
		cx,
		cy,
		w: width,
		h: height,
		rotation: rotate = 0,
	} = useRenderLayout(id);
	const x = cx - width / 2;
	const y = cy - height / 2;

	// 订阅 Model 状态
	const props = useSeaWaveSelector(id, (state) => state.props);
	const shaderSource = useSeaWaveSelector(
		id,
		(state) => state.internal.shaderSource,
	);
	const hasError = useSeaWaveSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);

	const {
		speed = 1.0,
		amplitude = 1.0,
		frequency = 2.0,
		waveColor = "#1e3a8a",
		foamColor = "#ffffff",
		deepWaterColor = "#0f172a",
	} = props;

	// 计算相对于组件开始时间的运行时间
	const start = parseStartEndSchema(timeline?.start ?? 0, fps);
	const relativeFrames = Math.max(0, currentTime - start);
	const relativeTime = framesToSeconds(relativeFrames, fps) * speed;

	// 解析十六进制颜色为 RGB (0-1)
	const parseColor = (color: string) => {
		const hex = color.replace("#", "");
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		return { r, g, b };
	};

	const wave = parseColor(waveColor);
	const foam = parseColor(foamColor);
	const deep = parseColor(deepWaterColor);

	// 创建裁剪矩形路径
	const clipPath = useMemo(() => {
		const path = Skia.Path.Make();
		path.addRect({ x, y, width, height });
		return path;
	}, [x, y, width, height]);

	// 如果有错误或 shader 未准备好，渲染占位矩形
	if (hasError || !shaderSource) {
		return (
			<Group>
				<Rect
					x={x}
					y={y}
					width={width}
					height={height}
					color={hasError ? "#fee2e2" : waveColor}
					transform={[{ rotate }]}
				/>
			</Group>
		);
	}

	return (
		<Group clip={clipPath} transform={[{ rotate }]} origin={{ x, y }}>
			<Fill>
				<Shader
					source={shaderSource}
					uniforms={{
						iTime: relativeTime,
						iResolution: [width, height],
						amplitude,
						frequency,
						waveColor: [wave.r, wave.g, wave.b],
						foamColor: [foam.r, foam.g, foam.b],
						deepWaterColor: [deep.r, deep.g, deep.b],
					}}
				/>
			</Fill>
		</Group>
	);
};

export default SeaWaveRenderer;
