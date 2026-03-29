// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	modelState: {
		internal: {
			paragraph: null as unknown,
			font: null as unknown,
			typeface: null as unknown,
			wordSegments: [] as Array<{ text: string; start: number; end: number }>,
		},
		props: {
			color: "#ffffff",
			fontSize: 48,
			highlightColor: "#f59e0b",
			waveRadius: 12,
			waveTranslateY: 8,
			waveScale: 0.16,
		},
	},
	timelineElement: {
		transform: {
			baseSize: {
				width: 240,
				height: 80,
			},
		},
		timeline: {
			start: 0,
			end: 90,
		},
	},
	currentTime: 45,
	makePathFromRSXformGlyphs: vi.fn(),
	rsxform: vi.fn((scos: number, ssin: number, tx: number, ty: number) => ({
		scos,
		ssin,
		tx,
		ty,
	})),
}));

vi.mock("react-skia-lite", async () => {
	const ReactModule = await import("react");
	const createNode = (kind: string) => {
		return (props: Record<string, unknown>) => {
			const { children, ...rest } = props;
			return ReactModule.createElement(
				"div",
				{
					"data-kind": kind,
					...rest,
				},
				children as React.ReactNode,
			);
		};
	};

	return {
		Glyphs: createNode("glyphs"),
		Group: createNode("group"),
		Path: createNode("path"),
		Paragraph: createNode("paragraph"),
		FontEdging: {
			SubpixelAntiAlias: 0,
		},
		FontHinting: {
			None: 0,
		},
		Skia: {
			Font: vi.fn(() => ({
				setEdging: vi.fn(),
				setEmbeddedBitmaps: vi.fn(),
				setHinting: vi.fn(),
				setSubpixel: vi.fn(),
				setLinearMetrics: vi.fn(),
				dispose: vi.fn(),
			})),
			RSXform: mocks.rsxform,
			Path: {
				MakeFromRSXformGlyphs: mocks.makePathFromRSXformGlyphs,
			},
		},
	};
});

vi.mock("../model/registry", () => ({
	createModelSelector: () => {
		return (
			_id: string,
			selector: (state: typeof mocks.modelState) => unknown,
		) => selector(mocks.modelState);
	},
}));

vi.mock("@/scene-editor/contexts/TimelineContext", () => ({
	useRenderTime: () => mocks.currentTime,
	useTimelineStore: (
		selector: (state: {
			getElementById: () => typeof mocks.timelineElement;
		}) => unknown,
	) =>
		selector({
			getElementById: () => mocks.timelineElement as never,
		}),
}));

import FancyTextRenderer from "./renderer";

const renderFancyText = () => {
	return render(<FancyTextRenderer id={`fancy-text-${Math.random()}`} />);
};

describe("FancyText renderer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.currentTime = 45;
		const paragraph = {
			layout: vi.fn(),
			getShapedLines: vi.fn(() => [
				{
					textRange: { first: 0, last: 4 },
					top: 0,
					bottom: 40,
					baseline: 30,
					runs: [
						{
							typeface: { id: "run-typeface" },
							size: 48,
							fakeBold: false,
							fakeItalic: false,
							glyphs: new Uint16Array([1, 2, 3, 4]),
							positions: new Float32Array([
								0, 20, 14, 20, 42, 20, 54, 20, 66, 20,
							]),
							offsets: new Uint32Array([0, 1, 2, 3, 4]),
							flags: 0,
						},
					],
				},
			]),
			paint: vi.fn(),
		};
		mocks.modelState.internal.paragraph = paragraph;
		mocks.modelState.internal.font = { dispose: vi.fn() };
		mocks.modelState.internal.typeface = { id: "typeface" };
		mocks.modelState.internal.wordSegments = [
			{ text: "A", start: 0, end: 1 },
			{ text: "BC", start: 1, end: 3 },
			{ text: "D", start: 3, end: 4 },
		];
		mocks.makePathFromRSXformGlyphs.mockImplementation(
			(glyphIds: number[], rsxforms: Array<Record<string, number>>) => ({
				glyphIds,
				rsxforms,
				dispose: vi.fn(),
			}),
		);
	});

	afterEach(() => {
		cleanup();
	});

	it("正常路径会按整段 glyph flow 生成组合 path", () => {
		mocks.currentTime = 51;
		const { container } = renderFancyText();

		expect(container.querySelectorAll('[data-kind="glyphs"]')).toHaveLength(0);
		expect(container.querySelectorAll('[data-kind="path"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-kind="paragraph"]')).toHaveLength(
			0,
		);

		const paragraph = mocks.modelState.internal.paragraph;
		expect(paragraph.layout).toHaveBeenCalledWith(240);
		expect(paragraph.getShapedLines).toHaveBeenCalledTimes(1);
		expect(paragraph.paint).not.toHaveBeenCalled();

		expect(mocks.makePathFromRSXformGlyphs).toHaveBeenCalledWith(
			[1, 2, 3, 4],
			expect.any(Array),
			expect.objectContaining({
				dispose: expect.any(Function),
			}),
		);
		const rsxforms = mocks.makePathFromRSXformGlyphs.mock
			.calls[0]?.[1] as Array<{
			ty: number;
		}>;
		expect(rsxforms).toHaveLength(4);
		expect(rsxforms[1]?.ty).toBeLessThan(20);
		expect(rsxforms[2]?.ty).toBeLessThan(20);
		expect(rsxforms[1]?.ty).not.toBe(rsxforms[2]?.ty);
	});

	it("整句 sweep 的第一帧会从文本外侧进入", () => {
		mocks.currentTime = 0;
		const { container } = renderFancyText();

		expect(container.querySelectorAll('[data-kind="glyphs"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-kind="path"]')).toHaveLength(0);
		expect(mocks.makePathFromRSXformGlyphs).not.toHaveBeenCalled();
	});

	it("卸载时会释放生成的 path", () => {
		mocks.currentTime = 51;
		const dispose = vi.fn();
		mocks.makePathFromRSXformGlyphs.mockReturnValueOnce({
			dispose,
		});

		const { unmount } = renderFancyText();
		unmount();

		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
