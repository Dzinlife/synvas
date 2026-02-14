"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

export interface DialSliderProps {
	label: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
}

const CLICK_THRESHOLD = 3;
const DEAD_ZONE = 32;
const MAX_CURSOR_RANGE = 200;
const MAX_STRETCH = 8;

function roundValue(val: number, step: number): number {
	const decimals = step >= 1 ? 0 : 2;
	const factor = 10 ** decimals;
	return Math.round(val * factor) / factor;
}

function snapToDecile(rawValue: number, min: number, max: number): number {
	if (max === min) return min;
	const normalized = (rawValue - min) / (max - min);
	const nearest = Math.round(normalized * 10) / 10;
	if (Math.abs(normalized - nearest) <= 0.03125) {
		return min + nearest * (max - min);
	}
	return rawValue;
}

function formatDisplayValue(value: number, step: number): string {
	return step >= 1 ? value.toFixed(0) : value.toFixed(2);
}

export function DialSlider({
	label,
	value,
	onChange,
	min = 0,
	max = 1,
	step = 0.01,
	unit,
}: DialSliderProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const labelRef = useRef<HTMLSpanElement>(null);
	const valueButtonRef = useRef<HTMLButtonElement>(null);
	const [isInteracting, setIsInteracting] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [isHovered, setIsHovered] = useState(false);
	const [isValueHovered, setIsValueHovered] = useState(false);
	const [isValueEditable, setIsValueEditable] = useState(false);
	const [showInput, setShowInput] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// 点击与拖拽判定相关引用
	const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
	const isClickRef = useRef(true);
	const animRef = useRef<ReturnType<typeof animate> | null>(null);
	const wrapperRectRef = useRef<DOMRect | null>(null);
	const scaleRef = useRef(1);

	const percentage = max === min ? 0 : ((value - min) / (max - min)) * 100;
	const isActive = isInteracting || isHovered;

	// 用 motion value 驱动填充与手柄位置
	const fillPercent = useMotionValue(percentage);
	const fillWidth = useTransform(fillPercent, (pct) => `${pct}%`);
	const handleLeft = useTransform(
		fillPercent,
		(pct) => `max(5px, calc(${pct}% - 9px))`,
	);

	// 轨道越界时的橡皮筋效果
	const rubberStretchPx = useMotionValue(0);
	const rubberBandWidth = useTransform(
		rubberStretchPx,
		(stretch) => `calc(100% + ${Math.abs(stretch)}px)`,
	);
	const rubberBandX = useTransform(rubberStretchPx, (stretch) =>
		stretch < 0 ? stretch : 0,
	);

	// 非交互状态下与外部 value 同步
	useEffect(() => {
		if (!isInteracting && !animRef.current) {
			fillPercent.jump(percentage);
		}
	}, [percentage, isInteracting, fillPercent]);

	const positionToValue = useCallback(
		(clientX: number) => {
			const rect = wrapperRectRef.current;
			if (!rect) return value;
			const screenX = clientX - rect.left;
			const sceneX = screenX / scaleRef.current;
			const nativeWidth = wrapperRef.current
				? wrapperRef.current.offsetWidth
				: rect.width;
			if (nativeWidth <= 0 || max === min) return min;
			const percent = Math.max(0, Math.min(1, sceneX / nativeWidth));
			const rawValue = min + percent * (max - min);
			return Math.max(min, Math.min(max, rawValue));
		},
		[min, max, value],
	);

	const percentFromValue = useCallback(
		(v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100),
		[min, max],
	);

	const computeRubberStretch = useCallback((clientX: number, sign: number) => {
		const rect = wrapperRectRef.current;
		if (!rect) return 0;
		const distancePast = sign < 0 ? rect.left - clientX : clientX - rect.right;
		const overflow = Math.max(0, distancePast - DEAD_ZONE);
		return (
			sign * MAX_STRETCH * Math.sqrt(Math.min(overflow / MAX_CURSOR_RANGE, 1))
		);
	}, []);

	const handlePointerDown = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (showInput) return;
			e.preventDefault();
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			pointerDownPos.current = { x: e.clientX, y: e.clientY };
			isClickRef.current = true;
			setIsInteracting(true);

			// 指针按下瞬间缓存几何信息，避免拖拽时抖动
			if (wrapperRef.current) {
				wrapperRectRef.current = wrapperRef.current.getBoundingClientRect();
				const nativeWidth = Math.max(wrapperRef.current.offsetWidth, 1);
				scaleRef.current = wrapperRectRef.current.width / nativeWidth;
			}
		},
		[showInput],
	);

	const handlePointerMove = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (!isInteracting || !pointerDownPos.current) return;

			const dx = e.clientX - pointerDownPos.current.x;
			const dy = e.clientY - pointerDownPos.current.y;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (isClickRef.current && distance > CLICK_THRESHOLD) {
				isClickRef.current = false;
				setIsDragging(true);
			}

			if (!isClickRef.current) {
				const rect = wrapperRectRef.current;
				if (rect) {
					if (e.clientX < rect.left) {
						rubberStretchPx.jump(computeRubberStretch(e.clientX, -1));
					} else if (e.clientX > rect.right) {
						rubberStretchPx.jump(computeRubberStretch(e.clientX, 1));
					} else {
						rubberStretchPx.jump(0);
					}
				}

				const newValue = positionToValue(e.clientX);
				const newPct = percentFromValue(newValue);
				if (animRef.current) {
					animRef.current.stop();
					animRef.current = null;
				}
				fillPercent.jump(newPct);
				onChange(roundValue(newValue, step));
			}
		},
		[
			isInteracting,
			positionToValue,
			percentFromValue,
			onChange,
			step,
			fillPercent,
			rubberStretchPx,
			computeRubberStretch,
		],
	);

	const handlePointerUp = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (!isInteracting) return;

			if (isClickRef.current) {
				const rawValue = positionToValue(e.clientX);
				const snappedValue = snapToDecile(rawValue, min, max);
				const newPct = percentFromValue(snappedValue);

				if (animRef.current) {
					animRef.current.stop();
				}
				animRef.current = animate(fillPercent, newPct, {
					type: "spring",
					stiffness: 300,
					damping: 25,
					mass: 0.8,
					onComplete: () => {
						animRef.current = null;
					},
				});
				onChange(roundValue(snappedValue, step));
			}

			if (rubberStretchPx.get() !== 0) {
				animate(rubberStretchPx, 0, {
					type: "spring",
					visualDuration: 0.35,
					bounce: 0.15,
				});
			}

			setIsInteracting(false);
			setIsDragging(false);
			pointerDownPos.current = null;
		},
		[
			isInteracting,
			positionToValue,
			percentFromValue,
			onChange,
			min,
			max,
			step,
			fillPercent,
			rubberStretchPx,
		],
	);

	// 值文本悬停一段时间后进入可编辑状态
	useEffect(() => {
		if (isValueHovered && !showInput && !isValueEditable) {
			hoverTimeoutRef.current = setTimeout(() => {
				setIsValueEditable(true);
			}, 800);
		} else if (!isValueHovered && !showInput) {
			if (hoverTimeoutRef.current) {
				clearTimeout(hoverTimeoutRef.current);
				hoverTimeoutRef.current = null;
			}
			setIsValueEditable(false);
		}
		return () => {
			if (hoverTimeoutRef.current) {
				clearTimeout(hoverTimeoutRef.current);
			}
		};
	}, [isValueHovered, showInput, isValueEditable]);

	useEffect(() => {
		if (showInput && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [showInput]);

	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
	};

	const handleInputSubmit = () => {
		const parsed = Number.parseFloat(inputValue);
		if (!Number.isNaN(parsed)) {
			const clamped = Math.max(min, Math.min(max, parsed));
			onChange(roundValue(clamped, step));
		}
		setShowInput(false);
		setIsValueHovered(false);
		setIsValueEditable(false);
	};

	const handleValueClick = (e: MouseEvent<HTMLButtonElement>) => {
		if (!isValueEditable) return;
		e.stopPropagation();
		e.preventDefault();
		setShowInput(true);
		setInputValue(formatDisplayValue(value, step));
	};

	const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleInputSubmit();
		} else if (e.key === "Escape") {
			setShowInput(false);
			setIsValueHovered(false);
			setIsValueEditable(false);
		}
	};

	const handleInputBlur = () => {
		handleInputSubmit();
	};

	const displayValue = formatDisplayValue(value, step);
	const displayValueWithUnit = unit ? `${displayValue}${unit}` : displayValue;

	const HANDLE_BUFFER = 8;
	const LABEL_CSS_LEFT = 10;
	const VALUE_CSS_RIGHT = 10;
	let leftThreshold = 30;
	let rightThreshold = 78;
	const trackWidth = wrapperRef.current?.offsetWidth;
	if (trackWidth && trackWidth > 0) {
		if (labelRef.current) {
			leftThreshold =
				((LABEL_CSS_LEFT + labelRef.current.offsetWidth + HANDLE_BUFFER) /
					trackWidth) *
				100;
		}
		if (valueButtonRef.current) {
			rightThreshold =
				((trackWidth -
					VALUE_CSS_RIGHT -
					valueButtonRef.current.offsetWidth -
					HANDLE_BUFFER) /
					trackWidth) *
				100;
		}
	}

	const valueDodge = percentage < leftThreshold || percentage > rightThreshold;
	const handleOpacity = !isActive
		? 0
		: valueDodge
			? 0.1
			: isDragging
				? 0.9
				: 0.5;

	const fillBackground = isActive
		? "rgba(255, 255, 255, 0.15)"
		: "rgba(255, 255, 255, 0.11)";
	const hashMarkClassName = cn(
		"absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background] duration-200",
		isActive ? "bg-white/15" : "bg-white/0",
	);

	const hashMarks = Array.from({ length: 9 }, (_, i) => {
		const pct = (i + 1) * 10;
		return (
			<div
				key={`dial-slider-hashmark-${pct}`}
				className={hashMarkClassName}
				style={{ left: `${pct}%` }}
			/>
		);
	});

	return (
		<div ref={wrapperRef} className="relative h-9">
			<motion.div
				ref={trackRef}
				className="absolute top-0 left-0 h-full w-full cursor-pointer select-none overflow-hidden touch-none [background:var(--dial-surface,rgba(255,255,255,0.05))] [border-radius:var(--dial-radius,8px)]"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				style={{ width: rubberBandWidth, x: rubberBandX }}
			>
				<div className="pointer-events-none absolute inset-0">{hashMarks}</div>

				<motion.div
					className="pointer-events-none absolute top-0 bottom-0 left-0 transition-[background] duration-150"
					style={{
						background: fillBackground,
						width: fillWidth,
					}}
				/>

				<motion.div
					className="pointer-events-none absolute top-1/2 h-5 w-[3px] rounded-full bg-white/90"
					style={{
						left: handleLeft,
						y: "-50%",
					}}
					animate={{
						opacity: handleOpacity,
						scaleX: isActive ? 1 : 0.25,
						scaleY: isActive && valueDodge ? 0.75 : 1,
					}}
					transition={{
						scaleX: { type: "spring", visualDuration: 0.25, bounce: 0.15 },
						scaleY: { type: "spring", visualDuration: 0.2, bounce: 0.1 },
						opacity: { duration: 0.15 },
					}}
				/>

				<span
					ref={labelRef}
					className="pointer-events-none absolute top-1/2 left-[10px] translate-y-[calc(-50%-0.5px)] text-[13px] font-medium [color:var(--dial-text-label,rgba(255,255,255,0.7))] transition-[color] duration-150"
				>
					{label}
				</span>

				{showInput ? (
					<input
						ref={inputRef}
						type="text"
						className="absolute top-1/2 right-[10px] w-[4ch] min-w-[3ch] max-w-[6ch] -translate-y-1/2 border-0 border-b [border-bottom-color:var(--dial-text-label,rgba(255,255,255,0.7))] bg-transparent p-0 pb-px text-right text-[13px] font-medium font-mono [color:var(--dial-text-label,rgba(255,255,255,0.7))] outline-none focus:text-white"
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleInputKeyDown}
						onBlur={handleInputBlur}
						onClick={(e) => e.stopPropagation()}
						onMouseDown={(e) => e.stopPropagation()}
					/>
				) : (
					<button
						type="button"
						ref={valueButtonRef}
						className={cn(
							"absolute top-1/2 right-[10px] translate-y-[calc(-50%+0.5px)] appearance-none border-0 border-b border-b-transparent bg-transparent p-0 pb-px text-[13px] font-medium font-mono [color:var(--dial-text-label,rgba(255,255,255,0.7))] transition-[color,border-color] duration-150",
							isValueEditable &&
								"[border-bottom-color:var(--dial-text-label,rgba(255,255,255,0.7))]",
							isActive && "text-white",
							isValueEditable ? "cursor-text" : "cursor-default",
						)}
						onMouseEnter={() => setIsValueHovered(true)}
						onMouseLeave={() => setIsValueHovered(false)}
						onClick={handleValueClick}
						onMouseDown={(e) => {
							if (isValueEditable) {
								e.stopPropagation();
							}
						}}
					>
						{displayValueWithUnit}
					</button>
				)}
			</motion.div>
		</div>
	);
}
