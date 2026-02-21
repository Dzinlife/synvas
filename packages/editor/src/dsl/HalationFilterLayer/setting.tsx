import { DialSlider } from "@/components/ui/dial-slider";
import type { DSLComponentSettingProps } from "../model/componentRegistry";
import {
	HALATION_FILTER_DEFAULT_PROPS,
	type HalationFilterLayerProps,
} from "./model";

const clampNumber = (value: number, min: number, max: number): number => {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
};

const resolveNumber = (
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return clampNumber(fallback, min, max);
	}
	return clampNumber(value, min, max);
};

interface NumberControlProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}

const NumberControl: React.FC<NumberControlProps> = ({
	label,
	value,
	min,
	max,
	step,
	onChange,
}) => {
	return (
		<div className="py-0.5">
			<DialSlider
				label={label}
				value={value}
				onChange={onChange}
				min={min}
				max={max}
				step={step}
			/>
		</div>
	);
};

export const HalationFilterLayerSetting: React.FC<
	DSLComponentSettingProps<HalationFilterLayerProps>
> = ({ element, updateProps }) => {
	const intensity = resolveNumber(
		element.props.intensity,
		HALATION_FILTER_DEFAULT_PROPS.intensity,
		0,
		2,
	);
	const threshold = resolveNumber(
		element.props.threshold,
		HALATION_FILTER_DEFAULT_PROPS.threshold,
		0,
		1,
	);
	const radius = resolveNumber(
		element.props.radius,
		HALATION_FILTER_DEFAULT_PROPS.radius,
		0,
		64,
	);
	const diffusion = resolveNumber(
		element.props.diffusion,
		HALATION_FILTER_DEFAULT_PROPS.diffusion,
		0,
		1,
	);
	const warmness = resolveNumber(
		element.props.warmness,
		HALATION_FILTER_DEFAULT_PROPS.warmness,
		0,
		1,
	);
	const chromaticShift = resolveNumber(
		element.props.chromaticShift,
		HALATION_FILTER_DEFAULT_PROPS.chromaticShift,
		0,
		8,
	);

	const setNumberProp = (
		key: keyof HalationFilterLayerProps,
		value: number,
		min: number,
		max: number,
	) => {
		updateProps({
			[key]: clampNumber(value, min, max),
		} as Partial<HalationFilterLayerProps>);
	};

	return (
		<div className="space-y-3 pt-2 border-t border-white/10">
			<div className="text-xs font-medium text-neutral-300">Halation</div>

			<NumberControl
				label="Intensity"
				value={intensity}
				min={0}
				max={2}
				step={0.01}
				onChange={(value) => {
					setNumberProp("intensity", value, 0, 2);
				}}
			/>

			<NumberControl
				label="Threshold"
				value={threshold}
				min={0}
				max={1}
				step={0.01}
				onChange={(value) => {
					setNumberProp("threshold", value, 0, 1);
				}}
			/>

			<NumberControl
				label="Radius"
				value={radius}
				min={0}
				max={64}
				step={0.1}
				onChange={(value) => {
					setNumberProp("radius", value, 0, 64);
				}}
			/>

			<NumberControl
				label="Diffusion"
				value={diffusion}
				min={0}
				max={1}
				step={0.01}
				onChange={(value) => {
					setNumberProp("diffusion", value, 0, 1);
				}}
			/>

			<NumberControl
				label="Warmness"
				value={warmness}
				min={0}
				max={1}
				step={0.01}
				onChange={(value) => {
					setNumberProp("warmness", value, 0, 1);
				}}
			/>

			<NumberControl
				label="Chromatic Shift"
				value={chromaticShift}
				min={0}
				max={8}
				step={0.1}
				onChange={(value) => {
					setNumberProp("chromaticShift", value, 0, 8);
				}}
			/>
		</div>
	);
};
