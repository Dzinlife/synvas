import type { TimelineElement } from "core/element/types";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { componentRegistry } from "../model/componentRegistry";
import { createTransformMeta } from "../transform";

vi.mock("react-skia-lite", () => ({
	Paragraph: () => null,
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
		ParagraphBuilder: {
			Make: vi.fn(() => ({
				pushStyle: vi.fn(),
				addText: vi.fn(),
				pop: vi.fn(),
				build: vi.fn(),
				dispose: vi.fn(),
			})),
		},
		Color: vi.fn(),
	},
}));

describe("TextDefinition integration", () => {
	beforeAll(async () => {
		if (!componentRegistry.get("text")) {
			await import("./index");
		}
	});

	it("会注册 Text 组件定义", () => {
		const definition = componentRegistry.get("text");
		expect(definition).toBeTruthy();
		expect(definition?.type).toBe("Text");
		expect(definition?.meta.trackRole).toBe("overlay");
	});

	it("支持转换为 canvas text clipboard node", () => {
		const definition = componentRegistry.get("text");
		const element: TimelineElement = {
			id: "text-clip",
			type: "Text",
			component: "text",
			name: "Text Clip",
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
			name: "Text Clip",
			text: "clipboard",
			fontSize: 42,
		});
	});

	it("会出现在组件注册表列表中，允许素材库读取", () => {
		const components = componentRegistry.getAll();
		const textComponent = components.find((item) => item.component === "text");
		expect(textComponent).toBeTruthy();
		expect(textComponent?.meta.hiddenInMaterialLibrary).not.toBe(true);
	});
});
