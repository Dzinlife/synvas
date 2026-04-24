import type {
	BoardCanvasNode,
	CanvasNode,
	TextCanvasNode,
} from "@/studio/project/types";
import { describe, expect, it } from "vitest";
import {
	collectCanvasAncestorBoardIds,
	resolveCanvasBoardExpandToFitPatches,
	resolvePointerContainingBoardId,
} from "./canvasBoardUtils";

const createBoardNode = (
	id: string,
	patch: Partial<BoardCanvasNode> = {},
): BoardCanvasNode => ({
	id,
	type: "board",
	name: id,
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	...patch,
});

const createTextNode = (
	id: string,
	patch: Partial<TextCanvasNode> = {},
): TextCanvasNode => ({
	id,
	type: "text",
	name: id,
	text: id,
	fontSize: 24,
	x: 0,
	y: 0,
	width: 100,
	height: 40,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	...patch,
});

describe("canvasBoardUtils", () => {
	it("按指针位置命中 board，不要求拖拽节点完全被包含", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("board-a", {
				x: 100,
				y: 100,
				width: 160,
				height: 120,
			}),
			createTextNode("node-a", {
				x: 40,
				y: 120,
				width: 140,
				height: 60,
			}),
		];

		expect(resolvePointerContainingBoardId(nodes, 120, 140)).toBe("board-a");
	});

	it("嵌套 board 同时命中时优先选择更内层", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("outer", {
				x: 0,
				y: 0,
				width: 400,
				height: 400,
				siblingOrder: 0,
			}),
			createBoardNode("inner", {
				parentId: "outer",
				x: 80,
				y: 80,
				width: 160,
				height: 160,
				siblingOrder: 0,
			}),
		];

		expect(resolvePointerContainingBoardId(nodes, 120, 120)).toBe("inner");
	});

	it("重叠同级 board 同时命中时优先选择更前面的图层", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("back", {
				x: 0,
				y: 0,
				width: 200,
				height: 200,
				siblingOrder: 0,
			}),
			createBoardNode("front", {
				x: 40,
				y: 40,
				width: 200,
				height: 200,
				siblingOrder: 1,
			}),
		];

		expect(resolvePointerContainingBoardId(nodes, 80, 80)).toBe("front");
	});

	it("排除移动子树并忽略 hidden board", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("outer", {
				x: 0,
				y: 0,
				width: 400,
				height: 400,
			}),
			createBoardNode("inner", {
				parentId: "outer",
				x: 80,
				y: 80,
				width: 160,
				height: 160,
			}),
			createBoardNode("hidden", {
				x: 90,
				y: 90,
				width: 120,
				height: 120,
				siblingOrder: 10,
				hidden: true,
			}),
			createTextNode("child", {
				parentId: "inner",
				x: 100,
				y: 100,
			}),
		];

		expect(
			resolvePointerContainingBoardId(nodes, 120, 120, {
				excludeNodeIds: new Set(["inner", "child"]),
			}),
		).toBe("outer");
	});

	it("按最终 board 链 expand-only 适配子元素，并保留已足够大的 board", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("outer", {
				x: -100,
				y: -100,
				width: 700,
				height: 700,
			}),
			createBoardNode("inner", {
				parentId: "outer",
				x: 0,
				y: 0,
				width: 100,
				height: 100,
			}),
			createTextNode("child", {
				parentId: "inner",
				x: -10,
				y: 40,
				width: 140,
				height: 90,
			}),
		];

		expect(collectCanvasAncestorBoardIds(nodes, "inner")).toEqual([
			"inner",
			"outer",
		]);
		expect(resolveCanvasBoardExpandToFitPatches(nodes, ["inner", "outer"], 24))
			.toEqual([
				{
					nodeId: "inner",
					patch: {
						x: -34,
						y: 0,
						width: 188,
						height: 154,
					},
				},
			]);
	});
});
