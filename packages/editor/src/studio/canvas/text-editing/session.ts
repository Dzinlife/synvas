import type { LineMetrics, SkParagraph } from "react-skia-lite";

const TEXT_EDITING_EPSILON = 1e-6;
const MIN_CARET_WIDTH_PX = 1;

export interface TextEditingPoint {
	x: number;
	y: number;
}

export interface TextEditingRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TextEditingFrame {
	cx: number;
	cy: number;
	width: number;
	height: number;
	rotationRad: number;
}

export interface TextEditingSelection {
	start: number;
	end: number;
	direction?: "forward" | "backward" | "none";
}

export interface TextEditingTarget {
	id: string;
	text: string;
	paragraph: SkParagraph;
	frame: TextEditingFrame;
	baseSize: {
		width: number;
		height: number;
	};
}

export type TextEditingMode = "editing" | "composing";

export interface TextEditingSession {
	target: TextEditingTarget;
	draftText: string;
	selection: TextEditingSelection;
	compositionRange: TextEditingSelection | null;
	mode: TextEditingMode;
}

export interface TextEditingDecorations {
	frame: TextEditingFrame;
	selectionRects: TextEditingRect[];
	compositionRects: TextEditingRect[];
	caretRect: TextEditingRect | null;
}

interface TextEditingMatrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

const clampIndex = (index: number, max: number): number => {
	if (!Number.isFinite(index)) return 0;
	return Math.max(0, Math.min(max, Math.round(index)));
};

export const normalizeTextSelection = (
	selection: TextEditingSelection,
	textLength: number,
): TextEditingSelection => {
	const start = clampIndex(selection.start, textLength);
	const end = clampIndex(selection.end, textLength);
	return {
		start,
		end,
		direction: selection.direction,
	};
};

export const isTextSelectionCollapsed = (
	selection: TextEditingSelection,
): boolean => {
	return selection.start === selection.end;
};

const toOrderedRange = (selection: TextEditingSelection) => {
	if (selection.start <= selection.end) {
		return {
			start: selection.start,
			end: selection.end,
		};
	}
	return {
		start: selection.end,
		end: selection.start,
	};
};

const createTranslationMatrix = (x: number, y: number): TextEditingMatrix => {
	return {
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		e: x,
		f: y,
	};
};

const createRotationMatrix = (rotationRad: number): TextEditingMatrix => {
	const cos = Math.cos(rotationRad);
	const sin = Math.sin(rotationRad);
	return {
		a: cos,
		b: sin,
		c: -sin,
		d: cos,
		e: 0,
		f: 0,
	};
};

const multiplyMatrix = (
	left: TextEditingMatrix,
	right: TextEditingMatrix,
): TextEditingMatrix => {
	return {
		a: left.a * right.a + left.c * right.b,
		b: left.b * right.a + left.d * right.b,
		c: left.a * right.c + left.c * right.d,
		d: left.b * right.c + left.d * right.d,
		e: left.a * right.e + left.c * right.f + left.e,
		f: left.b * right.e + left.d * right.f + left.f,
	};
};

const createFrameMatrix = (frame: TextEditingFrame): TextEditingMatrix => {
	return multiplyMatrix(
		multiplyMatrix(
			createTranslationMatrix(frame.cx, frame.cy),
			createRotationMatrix(frame.rotationRad),
		),
		createTranslationMatrix(-frame.width / 2, -frame.height / 2),
	);
};

const invertMatrix = (matrix: TextEditingMatrix): TextEditingMatrix | null => {
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (Math.abs(determinant) <= TEXT_EDITING_EPSILON) {
		return null;
	}
	const reciprocal = 1 / determinant;
	return {
		a: matrix.d * reciprocal,
		b: -matrix.b * reciprocal,
		c: -matrix.c * reciprocal,
		d: matrix.a * reciprocal,
		e: (matrix.c * matrix.f - matrix.d * matrix.e) * reciprocal,
		f: (matrix.b * matrix.e - matrix.a * matrix.f) * reciprocal,
	};
};

const mapPoint = (
	matrix: TextEditingMatrix,
	point: TextEditingPoint,
): TextEditingPoint => {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f,
	};
};

const ensureParagraphLayout = (paragraph: SkParagraph, width: number): void => {
	try {
		paragraph.layout(Math.max(1, width));
	} catch {
		// 布局失败时交由调用方兜底，不在此抛错打断交互流程。
	}
};

const safeParagraphCall = <T>(resolver: () => T, fallback: T): T => {
	try {
		return resolver();
	} catch {
		return fallback;
	}
};

const resolveParagraphLineMetrics = (paragraph: SkParagraph): LineMetrics[] => {
	return safeParagraphCall(() => paragraph.getLineMetrics(), []);
};

type ParagraphRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const resolveParagraphRectsForRange = (
	paragraph: SkParagraph,
	start: number,
	end: number,
): ParagraphRect[] => {
	const rects = safeParagraphCall(
		() => paragraph.getRectsForRange(start, end),
		[],
	);
	if (!Array.isArray(rects)) return [];
	return rects.filter((rect) => {
		return (
			typeof rect?.x === "number" &&
			typeof rect?.y === "number" &&
			typeof rect?.width === "number" &&
			typeof rect?.height === "number"
		);
	});
};

const resolveParagraphGlyphInfoAt = (
	paragraph: SkParagraph,
	index: number,
): ReturnType<SkParagraph["getGlyphInfoAt"]> | null => {
	return safeParagraphCall(() => paragraph.getGlyphInfoAt(index), null);
};

const resolveParagraphGlyphIndexAtCoordinate = (
	paragraph: SkParagraph,
	x: number,
	y: number,
): number => {
	return safeParagraphCall(
		() => paragraph.getGlyphPositionAtCoordinate(x, y),
		0,
	);
};

const resolveParagraphScale = (target: TextEditingTarget) => {
	const safeBaseWidth = Math.max(
		Math.abs(target.baseSize.width),
		TEXT_EDITING_EPSILON,
	);
	const safeBaseHeight = Math.max(
		Math.abs(target.baseSize.height),
		TEXT_EDITING_EPSILON,
	);
	const safeFrameWidth = Math.max(
		Math.abs(target.frame.width),
		TEXT_EDITING_EPSILON,
	);
	const safeFrameHeight = Math.max(
		Math.abs(target.frame.height),
		TEXT_EDITING_EPSILON,
	);
	return {
		x: safeFrameWidth / safeBaseWidth,
		y: safeFrameHeight / safeBaseHeight,
		safeBaseWidth,
		safeBaseHeight,
	};
};

const paragraphRectToFrameRect = (
	rect: TextEditingRect,
	target: TextEditingTarget,
): TextEditingRect => {
	const scale = resolveParagraphScale(target);
	return {
		x: rect.x * scale.x,
		y: rect.y * scale.y,
		width: rect.width * scale.x,
		height: rect.height * scale.y,
	};
};

const resolveLineByIndex = (
	lines: LineMetrics[],
	index: number,
): LineMetrics | null => {
	if (lines.length <= 0) return null;
	for (const line of lines) {
		if (index >= line.startIndex && index <= line.endIncludingNewline) {
			return line;
		}
		if (index >= line.startIndex && index <= line.endIndex) {
			return line;
		}
	}
	const lastLine = lines[lines.length - 1] ?? null;
	if (lastLine && index >= lastLine.endIndex) {
		return lastLine;
	}
	return lines[0] ?? null;
};

const resolveCaretRectInParagraph = (
	session: TextEditingSession,
): TextEditingRect | null => {
	const { target } = session;
	const orderedSelection = toOrderedRange(session.selection);
	const index = orderedSelection.end;
	const textLength = session.draftText.length;
	const paragraph = target.paragraph;
	ensureParagraphLayout(paragraph, target.baseSize.width);
	const lines = resolveParagraphLineMetrics(paragraph);
	const line = resolveLineByIndex(lines, index);

	if (index < textLength) {
		const glyph = resolveParagraphGlyphInfoAt(paragraph, index);
		if (glyph) {
			const bounds = glyph.graphemeLayoutBounds;
			return {
				x: bounds.x,
				y: bounds.y,
				width: 0,
				height: Math.max(bounds.height, 1),
			};
		}
	}

	if (index > 0) {
		const prevGlyph = resolveParagraphGlyphInfoAt(paragraph, index - 1);
		if (prevGlyph) {
			const bounds = prevGlyph.graphemeLayoutBounds;
			return {
				x: bounds.x + bounds.width,
				y: bounds.y,
				width: 0,
				height: Math.max(bounds.height, 1),
			};
		}
	}

	if (line) {
		return {
			x: line.left,
			y: line.baseline - line.ascent,
			width: 0,
			height: Math.max(line.height, 1),
		};
	}

	return {
		x: 0,
		y: 0,
		width: 0,
		height: Math.max(1, target.baseSize.height),
	};
};

const toTextEditingRect = (rect: {
	x: number;
	y: number;
	width: number;
	height: number;
}): TextEditingRect => {
	return {
		x: rect.x,
		y: rect.y,
		width: Math.max(0, rect.width),
		height: Math.max(0, rect.height),
	};
};

export const createTextEditingSession = (params: {
	target: TextEditingTarget;
	selection?: TextEditingSelection;
}): TextEditingSession => {
	const { target } = params;
	const nextSelection = normalizeTextSelection(
		params.selection ?? {
			start: target.text.length,
			end: target.text.length,
			direction: "none",
		},
		target.text.length,
	);
	ensureParagraphLayout(target.paragraph, target.baseSize.width);
	return {
		target,
		draftText: target.text,
		selection: nextSelection,
		compositionRange: null,
		mode: "editing",
	};
};

