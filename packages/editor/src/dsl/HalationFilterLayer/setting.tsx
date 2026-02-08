import { Input } from "@/components/ui/input";
import {
	NumberField,
	NumberFieldDecrement,
	NumberFieldGroup,
	NumberFieldIncrement,
	NumberFieldInput,
} from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
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

const getStepPrecision = (step: number): number => {
	const stepText = step.toString();
	const dotIndex = stepText.indexOf(".");
	if (dotIndex < 0) return 0;
	return stepText.length - dotIndex - 1;
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
	// const precision = getStepPrecision(step);

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-xs text-neutral-400">
				<span>{label}</span>
				{/* <span className="tabular-nums">{value.toFixed(precision)}</span> */}
			</div>
			<div className="flex items-center gap-2">
				<Slider
					aria-label={`${label} slider`}
					min={min}
					max={max}
					step={step}
					value={[value]}
					onValueChange={(next) => {
						const nextValue = Array.isArray(next) ? next[0] : next;
						if (!Number.isFinite(nextValue)) return;
						onChange(nextValue);
					}}
					className="py-1 flex-1"
				/>
				<Input
					aria-label={`${label} input`}
					className="h-8 w-12 text-xs p-0 text-center"
					value={value.toString()}
					onChange={(e) => {
						onChange(Number(e.target.value));
					}}
				/>
			</div>
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
	const shape =
		element.props.shape === "circle" || element.props.shape === "rect"
			? element.props.shape
			: HALATION_FILTER_DEFAULT_PROPS.shape;
	const cornerRadiusMax = Math.max(
		0,
		Math.min(element.transform.width, element.transform.height) / 2,
	);
	const cornerRadius = resolveNumber(
		element.props.cornerRadius,
		HALATION_FILTER_DEFAULT_PROPS.cornerRadius,
		0,
		cornerRadiusMax,
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

			<div className="space-y-1.5">
				<div className="text-xs text-neutral-400">Shape</div>
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => {
							updateProps({ shape: "rect" });
						}}
						className={`rounded-md border px-2 py-1 text-xs transition-colors ${
							shape === "rect"
								? "border-blue-500 bg-blue-500/20 text-blue-300"
								: "border-white/10 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
						}`}
					>
						Rect
					</button>
					<button
						type="button"
						onClick={() => {
							updateProps({ shape: "circle" });
						}}
						className={`rounded-md border px-2 py-1 text-xs transition-colors ${
							shape === "circle"
								? "border-blue-500 bg-blue-500/20 text-blue-300"
								: "border-white/10 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
						}`}
					>
						Circle
					</button>
				</div>
			</div>

			{shape === "rect" && (
				<NumberControl
					label="Corner Radius"
					value={cornerRadius}
					min={0}
					max={cornerRadiusMax}
					step={1}
					onChange={(value) => {
						setNumberProp("cornerRadius", value, 0, cornerRadiusMax);
					}}
				/>
			)}
		</div>
	);
};
