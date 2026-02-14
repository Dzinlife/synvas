"use client";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const resolveStep = (step: number | undefined): number => {
	if (typeof step !== "number" || !Number.isFinite(step) || step <= 0) {
		return 1;
	}
	return step;
};

const resolvePixelSensitivity = (pixelSensitivity: number | undefined): number => {
	if (
		typeof pixelSensitivity !== "number" ||
		!Number.isFinite(pixelSensitivity) ||
		pixelSensitivity <= 0
	) {
		return 2;
	}
	return pixelSensitivity;
};

const clampValue = (value: number, min?: number, max?: number): number => {
	let next = value;
	if (typeof min === "number") {
		next = Math.max(min, next);
	}
	if (typeof max === "number") {
		next = Math.min(max, next);
	}
	return next;
};

export interface ScrubbableNumberInputProps {
	id?: string;
	ariaLabel: string;
	label: string;
	value: number;
	format?: Intl.NumberFormatOptions;
	onValueChange: (value: number) => void;
	onScrubStart?: () => void;
	onScrubEnd?: (didChange: boolean) => void;
	step?: number;
	min?: number;
	max?: number;
	disabled?: boolean;
	className?: string;
	pixelSensitivity?: number;
}

export function ScrubbableNumberInput({
	id,
	ariaLabel,
	label,
	value,
	format,
	onValueChange,
	onScrubStart,
	onScrubEnd,
	step = 1,
	min,
	max,
	disabled = false,
	className,
	pixelSensitivity = 2,
}: ScrubbableNumberInputProps) {
	const safeStep = resolveStep(step);
	const safePixelSensitivity = resolvePixelSensitivity(pixelSensitivity);
	const visibleInputRef = useRef<HTMLInputElement | null>(null);
	const valueRef = useRef(value);
	const isDraggingRef = useRef(false);
	const didChangeDuringScrubRef = useRef(false);
	const shouldBlurOnScrubEndRef = useRef(false);
	const remainderRef = useRef(0);
	const lastClientXRef = useRef<number | null>(null);

	useEffect(() => {
		valueRef.current = value;
	}, [value]);

	const endScrub = () => {
		const wasDragging = isDraggingRef.current;
		const didChangeDuringScrub = didChangeDuringScrubRef.current;
		isDraggingRef.current = false;
		lastClientXRef.current = null;
		remainderRef.current = 0;
		didChangeDuringScrubRef.current = false;

		// 仅在 Scrub 前不是 focus 的场景下，结束后主动还原焦点状态。
		if (wasDragging && shouldBlurOnScrubEndRef.current) {
			visibleInputRef.current?.blur();
		}
		shouldBlurOnScrubEndRef.current = false;
		onScrubEnd?.(didChangeDuringScrub);
	};

	return (
		<NumberFieldPrimitive.Root
			id={id}
			value={value}
			format={format}
			onValueChange={(nextValue, eventDetails) => {
				if (typeof nextValue !== "number" || !Number.isFinite(nextValue))
					return;

				// 输入文本时延迟到 Enter/blur 再提交，避免小数输入中途抖动。
				if (eventDetails.reason === "input-change") return;
				if (eventDetails.reason === "input-paste") return;
				if (eventDetails.reason === "input-clear") return;

				valueRef.current = nextValue;
				onValueChange(nextValue);
			}}
			onValueCommitted={(nextValue, eventDetails) => {
				if (eventDetails.reason !== "input-blur") return;
				if (typeof nextValue !== "number" || !Number.isFinite(nextValue))
					return;
				valueRef.current = nextValue;
				onValueChange(nextValue);
			}}
			step={safeStep}
			smallStep={safeStep / 10}
			largeStep={safeStep * 10}
			min={min}
			max={max}
			disabled={disabled}
			className={cn(
				"flex h-8 w-full items-center gap-3 rounded-lg border border-white/6 bg-neutral-800/90 px-3 transition-colors focus-within:border-white/20",
				"data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
		>
			<span
				role="button"
				tabIndex={disabled ? -1 : 0}
				aria-label={`${ariaLabel} drag handle`}
				style={{ touchAction: "none" }}
				className="cursor-ew-resize select-none text-sm text-neutral-400"
				onPointerDown={(event) => {
					const isMainButton = event.button === 0;
					if (disabled || !isMainButton) return;
					event.preventDefault();

					const inputElement = visibleInputRef.current;
					const wasFocused = inputElement === document.activeElement;
					shouldBlurOnScrubEndRef.current = !wasFocused;
					inputElement?.focus();

					isDraggingRef.current = true;
					didChangeDuringScrubRef.current = false;
					remainderRef.current = 0;
					lastClientXRef.current = event.clientX;
					if (typeof event.currentTarget.setPointerCapture === "function") {
						event.currentTarget.setPointerCapture(event.pointerId);
					}
				}}
				onPointerMove={(event) => {
					if (!isDraggingRef.current || disabled) return;
					event.preventDefault();

					const previousClientX = lastClientXRef.current;
					lastClientXRef.current = event.clientX;
					if (previousClientX === null) return;

					remainderRef.current += event.clientX - previousClientX;
					const stepCount = Math.trunc(remainderRef.current / safePixelSensitivity);
					if (stepCount === 0) return;
					remainderRef.current -= stepCount * safePixelSensitivity;

					const nextValue = clampValue(
						valueRef.current + stepCount * safeStep,
						min,
						max,
					);
					if (nextValue === valueRef.current) return;
					valueRef.current = nextValue;
					if (!didChangeDuringScrubRef.current) {
						didChangeDuringScrubRef.current = true;
						onScrubStart?.();
					}
					onValueChange(nextValue);
				}}
				onPointerUp={(event) => {
					if (
						typeof event.currentTarget.hasPointerCapture === "function" &&
						typeof event.currentTarget.releasePointerCapture === "function" &&
						event.currentTarget.hasPointerCapture(event.pointerId)
					) {
						event.currentTarget.releasePointerCapture(event.pointerId);
					}
					endScrub();
				}}
				onPointerCancel={(event) => {
					if (
						typeof event.currentTarget.hasPointerCapture === "function" &&
						typeof event.currentTarget.releasePointerCapture === "function" &&
						event.currentTarget.hasPointerCapture(event.pointerId)
					) {
						event.currentTarget.releasePointerCapture(event.pointerId);
					}
					endScrub();
				}}
			>
				{label}
			</span>
				<NumberFieldPrimitive.Input
					ref={visibleInputRef}
					aria-label={ariaLabel}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					if (event.nativeEvent.isComposing) return;
					event.preventDefault();
					event.currentTarget.blur();
				}}
					className={cn(
						"w-full min-w-0 border-0 bg-transparent p-0 text-left text-sm font-medium tabular-nums text-white",
						"focus:outline-none",
					)}
				/>
			</NumberFieldPrimitive.Root>
		);
}
