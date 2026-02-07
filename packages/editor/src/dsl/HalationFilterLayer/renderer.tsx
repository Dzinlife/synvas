import { useMemo } from "react";
import {
	BackdropFilter,
	BlendMode,
	Group,
	ImageFilter,
	type SkImageFilter,
	Skia,
	TileMode,
} from "react-skia-lite";
import { useRenderLayout } from "../useRenderLayout";
import type { HalationFilterLayerProps } from "./model";

interface HalationFilterLayerRendererProps extends HalationFilterLayerProps {
	id: string;
}

interface HalationPassConfig {
	threshold: number;
	radius: number;
	warmness: number;
	highlightBoost: number;
	tintStrength: number;
	shiftX: number;
}

const clamp01 = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const clampNonNegative = (value: number, fallback = 0): number => {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(0, value);
};

// 高光提取：先把 RGB 压成亮度，再通过增益和偏移做“阈值门限”
const createHighlightExtractMatrix = (
	threshold: number,
	highlightBoost: number,
): number[] => {
	const t = clamp01(threshold);
	const boost = clampNonNegative(highlightBoost, 0.6);
	// 采用更平缓的增益，避免高阈值时直接把画面压成黑底
	const gain = 1.8 + boost * 2.4;
	const knee = Math.max(0, t - 0.5);
	const bias = -t * gain + knee * 0.35;
	const rw = 0.2126;
	const gw = 0.7152;
	const bw = 0.0722;

	return [
		rw * gain,
		gw * gain,
		bw * gain,
		0,
		bias,
		rw * gain,
		gw * gain,
		bw * gain,
		0,
		bias,
		rw * gain,
		gw * gain,
		bw * gain,
		0,
		bias,
		0,
		0,
		0,
		1,
		0,
	];
};

// 将提取到的高光重新染成红橙系，模拟胶片卤化层的暖色溢出
const createHalationTintMatrix = (
	warmness: number,
	tintStrength: number,
): number[] => {
	const warm = clamp01(warmness);
	const strength = clampNonNegative(tintStrength, 0);

	const red = (1.15 + warm * 0.95) * strength;
	const green = (0.22 + warm * 0.6) * strength;
	const blue = (0.04 + (1 - warm) * 0.1) * strength;

	const rr = red / 3;
	const gg = green / 3;
	const bb = blue / 3;

	return [rr, rr, rr, 0, 0, gg, gg, gg, 0, 0, bb, bb, bb, 0, 0, 0, 0, 0, 1, 0];
};

const createHalationPassFilter = ({
	threshold,
	radius,
	warmness,
	highlightBoost,
	tintStrength,
	shiftX,
}: HalationPassConfig): SkImageFilter => {
	// 先提取高光，再扩散，能减少暗部污染
	const highlightFilter = Skia.ImageFilter.MakeColorFilter(
		Skia.ColorFilter.MakeMatrix(
			createHighlightExtractMatrix(threshold, highlightBoost),
		),
		null,
	);
	const blurFilter = Skia.ImageFilter.MakeBlur(
		Math.max(0.1, radius),
		Math.max(0.1, radius),
		TileMode.Decal,
		highlightFilter,
		null,
	);
	const tintFilter = Skia.ImageFilter.MakeColorFilter(
		Skia.ColorFilter.MakeMatrix(
			createHalationTintMatrix(warmness, tintStrength),
		),
		blurFilter,
	);
	if (Math.abs(shiftX) <= 0.01) return tintFilter;
	return Skia.ImageFilter.MakeOffset(shiftX, 0, tintFilter, null);
};

const HalationFilterLayer: React.FC<HalationFilterLayerRendererProps> = ({
	id,
	intensity = 0.45,
	threshold = 0.78,
	radius = 8,
	diffusion = 0.55,
	warmness = 0.6,
	chromaticShift = 1.2,
	shape = "rect",
	cornerRadius = 0,
}) => {
	const renderLayout = useRenderLayout(id);
	const { cx, cy, w: width, h: height, rotation: rotate = 0 } = renderLayout;
	const x = cx - width / 2;
	const y = cy - height / 2;

	const safeIntensity = Math.min(2, clampNonNegative(intensity, 0.45));
	const safeThreshold = clamp01(threshold);
	const safeRadius = clampNonNegative(radius, 8);
	const safeDiffusion = clamp01(diffusion);
	const safeWarmness = clamp01(warmness);
	const safeShift = clampNonNegative(chromaticShift, 1.2);
	const globalMix = Math.min(1, safeIntensity * 0.85);

	const primaryFilter = useMemo(
		() =>
			createHalationPassFilter({
				threshold: safeThreshold,
				radius: safeRadius,
				warmness: safeWarmness,
				highlightBoost: 0.8 + safeIntensity * 1.6,
				tintStrength: safeIntensity * 0.65,
				shiftX: safeShift,
			}),
		[safeThreshold, safeRadius, safeWarmness, safeIntensity, safeShift],
	);

	const secondaryFilter = useMemo(
		() =>
			createHalationPassFilter({
				threshold: Math.max(0, safeThreshold - 0.1 - safeDiffusion * 0.08),
				radius: safeRadius * (1.7 + safeDiffusion * 1.2),
				warmness: Math.min(1, safeWarmness + 0.08),
				highlightBoost: 0.55 + safeIntensity * 1.1,
				tintStrength: safeIntensity * (0.22 + safeDiffusion * 0.2),
				shiftX: safeShift * (1.4 + safeDiffusion * 0.6),
			}),
		[
			safeThreshold,
			safeRadius,
			safeWarmness,
			safeDiffusion,
			safeIntensity,
			safeShift,
		],
	);

	// 把两层光晕先合成，再与原画 screen 混合，确保不会替代原画
	const finalFilter = useMemo(() => {
		const glow = Skia.ImageFilter.MakeBlend(
			BlendMode.Screen,
			primaryFilter,
			secondaryFilter,
			null,
		);
		return Skia.ImageFilter.MakeBlend(BlendMode.Screen, glow, null, null);
	}, [primaryFilter, secondaryFilter]);

	const clipPath = useMemo(() => {
		const path = Skia.Path.Make();
		if (shape === "circle") {
			const radius = Math.min(width, height) / 2;
			path.addCircle(x + width / 2, y + height / 2, radius);
			return path;
		}
		path.addRRect({
			rect: {
				x,
				y,
				width,
				height,
			},
			rx: cornerRadius,
			ry: cornerRadius,
		});
		return path;
	}, [shape, x, y, width, height, cornerRadius]);

	if (
		safeIntensity <= 0.001 ||
		safeRadius <= 0.001 ||
		width <= 0 ||
		height <= 0
	) {
		return <Group />;
	}

	return (
		<Group clip={clipPath} transform={[{ rotate }]} origin={{ x, y }}>
			<BackdropFilter
				opacity={globalMix}
				filter={<ImageFilter filter={finalFilter} />}
			/>
		</Group>
	);
};

export default HalationFilterLayer;
