import type { TimelineElement } from "core/element/types";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { componentRegistry } from "../model/componentRegistry";
import { createTransformMeta } from "../transform";

vi.mock("react-skia-lite", () => ({
	Glyphs: () => null,
	Group: () => null,
	Paragraph: () => null,
	RoundedRect: () => null,
	TextBlob: () => null,
	TextAlign: {
		Left: 0,
		Right: 1,
		Center: 2,
	},
	Skia: {
		Data: {
			fromURI: vi.fn(),
		},
		Typeface: {
			MakeFreeTypeFaceFromData: vi.fn(),
		},
		TypefaceFontProvider: {
			Make: vi.fn(() => ({
				registerFont: vi.fn(),
			})),
		},
		Font: vi.fn(() => ({
			setSubpixel: vi.fn(),
			setLinearMetrics: vi.fn(),
			dispose: vi.fn(),
		})),
		ParagraphBuilder: {
			Make: vi.fn(() => ({
				pushStyle: vi.fn(),
				addText: vi.fn(),
				pop: vi.fn(),
				build: vi.fn(),
				dispose: vi.fn(),
			})),
		},
		TextBlob: {
			MakeFromRSXformGlyphs: vi.fn(),
		},
		RSXform: vi.fn(),
		Color: vi.fn((value: string) => value),
	},
}));

describe("FancyTextDefinition integration", () => {
	beforeAll(async () => {
		if (!componentRegistry.get("fancy-text")) {
			await import("./index");
		}
	});

	it("会注册 FancyText 组件定义", () => {
		const definition = componentRegistry.get("fancy-text");
		expect(definition).toBeTruthy();
		expect(definition?.type).toBe("Text");
		expect(definition?.meta.trackRole).toBe("overlay");
		expect(definition?.meta.resizeBehavior).toBe("text-width-reflow");
		expect(definition?.meta.defaultProps).toMatchObject({
			locale: "zh-CN",
			waveRadius: 48,
			waveTranslateY: 8,
			waveScale: 0.16,
		});
	});

	it("支持转换为 canvas text clipboard node", () => {
		const definition = componentRegistry.get("fancy-text");
		const element: TimelineElement = {
			id: "fancy-text-clip",
			type: "Text",
			component: "fancy-text",
			name: "Fancy Text Clip",
			props: {
				text: "clipboard",
				fontSize: 42,
			},
			transform: createTransformMeta({
				width: 500,
				height: 160,
				positionX: 0,
				positionY: 0,
			}),
			timeline: {
				start: 0,
				end: 150,
				startTimecode: "00:00:00:00",
				endTimecode: "00:00:05:00",
				trackIndex: 1,
				trackId: "overlay-1",
				role: "overlay",
			},
			render: {
				zIndex: 2,
				visible: true,
				opacity: 1,
			},
		};
		const node = definition?.toCanvasClipboardNode?.({
			element,
			sourceCanvasSize: {
				width: 1920,
				height: 1080,
			},
			fps: 30,
		});
		expect(node).toMatchObject({
			type: "text",
			name: "Fancy Text Clip",
			text: "clipboard",
			fontSize: 42,
		});
	});

	it("会出现在组件注册表列表中，允许素材库读取", () => {
		const components = componentRegistry.getAll();
		const fancyTextComponent = components.find(
			(item) => item.component === "fancy-text",
		);
		expect(fancyTextComponent).toBeTruthy();
		expect(fancyTextComponent?.meta.hiddenInMaterialLibrary).not.toBe(true);
	});
});
