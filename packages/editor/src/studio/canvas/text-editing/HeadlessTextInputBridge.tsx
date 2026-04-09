import {
	type CSSProperties,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import type { TextEditingRect, TextEditingSelection } from "./session";

const getNowMs = () => {
	if (
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
	) {
		return performance.now();
	}
	return Date.now();
};

const NAVIGATION_KEYS = new Set([
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
]);

const isNavigationKey = (key: string): boolean => {
	return NAVIGATION_KEYS.has(key);
};

export interface HeadlessTextInputBridgeProps {
	sessionId: string;
	value: string;
	selection: TextEditingSelection;
	overlayRect: TextEditingRect;
	isComposing: boolean;
	isActive?: boolean;
	canUndo?: boolean;
	canRedo?: boolean;
	useNativeUndoRedo?: boolean;
	keepFocusOnBlur?: boolean;
	onValueChange: (value: string, selection: TextEditingSelection) => void;
	onSelectionChange: (selection: TextEditingSelection) => void;
	onCompositionStart: (selection: TextEditingSelection) => void;
	onCompositionUpdate: (selection: TextEditingSelection, data: string) => void;
	onCompositionEnd: (selection: TextEditingSelection, data: string) => void;
	onUndo?: () => void;
	onRedo?: () => void;
	onCommit: () => void;
	onCancel: () => void;
	onBlur: () => void;
}

const resolveSelectionFromTextarea = (
	node: HTMLTextAreaElement,
): TextEditingSelection => {
	const selectionStart = Math.max(0, node.selectionStart ?? 0);
	const selectionEnd = Math.max(0, node.selectionEnd ?? selectionStart);
	const directionRaw = node.selectionDirection;
	const direction =
		directionRaw === "forward" || directionRaw === "backward"
			? directionRaw
			: "none";
	if (selectionStart === selectionEnd) {
		return {
			start: selectionStart,
			end: selectionEnd,
			direction: "none",
		};
	}
	if (direction === "backward") {
		return {
			start: selectionEnd,
			end: selectionStart,
			direction: "backward",
		};
	}
	return {
		start: selectionStart,
		end: selectionEnd,
		direction: direction === "forward" ? "forward" : "none",
	};
};

const resolveTextareaSelection = (params: {
	start: number;
	end: number;
	direction: TextEditingSelection["direction"];
	textLength: number;
}): {
	start: number;
	end: number;
	direction: "forward" | "backward" | "none";
} => {
	const { start: rawStart, end: rawEnd, direction, textLength } = params;
	const start = Math.max(0, Math.min(rawStart, textLength));
	const end = Math.max(0, Math.min(rawEnd, textLength));
	const orderedStart = Math.min(start, end);
	const orderedEnd = Math.max(start, end);
	if (orderedStart === orderedEnd) {
		return {
			start: orderedStart,
			end: orderedEnd,
			direction: "none",
		};
	}
	const isBackward =
		direction === "backward" || (direction !== "forward" && start > end);
	return {
		start: orderedStart,
		end: orderedEnd,
		direction: isBackward ? "backward" : "forward",
	};
};

export const HeadlessTextInputBridge = ({
	sessionId,
	value,
	selection,
	overlayRect,
	isComposing,
	isActive = true,
	canUndo = false,
	canRedo = false,
	useNativeUndoRedo = false,
	keepFocusOnBlur = false,
	onValueChange,
	onSelectionChange,
	onCompositionStart,
	onCompositionUpdate,
	onCompositionEnd,
	onUndo,
	onRedo,
	onCommit,
	onCancel,
	onBlur,
}: HeadlessTextInputBridgeProps) => {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const ignoreBlurUntilRef = useRef(0);
	const modelSelectionStart = selection.start;
	const modelSelectionEnd = selection.end;
	const modelSelectionDirection = selection.direction;

	const scheduleSelectionSync = () => {
		window.setTimeout(() => {
			const node = textareaRef.current;
			if (!node) return;
			onSelectionChange(resolveSelectionFromTextarea(node));
		}, 0);
	};

	useEffect(() => {
		const node = textareaRef.current;
		if (!node) return;
		if (!isActive) {
			if (document.activeElement === node) {
				node.blur();
			}
			return;
		}
		node.focus();
	}, [isActive]);

	useEffect(() => {
		const handlePointerDownCapture = (event: PointerEvent) => {
			const node = textareaRef.current;
			if (!node) {
				ignoreBlurUntilRef.current = 0;
				return;
			}
			const rect = node.getBoundingClientRect();
			const isInsideOverlay =
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom;
			// 在输入桥覆盖区域内按下指针时，会先触发 blur；短时间内忽略该 blur，避免误提交编辑会话。
			ignoreBlurUntilRef.current = isInsideOverlay ? getNowMs() + 240 : 0;
		};

		window.addEventListener("pointerdown", handlePointerDownCapture, true);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDownCapture, true);
		};
	}, []);

	useLayoutEffect(() => {
		const node = textareaRef.current;
		if (!node) return;
		if (node.value !== value) {
			node.value = value;
		}
		const textareaSelection = resolveTextareaSelection({
			start: modelSelectionStart,
			end: modelSelectionEnd,
			direction: modelSelectionDirection,
			textLength: value.length,
		});
		const currentDirectionRaw = node.selectionDirection;
		const currentDirection =
			currentDirectionRaw === "forward" || currentDirectionRaw === "backward"
				? currentDirectionRaw
				: "none";
		if (
			node.selectionStart !== textareaSelection.start ||
			node.selectionEnd !== textareaSelection.end ||
			currentDirection !== textareaSelection.direction
		) {
			node.setSelectionRange(
				textareaSelection.start,
				textareaSelection.end,
				textareaSelection.direction,
			);
		}
	}, [modelSelectionDirection, modelSelectionEnd, modelSelectionStart, value]);

	const style = useMemo<CSSProperties>(() => {
		return {
			position: "absolute",
			left: overlayRect.x,
			top: overlayRect.y,
			width: Math.max(1, overlayRect.width),
			height: Math.max(1, overlayRect.height),
			opacity: 0,
			pointerEvents: "none",
			resize: "none",
			outline: "none",
			border: "none",
			padding: 0,
			margin: 0,
			background: "transparent",
			color: "transparent",
			caretColor: "transparent",
			fontSize: 16,
			lineHeight: "1.2",
			whiteSpace: "pre-wrap",
			overflow: "hidden",
		};
	}, [overlayRect.height, overlayRect.width, overlayRect.x, overlayRect.y]);

	return (
		<textarea
			ref={textareaRef}
			value={value}
			style={style}
			autoCorrect="off"
			autoComplete="off"
			autoCapitalize="off"
			spellCheck={false}
			data-focus-scene-text-input={sessionId}
			onChange={(event) => {
				const node = event.currentTarget;
				onValueChange(node.value, resolveSelectionFromTextarea(node));
			}}
			onSelect={(event) => {
				onSelectionChange(resolveSelectionFromTextarea(event.currentTarget));
			}}
			onCompositionStart={(event) => {
				onCompositionStart(resolveSelectionFromTextarea(event.currentTarget));
			}}
			onCompositionUpdate={(event) => {
				onCompositionUpdate(
					resolveSelectionFromTextarea(event.currentTarget),
					event.data ?? "",
				);
			}}
			onCompositionEnd={(event) => {
				onCompositionEnd(
					resolveSelectionFromTextarea(event.currentTarget),
					event.data ?? "",
				);
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.nativeEvent.isComposing || isComposing) {
					return;
				}
				if (!useNativeUndoRedo) {
					const isModifier = event.metaKey || event.ctrlKey;
					if (isModifier && !event.altKey) {
						const key = event.key.toLowerCase();
						if (key === "z") {
							event.preventDefault();
							if (event.shiftKey) {
								if (canRedo) {
									onRedo?.();
								}
								return;
							}
							if (canUndo) {
								onUndo?.();
							}
							return;
						}
						if (key === "y" && event.ctrlKey && !event.metaKey) {
							event.preventDefault();
							if (canRedo) {
								onRedo?.();
							}
							return;
						}
					}
				}
				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
					return;
				}
				if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					onCommit();
					return;
				}
				if (isNavigationKey(event.key)) {
					scheduleSelectionSync();
				}
			}}
			onBlur={() => {
				if (getNowMs() <= ignoreBlurUntilRef.current) {
					ignoreBlurUntilRef.current = 0;
					window.setTimeout(() => {
						const node = textareaRef.current;
						if (!node) return;
						if (document.activeElement === node) return;
						node.focus();
					}, 0);
					return;
				}
				if (keepFocusOnBlur) {
					window.setTimeout(() => {
						const node = textareaRef.current;
						if (!node) return;
						if (document.activeElement === node) return;
						node.focus();
					}, 0);
					return;
				}
				onBlur();
			}}
		/>
	);
};

export default HeadlessTextInputBridge;
