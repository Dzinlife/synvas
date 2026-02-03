import { useMemo } from "react";
import { Fill, Group, Rect, Shader, Skia } from "react-skia-lite";
import { useFps, useRenderTime, useTimelineStore } from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import { createModelSelector } from "../model/registry";
import { parseStartEndSchema } from "../startEndSchema";
import { useRenderLayout } from "../useRenderLayout";
import type { CloudBackgroundInternal, CloudBackgroundProps } from "./model";

interface CloudBackgroundRendererProps extends CloudBackgroundProps {
	id: string;
}

const useCloudBackgroundSelector =
	createModelSelector<CloudBackgroundProps, CloudBackgroundInternal>();

const CloudBackgroundRenderer: React.FC<CloudBackgroundRendererProps> = ({
	id,
}) => {
	const currentTime = useRenderTime();
	const { fps } = useFps();

	// 直接从 TimelineStore 读取元素的 timeline 数据
	const timeline = useTimelineStore(
		(state) => state.getElementById(id)?.timeline,
	);

	const {
		cx,
		cy,
		w: width,
		h: height,
		rotation: rotate = 0,
	} = useRenderLayout(id);
	const x = cx - width / 2;
	const y = cy - height / 2;

	// 订阅状态
	const props = useCloudBackgroundSelector(id, (state) => state.props);
	const shaderSource = useCloudBackgroundSelector(
		id,
		(state) => state.internal.shaderSource,
	);
	const hasError = useCloudBackgroundSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);

	const {
		speed = 1.0,
		cloudDensity = 1.0,
		skyColor = "#87CEEB",
		cloudColor = "#FFFFFF",
	} = props;

	// 解析开始时间（从 __timeline 获取）
	const start = parseStartEndSchema(timeline?.start ?? 0, fps);
	const relativeFrames = Math.max(0, currentTime - start);
	const relativeTime = framesToSeconds(relativeFrames, fps) * speed;

	// 解析颜色
	const parseColor = (color: string) => {
		const hex = color.replace("#", "");
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		return { r, g, b };
	};

	const sky = parseColor(skyColor);
	const cloud = parseColor(cloudColor);

	// 创建裁剪路径
	const clipPath = useMemo(() => {
		const path = Skia.Path.Make();
		path.addRect({ x, y, width, height });
		return path;
	}, [x, y, width, height]);

	// Error 状态或 shader 未加载
	if (hasError || !shaderSource) {
		return (
			<Group>
				<Rect
					x={x}
					y={y}
					width={width}
					height={height}
					color={hasError ? "#fee2e2" : skyColor}
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
						cloudDensity,
						skyColor: [sky.r, sky.g, sky.b],
						cloudColor: [cloud.r, cloud.g, cloud.b],
					}}
				/>
			</Fill>
		</Group>
	);
};

export default CloudBackgroundRenderer;
