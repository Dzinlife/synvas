import { describe, expect, it } from "vitest";
import type { CanvasNodeType } from "@/studio/project/types";
import {
	CANVAS_NODE_ICON_FONT_FAMILY,
	resolveCanvasNodeLabelText,
	resolveCanvasNodeTypeIcon,
} from "./canvasNodeIconLabel";

describe("canvasNodeIconLabel", () => {
	it("为六类 node type 返回固定 icon codepoint", () => {
		const cases: Array<{ type: CanvasNodeType; expectedIcon: string }> = [
			{ type: "scene", expectedIcon: "\uF000" },
			{ type: "video", expectedIcon: "\uF001" },
			{ type: "frame", expectedIcon: "\uF002" },
			{ type: "audio", expectedIcon: "\uF003" },
			{ type: "text", expectedIcon: "\uF004" },
			{ type: "image", expectedIcon: "\uF005" },
		];
		for (const testCase of cases) {
			expect(resolveCanvasNodeTypeIcon(testCase.type)).toBe(testCase.expectedIcon);
		}
		expect(CANVAS_NODE_ICON_FONT_FAMILY).toBe("SynvasIcon");
	});

	it("会拼装 icon + 空格 + trimmed name", () => {
		expect(
			resolveCanvasNodeLabelText({
				type: "video",
				name: "  Clip A  ",
			}),
		).toBe("\uF001 Clip A");
		expect(
			resolveCanvasNodeLabelText({
				type: "video",
				name: "   ",
			}),
		).toBe("");
	});
});
