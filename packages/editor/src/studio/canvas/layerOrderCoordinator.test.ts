import { describe, expect, it } from "vitest";
import {
	allocateBatchInsertZIndex,
	allocateInsertZIndex,
	rebalanceSiblingZIndex,
	sortByLayerOrder,
} from "./layerOrderCoordinator";

interface TestNode {
	id: string;
	parentId: string | null;
	zIndex: number;
}

const createNode = (
	id: string,
	zIndex: number,
	parentId: string | null = null,
): TestNode => {
	return {
		id,
		parentId,
		zIndex,
	};
};

describe("layerOrderCoordinator", () => {
	it("sortByLayerOrder 使用 zIndex + id 稳定排序", () => {
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
		expect(result.rebalancePatches).toHaveLength(0);
		expect(result.zIndex).toBe(512);
	});

	it("allocateBatchInsertZIndex 会保持批量节点相对顺序", () => {
		const nodes = [createNode("left", 0), createNode("right", 1024)];
		const result = allocateBatchInsertZIndex(nodes, {
			parentId: null,
			index: 1,
			nodeIds: ["drag-1", "drag-2", "drag-3"],
		});
		expect(result.rebalancePatches).toHaveLength(0);
		expect(result.assignments.map((item) => item.nodeId)).toEqual([
			"drag-1",
			"drag-2",
			"drag-3",
		]);
		expect(result.assignments.map((item) => item.zIndex)).toEqual([
			256, 512, 768,
		]);
	});

	it("allocateInsertZIndex 间隙不足时会触发同级 rebalance", () => {
		const nodes = [createNode("left", 0), createNode("right", 1e-8)];
		const result = allocateInsertZIndex(nodes, {
			parentId: null,
			index: 1,
		});
		expect(result.rebalancePatches.length).toBeGreaterThan(0);
		expect(result.zIndex).toBeGreaterThan(0);
		expect(result.zIndex).toBeLessThan(1024);
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
	});
});
