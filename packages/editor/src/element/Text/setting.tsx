import { useId } from "react";
import type { ElementComponentSettingProps } from "../model/componentRegistry";
import type { TextAlignMode, TextProps } from "./model";

const clamp = (value: number, min: number, max: number): number => {
	return Math.min(max, Math.max(min, value));
};

const normalizeAlign = (value: string): TextAlignMode => {
	if (value === "center" || value === "right" || value === "left") {
		return value;
	}
	return "left";
};

const normalizeProps = (props: Partial<TextProps> | undefined) => {
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
	const text = typeof props?.text === "string" ? props.text : "新建文本";
	const textAlign = normalizeAlign(props?.textAlign ?? "left");
	return {
		text,
		fontSize,
		color,
		textAlign,
		lineHeight,
	};
};

export const TextSetting = ({
	element,
	updateProps,
}: ElementComponentSettingProps<TextProps>) => {
	const { text, fontSize, color, textAlign, lineHeight } = normalizeProps(
		element.props,
	);
	const contentId = useId();
	const sizeId = useId();
	const colorId = useId();
	const alignId = useId();
	const lineHeightId = useId();

	return (
		<div className="space-y-3">
			<div className="text-xs font-medium text-neutral-300">Text</div>
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
		</div>
	);
};
