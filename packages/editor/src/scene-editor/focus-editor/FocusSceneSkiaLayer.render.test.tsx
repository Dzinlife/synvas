// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusSceneSkiaLayer } from "./FocusSceneSkiaLayer";

const { paragraphInstances, fontRegistryMock } = vi.hoisted(() => {
	type ParagraphInstance = {
		text: string;
		layout: ReturnType<typeof vi.fn>;
		getLongestLine: ReturnType<typeof vi.fn>;
		getHeight: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};
	const listeners = new Set<() => void>();
	return {
		paragraphInstances: [] as ParagraphInstance[],
		fontRegistryMock: {
			getFontProvider: vi.fn().mockResolvedValue({ id: "provider" }),
			ensureCoverage: vi.fn().mockResolvedValue(undefined),
			getParagraphRunPlan: vi.fn((text: string) => {
				if (!text) return [];
				return [
					{
						text,
						fontFamilies: ["Noto Sans SC"],
						status: "primary" as const,
					},
				];
			}),
			subscribe: vi.fn((listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			}),
			reset: () => {
				listeners.clear();
			},
		},
	};
});

vi.mock("@/typography/fontRegistry", () => ({
	FONT_REGISTRY_PRIMARY_FAMILY: "Noto Sans SC",
	fontRegistry: {
		getFontProvider: fontRegistryMock.getFontProvider,
		ensureCoverage: fontRegistryMock.ensureCoverage,
		getParagraphRunPlan: fontRegistryMock.getParagraphRunPlan,
		subscribe: fontRegistryMock.subscribe,
	},
}));

vi.mock("react-skia-lite", () => ({
	Group: ({ children }: { children?: React.ReactNode }) => (
		<div data-testid="skia-group">{children}</div>
	),
	Rect: ({ children }: { children?: React.ReactNode }) => (
		<div data-testid="skia-rect">{children}</div>
	),
	Line: ({ children }: { children?: React.ReactNode }) => (
		<div data-testid="skia-line">{children}</div>
	),
	DashPathEffect: () => <div data-testid="skia-dash" />,
	RoundedRect: ({
		width,
		height,
		color,
	}: {
		width?: number;
		height?: number;
		color?: string;
	}) => (
		<div
			data-testid="skia-rounded-rect"
			data-width={width}
			data-height={height}
			data-color={color}
		/>
	),
	Paragraph: ({
		paragraph,
		x,
		y,
		width,
	}: {
		paragraph: { text?: string };
		x: number;
		y: number;
		width: number;
	}) => (
		<div
			data-testid="focus-label-paragraph"
			data-text={paragraph?.text ?? ""}
			data-x={x}
			data-y={y}
			data-width={width}
		/>
	),
	Skia: {
		Color: (value: string) => value,
		ParagraphBuilder: {
			Make: (_style: unknown, _provider?: unknown) => {
				let paragraphText = "";
				const builder = {
					pushStyle: vi.fn(() => builder),
					addText: vi.fn((text: string) => {
						paragraphText += text;
						return builder;
					}),
					pop: vi.fn(() => builder),
					build: vi.fn(() => {
						const paragraph = {
							text: paragraphText,
							layout: vi.fn(),
							getLongestLine: vi.fn(() => paragraphText.length * 10),
							getHeight: vi.fn(() => 16),
							dispose: vi.fn(),
						};
						paragraphInstances.push(paragraph);
						return paragraph;
					}),
					dispose: vi.fn(),
				};
				return builder;
			},
		},
	},
}));

const createBaseProps = () => {
	return {
		width: 960,
		height: 540,
		elements: [],
		selectedIds: [],
		hoveredId: null,
		draggingId: null,
		selectionRectScreen: null,
		snapGuidesScreen: {
			vertical: [],
			horizontal: [],
		},
		selectionFrameScreen: null,
		handleItems: [],
		activeHandle: null,
		labelItems: [
			{
				id: "label-a",
				screenX: 100,
				screenY: 80,
				screenWidth: 320,
				screenHeight: 180,
				canvasWidth: 320,
				canvasHeight: 180,
				rotationDeg: 0,
			},
		],
		onLayerPointerDown: vi.fn(),
		onLayerPointerMove: vi.fn(),
		onLayerPointerUp: vi.fn(),
		onLayerPointerLeave: vi.fn(),
	};
};

afterEach(() => {
	vi.clearAllMocks();
	paragraphInstances.length = 0;
	fontRegistryMock.reset();
});

describe("FocusSceneSkiaLayer render", () => {
	it("focus 标签会使用 paragraph 渲染", async () => {
		render(<FocusSceneSkiaLayer {...createBaseProps()} />);

		await waitFor(() => {
			expect(screen.getByTestId("focus-label-paragraph")).toBeTruthy();
		});
		const paragraphNode = screen.getByTestId("focus-label-paragraph");
		expect(paragraphNode.getAttribute("data-text")).toBe("320 × 180");
		expect(fontRegistryMock.ensureCoverage).toHaveBeenCalledWith({
			text: "320 × 180",
		});
	});

	it("badge 尺寸会使用 paragraph 量测结果", async () => {
		render(<FocusSceneSkiaLayer {...createBaseProps()} />);

		await waitFor(() => {
			expect(screen.getByTestId("focus-label-paragraph")).toBeTruthy();
		});
		const backgroundBadge = screen
			.getAllByTestId("skia-rounded-rect")
			.find((node) => {
				return node.getAttribute("data-color") === "rgba(0,0,0,0.8)";
			});
		expect(backgroundBadge).toBeTruthy();
		expect(backgroundBadge?.getAttribute("data-width")).toBe("114");
		expect(backgroundBadge?.getAttribute("data-height")).toBe("24");
	});
});
