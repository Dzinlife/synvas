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

export interface HeadlessTextInputBridgeProps {
	sessionId: string;
	value: string;
	selection: TextEditingSelection;
	overlayRect: TextEditingRect;
	isComposing: boolean;
	onValueChange: (value: string, selection: TextEditingSelection) => void;
	onSelectionChange: (selection: TextEditingSelection) => void;
	onCompositionStart: (selection: TextEditingSelection) => void;
	onCompositionUpdate: (selection: TextEditingSelection, data: string) => void;
	onCompositionEnd: (selection: TextEditingSelection, data: string) => void;
	onCommit: () => void;
	onCancel: () => void;
	onBlur: () => void;
}

const resolveSelectionFromTextarea = (
	node: HTMLTextAreaElement,
): TextEditingSelection => {
	const selectionStart = Math.max(0, node.selectionStart ?? 0);
	const selectionEnd = Math.max(0, node.selectionEnd ?? selectionStart);
	return {
		start: selectionStart,
		end: selectionEnd,
		direction: "none",
	};
};

export const HeadlessTextInputBridge = ({
	sessionId,
	value,
	selection,
	overlayRect,
	isComposing,
	onValueChange,
	onSelectionChange,
	onCompositionStart,
	onCompositionUpdate,
	onCompositionEnd,
	onCommit,
	onCancel,
	onBlur,
}: HeadlessTextInputBridgeProps) => {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const ignoreBlurUntilRef = useRef(0);

	useEffect(() => {
		const node = textareaRef.current;
		if (!node) return;
		node.focus();
	}, []);

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
		const selectionStart = Math.max(0, Math.min(selection.start, value.length));
		const selectionEnd = Math.max(0, Math.min(selection.end, value.length));
		if (
			node.selectionStart !== selectionStart ||
			node.selectionEnd !== selectionEnd
		) {
			node.setSelectionRange(selectionStart, selectionEnd);
		}
	}, [selection.end, selection.start, value]);

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
				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
					return;
				}
				if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					onCommit();
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
				onBlur();
			}}
		/>
	);
};

export default HeadlessTextInputBridge;
