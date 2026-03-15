import { useId } from "react";
import type { ElementComponentSettingProps } from "../model/componentRegistry";
import type { FancyTextProps, TextAlignMode } from "./model";

const clamp = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const normalizeAlign = (value: string): TextAlignMode => {
	if (value === "center" || value === "right" || value === "left") {
		return value;
	}
	return "left";
};

const normalizeProps = (props: Partial<FancyTextProps> | undefined) => {
	const fontSize =
		typeof props?.fontSize === "number" && Number.isFinite(props.fontSize)
			? clamp(Math.round(props.fontSize), 8, 512)
			: 48;
	const lineHeight =
		typeof props?.lineHeight === "number" && Number.isFinite(props.lineHeight)
			? clamp(props.lineHeight, 0.5, 4)
			: 1.2;
	const color =
		typeof props?.color === "string" && props.color.trim()
			? props.color
			: "#FFFFFF";
	const waveRadius =
		typeof props?.waveRadius === "number" && Number.isFinite(props.waveRadius)
			? clamp(props.waveRadius, 4, 512)
			: fontSize;
	const waveTranslateY =
		typeof props?.waveTranslateY === "number" &&
		Number.isFinite(props.waveTranslateY)
			? clamp(props.waveTranslateY, 0, 128)
			: 8;
	const waveScale =
		typeof props?.waveScale === "number" && Number.isFinite(props.waveScale)
			? clamp(props.waveScale, 0, 1)
			: 0.16;
	const text = typeof props?.text === "string" ? props.text : "花字演示";
	const textAlign = normalizeAlign(props?.textAlign ?? "left");
	const locale =
		typeof props?.locale === "string" && props.locale.trim()
			? props.locale.trim()
			: "zh-CN";
	return {
		text,
		fontSize,
		color,
		textAlign,
		lineHeight,
		locale,
		waveRadius,
		waveTranslateY,
		waveScale,
	};
};

export const FancyTextSetting = ({
	element,
	updateProps,
}: ElementComponentSettingProps<FancyTextProps>) => {
	const {
		text,
		fontSize,
		color,
		textAlign,
		lineHeight,
		locale,
		waveRadius,
		waveTranslateY,
		waveScale,
	} = normalizeProps(element.props);
	const contentId = useId();
	const sizeId = useId();
	const colorId = useId();
	const alignId = useId();
	const lineHeightId = useId();
	const localeId = useId();
	const waveRadiusId = useId();
	const waveTranslateYId = useId();
	const waveScaleId = useId();

	return (
		<div className="space-y-3">
			<div className="text-xs font-medium text-neutral-300">Fancy Text</div>
			<div className="space-y-2">
				<label className="block text-xs text-neutral-400" htmlFor={contentId}>
					Content
				</label>
				<textarea
					id={contentId}
					className="min-h-20 w-full rounded-md border border-white/10 bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
					value={text}
					onChange={(event) => {
						updateProps({ text: event.target.value });
					}}
				/>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400" htmlFor={sizeId}>
						Font Size
					</label>
					<input
						id={sizeId}
						type="number"
						min={8}
						max={512}
						step={1}
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={fontSize}
						onChange={(event) => {
							const nextValue = Number(event.target.value);
							if (!Number.isFinite(nextValue)) return;
							updateProps({
								fontSize: clamp(Math.round(nextValue), 8, 512),
							});
						}}
					/>
				</div>

				<div className="space-y-1">
					<label className="block text-xs text-neutral-400" htmlFor={colorId}>
						Color
					</label>
					<input
						id={colorId}
						type="color"
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-1"
						value={color}
						onChange={(event) => {
							updateProps({ color: event.target.value });
						}}
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400" htmlFor={alignId}>
						Align
					</label>
					<select
						id={alignId}
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={textAlign}
						onChange={(event) => {
							updateProps({
								textAlign: normalizeAlign(event.target.value),
							});
						}}
					>
						<option value="left">Left</option>
						<option value="center">Center</option>
						<option value="right">Right</option>
					</select>
				</div>

				<div className="space-y-1">
					<label
						className="block text-xs text-neutral-400"
						htmlFor={lineHeightId}
					>
						Line Height
					</label>
					<input
						id={lineHeightId}
						type="number"
						min={0.5}
						max={4}
						step={0.1}
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={lineHeight}
						onChange={(event) => {
							const nextValue = Number(event.target.value);
							if (!Number.isFinite(nextValue)) return;
							updateProps({
								lineHeight: Number(clamp(nextValue, 0.5, 4).toFixed(2)),
							});
						}}
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400" htmlFor={localeId}>
						Locale
					</label>
					<input
						id={localeId}
						type="text"
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={locale}
						onChange={(event) => {
							updateProps({ locale: event.target.value });
						}}
					/>
				</div>

				<div className="space-y-1">
					<label
						className="block text-xs text-neutral-400"
						htmlFor={waveRadiusId}
					>
						Wave Radius
					</label>
					<input
						id={waveRadiusId}
						type="number"
						min={4}
						max={512}
						step={1}
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={waveRadius}
						onChange={(event) => {
							const nextValue = Number(event.target.value);
							if (!Number.isFinite(nextValue)) return;
							updateProps({
								waveRadius: Number(clamp(nextValue, 4, 512).toFixed(1)),
							});
						}}
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1">
					<label
						className="block text-xs text-neutral-400"
						htmlFor={waveTranslateYId}
					>
						Wave Lift
					</label>
					<input
						id={waveTranslateYId}
						type="number"
						min={0}
						max={128}
						step={0.5}
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={waveTranslateY}
						onChange={(event) => {
							const nextValue = Number(event.target.value);
							if (!Number.isFinite(nextValue)) return;
							updateProps({
								waveTranslateY: Number(clamp(nextValue, 0, 128).toFixed(1)),
							});
						}}
					/>
				</div>

				<div className="space-y-1">
					<label
						className="block text-xs text-neutral-400"
						htmlFor={waveScaleId}
					>
						Wave Scale
					</label>
					<input
						id={waveScaleId}
						type="number"
						min={0}
						max={1}
						step={0.01}
						className="h-8 w-full rounded-md border border-white/10 bg-neutral-800 px-2 text-xs text-neutral-100"
						value={waveScale}
						onChange={(event) => {
							const nextValue = Number(event.target.value);
							if (!Number.isFinite(nextValue)) return;
							updateProps({
								waveScale: Number(clamp(nextValue, 0, 1).toFixed(2)),
							});
						}}
					/>
				</div>
			</div>
		</div>
	);
};
