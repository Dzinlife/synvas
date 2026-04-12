import { describe, expect, it } from "vitest";
import {
	buildLayerTreeOrder,
	allocateBatchInsertZIndex,
	allocateInsertZIndex,
	rebalanceSiblingZIndex,
	sortByLayerOrder,
} from "./layerOrderCoordinator";

interface TestNode {
	id: string;
	parentId: string | null;
	siblingOrder: number;
}

const createNode = (
	id: string,
	siblingOrder: number,
	parentId: string | null = null,
): TestNode => {
	return {
		id,
		parentId,
		siblingOrder,
	};
};

describe("layerOrderCoordinator", () => {
	it("sortByLayerOrder 使用 siblingOrder + id 稳定排序", () => {
		const nodes = [
			createNode("node-c", 1),
			createNode("node-a", 1),
			createNode("node-b", 0),
		];
		expect(sortByLayerOrder(nodes).map((node) => node.id)).toEqual([
			"node-b",
			"node-a",
			"node-c",
		]);
	});

	it("allocateInsertZIndex 可在相邻图层之间分配中间值", () => {
		const nodes = [createNode("left", 0), createNode("right", 1024)];
		const result = allocateInsertZIndex(nodes, {
			parentId: null,
			index: 1,
		});
		expect(result.rebalancePatches).toEqual([
			{
				nodeId: "right",
				siblingOrder: 2,
			},
		]);
		expect(result.siblingOrder).toBe(1);
	});

	it("allocateBatchInsertZIndex 会保持批量节点相对顺序", () => {
		const nodes = [createNode("left", 0), createNode("right", 1024)];
		const result = allocateBatchInsertZIndex(nodes, {
			parentId: null,
			index: 1,
			nodeIds: ["drag-1", "drag-2", "drag-3"],
		});
		expect(result.rebalancePatches).toHaveLength(1);
		expect(result.assignments.map((item) => item.nodeId)).toEqual([
			"drag-1",
			"drag-2",
			"drag-3",
		]);
		expect(result.assignments.map((item) => item.siblingOrder)).toEqual([
			1, 2, 3,
		]);
		expect(result.rebalancePatches).toEqual([
			{
				nodeId: "right",
				siblingOrder: 4,
			},
		]);
	});

	it("allocateInsertZIndex 会把稀疏同级序规整为连续整数", () => {
		const nodes = [createNode("left", 0), createNode("right", 99)];
		const result = allocateInsertZIndex(nodes, {
			parentId: null,
			index: 1,
		});
		expect(result.rebalancePatches).toEqual([
			{
				nodeId: "right",
				siblingOrder: 2,
			},
		]);
		expect(result.siblingOrder).toBe(1);
	});

	it("rebalanceSiblingZIndex 仅重排同级节点", () => {
		const nodes = [
			createNode("root-a", 10, null),
			createNode("child-a", 10, "frame-1"),
			createNode("child-b", 10, "frame-1"),
		];
		const patches = rebalanceSiblingZIndex(nodes, {
			parentId: "frame-1",
		});
		expect(patches.map((patch) => patch.nodeId)).toEqual([
			"child-a",
			"child-b",
		]);
		expect(patches.map((patch) => patch.siblingOrder)).toEqual([0, 1]);
	});

	it("buildLayerTreeOrder 使用父先子后的原子子树顺序", () => {
		const nodes = [
			createNode("root-a", 0, null),
			createNode("root-b", 1, null),
			createNode("child-a-1", 0, "root-a"),
			createNode("child-a-2", 1, "root-a"),
			createNode("child-b-1", 0, "root-b"),
		];
		const order = buildLayerTreeOrder(nodes);
		expect(order.paintNodeIds).toEqual([
			"root-a",
			"child-a-1",
			"child-a-2",
			"root-b",
			"child-b-1",
		]);
		expect(order.hitNodeIds).toEqual([
			"child-b-1",
			"root-b",
			"child-a-2",
			"child-a-1",
			"root-a",
		]);
	});
});