export const updateTextEditingSessionTarget = (
	session: TextEditingSession,
	target: TextEditingTarget,
): TextEditingSession => {
	const textLength = session.draftText.length;
	return {
		...session,
		target,
		selection: normalizeTextSelection(session.selection, textLength),
		compositionRange: session.compositionRange
			? normalizeTextSelection(session.compositionRange, textLength)
			: null,
	};
};

export const updateTextEditingSessionSelection = (
	session: TextEditingSession,
	selection: TextEditingSelection,
): TextEditingSession => {
	const nextSelection = normalizeTextSelection(
		selection,
		session.draftText.length,
	);
	return {
		...session,
		selection: nextSelection,
	};
};

export const updateTextEditingSessionDraft = (
	session: TextEditingSession,
	params: {
		draftText: string;
		selection?: TextEditingSelection;
	},
): TextEditingSession => {
	const nextText = params.draftText;
	const nextSelection = normalizeTextSelection(
		params.selection ?? session.selection,
		nextText.length,
	);
	const nextComposition = session.compositionRange
		? normalizeTextSelection(session.compositionRange, nextText.length)
		: null;
	return {
		...session,
		draftText: nextText,
		selection: nextSelection,
		compositionRange: nextComposition,
		mode: nextComposition ? "composing" : "editing",
	};
};

export const updateTextEditingSessionComposition = (
	session: TextEditingSession,
	compositionRange: TextEditingSelection | null,
): TextEditingSession => {
	const nextRange = compositionRange
		? normalizeTextSelection(compositionRange, session.draftText.length)
		: null;
	return {
		...session,
		compositionRange: nextRange,
		mode: nextRange ? "composing" : "editing",
	};
};

export const resolveTextEditingSelectionFromAnchor = (
	anchorIndex: number,
	focusIndex: number,
): TextEditingSelection => {
	if (focusIndex >= anchorIndex) {
		return {
			start: anchorIndex,
			end: focusIndex,
			direction: "forward",
		};
	}
	return {
		start: anchorIndex,
		end: focusIndex,
		direction: "backward",
	};
};

export const resolveTextEditingIndexAtScreenPoint = (
	session: TextEditingSession,
	screenPoint: TextEditingPoint,
): number => {
	const { target } = session;
	const inverse = invertMatrix(createFrameMatrix(target.frame));
	if (!inverse) return 0;
	const localPoint = mapPoint(inverse, screenPoint);
	const scale = resolveParagraphScale(target);
	const paragraphX = Math.max(
		0,
		Math.min(localPoint.x / scale.x, scale.safeBaseWidth),
	);
	const paragraphY = Math.max(
		0,
		Math.min(localPoint.y / scale.y, scale.safeBaseHeight),
	);
	ensureParagraphLayout(target.paragraph, target.baseSize.width);
	const index = resolveParagraphGlyphIndexAtCoordinate(
		target.paragraph,
		paragraphX,
		paragraphY,
	);
	return clampIndex(index, session.draftText.length);
};

export const resolveTextEditingDecorations = (
	session: TextEditingSession,
): TextEditingDecorations => {
	const orderedSelection = toOrderedRange(session.selection);
	const { target } = session;
	ensureParagraphLayout(target.paragraph, target.baseSize.width);

	const selectionRects =
		orderedSelection.end > orderedSelection.start
			? resolveParagraphRectsForRange(
					target.paragraph,
					orderedSelection.start,
					orderedSelection.end,
				).map((rect) => {
					return paragraphRectToFrameRect(toTextEditingRect(rect), target);
				})
			: [];

	const compositionRects = session.compositionRange
		? (() => {
				const orderedComposition = toOrderedRange(session.compositionRange);
				if (orderedComposition.end <= orderedComposition.start) {
					return [];
				}
				return resolveParagraphRectsForRange(
					target.paragraph,
					orderedComposition.start,
					orderedComposition.end,
				).map((rect) => {
					return paragraphRectToFrameRect(toTextEditingRect(rect), target);
				});
			})()
		: [];

	const caretRect = isTextSelectionCollapsed(session.selection)
		? (() => {
				const caretInParagraph = resolveCaretRectInParagraph(session);
				if (!caretInParagraph) return null;
				const frameRect = paragraphRectToFrameRect(caretInParagraph, target);
				return {
					...frameRect,
					width: Math.max(MIN_CARET_WIDTH_PX, frameRect.width),
				};
			})()
		: null;

	return {
		frame: target.frame,
		selectionRects,
		compositionRects,
		caretRect,
	};
};

export const resolveTextEditingOverlayRect = (
	frame: TextEditingFrame,
): TextEditingRect => {
	const matrix = createFrameMatrix(frame);
	const points = [
		mapPoint(matrix, { x: 0, y: 0 }),
		mapPoint(matrix, { x: frame.width, y: 0 }),
		mapPoint(matrix, { x: frame.width, y: frame.height }),
		mapPoint(matrix, { x: 0, y: frame.height }),
	];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		return {
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		};
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(1, maxX - minX),
		height: Math.max(1, maxY - minY),
	};
};
