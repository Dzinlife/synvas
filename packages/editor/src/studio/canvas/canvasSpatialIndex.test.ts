import type { CanvasNode } from "@/studio/project/types";
import { describe, expect, it } from "vitest";
import {
	CanvasSpatialIndex,
	compareCanvasSpatialHitPriority,
	compareCanvasSpatialPaintOrder,
} from "./canvasSpatialIndex";

interface CreateNodeInput {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	siblingOrder?: number;
	createdAt?: number;
	hidden?: boolean;
}

const createCanvasNode = (input: CreateNodeInput): CanvasNode => {
	const createdAt = input.createdAt ?? 1;
	return {
		id: input.id,
		type: "video",
		name: input.id,
		x: input.x,
		y: input.y,
		width: input.width,
		height: input.height,
		siblingOrder: input.siblingOrder ?? 0,
		locked: false,
		hidden: input.hidden ?? false,
		createdAt,
		updatedAt: createdAt,
		assetId: `asset-${input.id}`,
	};
};

describe("canvasSpatialIndex", () => {
	it("point query 在重叠节点中可按命中优先级排序", () => {
		const index = new CanvasSpatialIndex();
		index.sync([
			createCanvasNode({
				id: "node-a",
				x: 0,
				y: 0,
				width: 120,
				height: 80,
				siblingOrder: 0,
				createdAt: 1,
			}),
			createCanvasNode({
				id: "node-b",
				x: 0,
				y: 0,
				width: 120,
				height: 80,
				siblingOrder: 2,
				createdAt: 2,
			}),
			createCanvasNode({
				id: "node-c",
				x: 0,
				y: 0,
				width: 120,
				height: 80,
				siblingOrder: 2,
				createdAt: 3,
			}),
		]);

		const hitIds = index
			.queryPoint(40, 20)
			.sort(compareCanvasSpatialHitPriority)
			.map((item) => item.nodeId);
		expect(hitIds).toEqual(["node-c", "node-b", "node-a"]);

		const paintIds = index
			.queryPoint(40, 20)
			.sort(compareCanvasSpatialPaintOrder)
			.map((item) => item.nodeId);
		expect(paintIds).toEqual(["node-a", "node-b", "node-c"]);
	});

	it("rect query 可正确处理负宽高节点", () => {
		const index = new CanvasSpatialIndex();
		index.sync([
			createCanvasNode({
				id: "node-negative",
				x: 100,
				y: 100,
				width: -40,
				height: -30,
				siblingOrder: 1,
			}),
			createCanvasNode({
				id: "node-far",
				x: 240,
				y: 240,
				width: 50,
				height: 50,
				siblingOrder: 2,
			}),
		]);

		const rectIds = index
			.queryRect({
				left: 90,
				right: 70,
				top: 95,
				bottom: 75,
			})
			.sort(compareCanvasSpatialPaintOrder)
			.map((item) => item.nodeId);
		expect(rectIds).toEqual(["node-negative"]);
	});

	it("hidden 节点不会进入索引查询结果", () => {
		const index = new CanvasSpatialIndex();
		index.sync([
			createCanvasNode({
				id: "node-visible",
				x: 0,
				y: 0,
				width: 100,
				height: 60,
				siblingOrder: 0,
			}),
			createCanvasNode({
				id: "node-hidden",
				x: 0,
				y: 0,
				width: 100,
				height: 60,
				siblingOrder: 1,
				hidden: true,
			}),
		]);

		const ids = index
			.queryRect({
				left: -10,
				right: 120,
				top: -10,
				bottom: 120,
			})
			.sort(compareCanvasSpatialPaintOrder)
			.map((item) => item.nodeId);
		expect(ids).toEqual(["node-visible"]);
	});

	it("sync 会正确处理增量更新（移动、隐藏、删除、新增）", () => {
		const index = new CanvasSpatialIndex();
		const baseNodes = [
			createCanvasNode({
				id: "node-a",
				x: 0,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 0,
				createdAt: 1,
			}),
			createCanvasNode({
				id: "node-b",
				x: 100,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 1,
				createdAt: 2,
			}),
		];
		index.sync(baseNodes);

		index.sync([
			createCanvasNode({
				id: "node-a",
				x: 220,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 0,
				createdAt: 1,
			}),
			createCanvasNode({
				id: "node-b",
				x: 100,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 1,
				createdAt: 2,
				hidden: true,
			}),
			createCanvasNode({
				id: "node-c",
				x: 320,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 2,
				createdAt: 3,
			}),
		]);

		const afterUpdateIds = index
			.queryRect({
				left: -10,
				right: 500,
				top: -10,
				bottom: 200,
			})
			.sort(compareCanvasSpatialPaintOrder)
			.map((item) => item.nodeId);
		expect(afterUpdateIds).toEqual(["node-a", "node-c"]);
		expect(index.queryPoint(260, 20).map((item) => item.nodeId)).toContain(
			"node-a",
		);

		index.sync([
			createCanvasNode({
				id: "node-b",
				x: 100,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 1,
				createdAt: 2,
			}),
			createCanvasNode({
				id: "node-c",
				x: 320,
				y: 0,
				width: 80,
				height: 60,
				siblingOrder: 2,
				createdAt: 3,
			}),
		]);

		const afterDeleteIds = index
			.queryRect({
				left: -10,
				right: 500,
				top: -10,
				bottom: 200,
			})
			.sort(compareCanvasSpatialPaintOrder)
			.map((item) => item.nodeId);
		expect(afterDeleteIds).toEqual(["node-b", "node-c"]);
	});

	it("变更比例超过阈值时触发重建，低于阈值时保持增量更新", () => {
		const index = new CanvasSpatialIndex();
		const createNodes = (offsetXById: Record<string, number> = {}) => {
			return Array.from({ length: 10 }, (_, itemIndex) => {
				const nodeId = `node-${itemIndex}`;
				const baseX = itemIndex * 100;
				return createCanvasNode({
					id: nodeId,
					x: baseX + (offsetXById[nodeId] ?? 0),
					y: 0,
					width: 80,
					height: 60,
					siblingOrder: itemIndex,
					createdAt: itemIndex,
				});
			});
		};

		index.sync(createNodes());
		const beforeRebuildRefs = new Map(
			index
				.queryRect({
					left: -100,
					right: 3000,
					top: -100,
					bottom: 500,
				})
				.map((item) => [item.nodeId, item] as const),
		);

		index.sync(
			createNodes({
				"node-0": 500,
				"node-1": 500,
				"node-2": 500,
				"node-3": 500,
			}),
		);
		const afterRebuildRefs = new Map(
			index
				.queryRect({
					left: -100,
					right: 3000,
					top: -100,
					bottom: 500,
				})
				.map((item) => [item.nodeId, item] as const),
		);

		expect(afterRebuildRefs.get("node-9")).not.toBe(
			beforeRebuildRefs.get("node-9"),
		);

		index.sync(
			createNodes({
				"node-0": 500,
				"node-1": 500,
				"node-2": 500,
				"node-3": 500,
				"node-4": 120,
			}),
		);
		const afterIncrementalRefs = new Map(
			index
				.queryRect({
					left: -100,
					right: 3000,
					top: -100,
					bottom: 500,
				})
				.map((item) => [item.nodeId, item] as const),
		);

		expect(afterIncrementalRefs.get("node-9")).toBe(
			afterRebuildRefs.get("node-9"),
		);
	});
});
