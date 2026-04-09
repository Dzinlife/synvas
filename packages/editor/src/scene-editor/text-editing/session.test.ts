import { describe, expect, it, vi } from "vitest";
import {
	createTextEditingSession,
	resolveTextEditingDecorations,
	resolveTextEditingIndexAtScreenPoint,
	resolveTextEditingOverlayRect,
	resolveTextEditingSelectionFromAnchor,
	updateTextEditingSessionComposition,
	updateTextEditingSessionDraft,
} from "./session";

const createParagraphMock = () => {
	return {
		layout: vi.fn(),
		getHeight: vi.fn(() => 20),
		getGlyphPositionAtCoordinate: vi.fn((x: number) =>
			Math.max(0, Math.round(x / 10)),
		),
		getRectsForRange: vi.fn((start: number, end: number) => {
			const orderedStart = Math.min(start, end);
			const orderedEnd = Math.max(start, end);
			return [
				{
					x: orderedStart * 10,
					y: 0,
					width: Math.max(0, (orderedEnd - orderedStart) * 10),
					height: 20,
				},
			];
		}),
		getLineMetrics: vi.fn(() => [
			{
				startIndex: 0,
				endIndex: 100,
				endExcludingWhitespaces: 100,
				endIncludingNewline: 100,
				isHardBreak: false,
				ascent: 16,
				descent: 4,
				height: 20,
				width: 400,
				left: 0,
				baseline: 16,
				lineNumber: 0,
			},
		]),
		getGlyphInfoAt: vi.fn((index: number) => {
			if (index < 0 || index > 100) return null;
			return {
				graphemeLayoutBounds: {
					x: index * 10,
					y: 0,
					width: 10,
					height: 20,
				},
				graphemeClusterTextRange: {
					start: index,
					end: index + 1,
				},
				dir: 0,
				isEllipsis: false,
			};
		}),
	};
};

describe("text-editing/session", () => {
	it("支持屏幕坐标命中到文本索引", () => {
		const paragraph = createParagraphMock();
		const session = createTextEditingSession({
			target: {
				id: "text-a",
				text: "0123456789",
				paragraph: paragraph as never,
				frame: {
					cx: 50,
					cy: 40,
					width: 100,
					height: 80,
					rotationRad: 0,
				},
				baseSize: {
					width: 100,
					height: 80,
				},
			},
		});

		const index = resolveTextEditingIndexAtScreenPoint(session, {
			x: 76,
			y: 40,
		});
		expect(index).toBe(8);
		expect(paragraph.getGlyphPositionAtCoordinate).toHaveBeenCalled();
	});

	it("支持选区/caret/composition 装饰计算", () => {
		const paragraph = createParagraphMock();
		paragraph.getGlyphInfoAt.mockImplementation((index: number) => {
			if (index === 4) return null;
			if (index < 0) return null;
			return {
				graphemeLayoutBounds: {
					x: index * 10,
					y: 0,
					width: 10,
					height: 20,
				},
				graphemeClusterTextRange: {
					start: index,
					end: index + 1,
				},
				dir: 0,
				isEllipsis: false,
			};
		});

		const baseSession = createTextEditingSession({
			target: {
				id: "text-a",
				text: "abcd",
				paragraph: paragraph as never,
				frame: {
					cx: 200,
					cy: 100,
					width: 200,
					height: 80,
					rotationRad: 0,
				},
				baseSize: {
					width: 100,
					height: 40,
				},
			},
			selection: {
				start: 1,
				end: 3,
				direction: "forward",
			},
		});

		const withComposition = updateTextEditingSessionComposition(baseSession, {
			start: 2,
			end: 4,
			direction: "forward",
		});
		const withCaret = updateTextEditingSessionDraft(withComposition, {
			draftText: "abcd",
			selection: {
				start: 4,
				end: 4,
				direction: "none",
			},
		});
		const decorations = resolveTextEditingDecorations(withCaret);
		expect(decorations.selectionRects.length).toBe(0);
		expect(decorations.compositionRects.length).toBe(1);
		expect(decorations.caretRect).toBeTruthy();
		expect(decorations.caretRect?.x).toBeCloseTo(80, 3);
		expect(decorations.caretRect?.width).toBeGreaterThanOrEqual(1);
	});

	it("支持范围锚点与 overlay 计算", () => {
		const selection = resolveTextEditingSelectionFromAnchor(8, 3);
		expect(selection.start).toBe(8);
		expect(selection.end).toBe(3);
		expect(selection.direction).toBe("backward");

		const overlay = resolveTextEditingOverlayRect({
			cx: 100,
			cy: 60,
			width: 80,
			height: 40,
			rotationRad: Math.PI / 2,
		});
		expect(overlay.width).toBeGreaterThan(0);
		expect(overlay.height).toBeGreaterThan(0);
	});

	it("段落 native 句柄失效时会安全回退而不抛错", () => {
		const paragraph = createParagraphMock();
		paragraph.getLineMetrics.mockImplementation(() => {
			throw new Error("paragraph disposed");
		});
		paragraph.getGlyphInfoAt.mockImplementation(() => {
			throw new Error("paragraph disposed");
		});
		paragraph.getRectsForRange.mockImplementation(() => {
			throw new Error("paragraph disposed");
		});
		paragraph.getGlyphPositionAtCoordinate.mockImplementation(() => {
			throw new Error("paragraph disposed");
		});
		const session = createTextEditingSession({
			target: {
				id: "text-a",
				text: "abcd",
				paragraph: paragraph as never,
				frame: {
					cx: 120,
					cy: 80,
					width: 100,
					height: 40,
					rotationRad: 0,
				},
				baseSize: {
					width: 100,
					height: 40,
				},
			},
			selection: {
				start: 2,
				end: 2,
				direction: "none",
			},
		});

		expect(() => resolveTextEditingDecorations(session)).not.toThrow();
		const index = resolveTextEditingIndexAtScreenPoint(session, {
			x: 120,
			y: 80,
		});
		expect(index).toBe(0);
	});
});
