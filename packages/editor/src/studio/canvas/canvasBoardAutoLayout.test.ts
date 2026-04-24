import type {
	BoardCanvasNode,
	CanvasNode,
	TextCanvasNode,
} from "@/studio/project/types";
import { describe, expect, it } from "vitest";
import {
	CANVAS_BOARD_AUTO_LAYOUT_GAP,
	deriveCanvasBoardAutoLayoutRows,
	resolveCanvasBoardAutoLayoutInsertion,
	resolveCanvasBoardAutoLayoutPatches,
} from "./canvasBoardAutoLayout";

const createBoardNode = (
	id: string,
	patch: Partial<BoardCanvasNode> = {},
): BoardCanvasNode => ({
	id,
	type: "board",
	name: id,
	layoutMode: "auto",
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

describe("canvasBoardAutoLayout", () => {
	it("按当前位置分行并在行内按 x 排序", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("board", { x: 100, y: 100 }),
			createTextNode("b", {
				parentId: "board",
				x: 260,
				y: 164,
				width: 80,
				height: 40,
			}),
			createTextNode("a", {
				parentId: "board",
				x: 164,
				y: 164,
				width: 80,
				height: 80,
			}),
			createTextNode("c", {
				parentId: "board",
				x: 164,
				y: 320,
				width: 80,
				height: 40,
			}),
		];

		expect(deriveCanvasBoardAutoLayoutRows(nodes, "board")).toEqual([
			["a", "b"],
			["c"],
		]);
	});

	it("按 64 gap 顶部对齐排版，并让 board 尺寸包含外侧 gap", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("board", { x: 100, y: 200, width: 999, height: 999 }),
			createTextNode("a", {
				parentId: "board",
				x: 0,
				y: 0,
				width: 120,
				height: 80,
			}),
			createTextNode("b", {
				parentId: "board",
				x: 0,
				y: 0,
				width: 60,
				height: 40,
			}),
			createTextNode("c", {
				parentId: "board",
				x: 0,
				y: 0,
				width: 90,
				height: 50,
			}),
		];

		expect(
			resolveCanvasBoardAutoLayoutPatches(nodes, "board", {
				rows: [["a", "b"], ["c"]],
			}),
		).toEqual([
			{
				nodeId: "a",
				patch: { x: 164, y: 264 },
			},
			{
				nodeId: "b",
				patch: { x: 348, y: 264, siblingOrder: 1 },
			},
			{
				nodeId: "c",
				patch: { x: 164, y: 408, siblingOrder: 2 },
			},
			{
				nodeId: "board",
				patch: {
					width: 372,
					height: 322,
				},
			},
		]);
	});

	it("忽略 hidden child，空 board 保持两侧 gap 尺寸", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("board", { width: 300, height: 200 }),
			createTextNode("hidden", {
				parentId: "board",
				hidden: true,
				width: 120,
				height: 80,
			}),
		];

		expect(resolveCanvasBoardAutoLayoutPatches(nodes, "board")).toEqual([
			{
				nodeId: "board",
				patch: {
					width: CANVAS_BOARD_AUTO_LAYOUT_GAP * 2,
					height: CANVAS_BOARD_AUTO_LAYOUT_GAP * 2,
				},
			},
		]);
	});

	it("移动 direct child board 时同步平移其 descendants", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("board", { x: 0, y: 0 }),
			createBoardNode("child-board", {
				parentId: "board",
				x: 10,
				y: 20,
				width: 120,
				height: 80,
			}),
			createTextNode("grandchild", {
				parentId: "child-board",
				x: 30,
				y: 50,
				width: 40,
				height: 20,
			}),
		];

		expect(resolveCanvasBoardAutoLayoutPatches(nodes, "board")).toEqual([
			{
				nodeId: "child-board",
				patch: { x: 64, y: 64 },
			},
			{
				nodeId: "grandchild",
				patch: { x: 84, y: 94 },
			},
			{
				nodeId: "board",
				patch: { width: 248, height: 208 },
			},
		]);
	});

	it("解析行内和行间插入位置，并以 gap/2 放置 indicator", () => {
		const nodes: CanvasNode[] = [
			createBoardNode("board", { x: 0, y: 0, width: 500, height: 400 }),
			createTextNode("a", {
				parentId: "board",
				x: 64,
				y: 64,
				width: 100,
				height: 80,
			}),
			createTextNode("b", {
				parentId: "board",
				x: 228,
				y: 64,
				width: 100,
				height: 80,
			}),
			createTextNode("c", {
				parentId: "board",
				x: 64,
				y: 208,
				width: 100,
				height: 80,
			}),
			createTextNode("moving", {
				parentId: "board",
				x: 420,
				y: 70,
				width: 80,
				height: 40,
			}),
		];

		const betweenChildren = resolveCanvasBoardAutoLayoutInsertion(
			nodes,
			"board",
			["moving"],
			{ x: 190, y: 80 },
		);
		expect(betweenChildren?.rows[0]).toEqual(["a", "moving", "b"]);
		expect(betweenChildren?.indicator).toMatchObject({
			orientation: "vertical",
			x1: 196,
			x2: 196,
		});

		const betweenRows = resolveCanvasBoardAutoLayoutInsertion(
			nodes,
			"board",
			["moving"],
			{ x: 100, y: 176 },
		);
		expect(betweenRows?.rows).toEqual([["a", "b"], ["moving"], ["c"]]);
		expect(betweenRows?.indicator).toMatchObject({
			orientation: "horizontal",
			y1: 176,
			y2: 176,
		});
	});
});
