import type { VideoCanvasNode } from "core/studio/types";
import { describe, expect, it } from "vitest";
import {
	resolveCanvasCameraTransformMatrix,
	resolveCanvasNodeLabelLayout,
	resolveCanvasNodeScreenFrame,
} from "./canvasNodeLabelUtils";

const createVideoNode = (
	patch: Partial<VideoCanvasNode> = {},
): VideoCanvasNode => ({
	id: "node-a",
	type: "video",
	name: "node-a",
	x: 20,
	y: 30,
	width: 160,
	height: 90,
	zIndex: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: "asset-a",
	...patch,
});

describe("canvasNodeLabelUtils", () => {
	it("screenWidth 会随 zoom 动态变化", () => {
		const node = createVideoNode({ width: 120, height: 60 });
		const zoomedOut = resolveCanvasNodeScreenFrame(node, {
			x: 0,
			y: 0,
			zoom: 0.5,
		});
		const zoomedIn = resolveCanvasNodeScreenFrame(node, {
			x: 0,
			y: 0,
			zoom: 2,
		});

		expect(zoomedOut.width).toBe(60);
		expect(zoomedIn.width).toBe(240);
	});

	it("label 可用宽度只受 node 屏幕宽度限制，不会吸附到右侧边缘", () => {
		const layout = resolveCanvasNodeLabelLayout({
			frame: {
				x: 260,
				y: 80,
				width: 120,
				height: 60,
				right: 380,
				bottom: 140,
			},
			badgeHeight: 24,
			gap: 8,
		});

		expect(layout).toEqual({
			x: 260,
			y: 48,
			availableWidth: 120,
		});
	});

	it("顶部越界时保持理想位置，不做 sticky clamp", () => {
		const layout = resolveCanvasNodeLabelLayout({
			frame: {
				x: 24,
				y: 10,
				width: 100,
				height: 60,
				right: 124,
				bottom: 70,
			},
			badgeHeight: 24,
			gap: 8,
		});

		expect(layout?.y).toBe(-22);
		expect(layout?.x).toBe(24);
	});

	it("camera matrix 与 world->screen 公式保持先平移再缩放", () => {
		const node = createVideoNode({
			x: 40,
			y: 25,
			width: 120,
			height: 60,
		});
		const camera = {
			x: 24,
			y: -12,
			zoom: 1.25,
		};
		const frame = resolveCanvasNodeScreenFrame(node, camera);
		const transform = resolveCanvasCameraTransformMatrix(camera);
		const matrix = transform[0]?.matrix;
		if (!matrix) {
			throw new Error("camera matrix 缺失");
		}
		const mappedTopLeft = {
			x: matrix[0] * node.x + matrix[1] * node.y + matrix[3],
			y: matrix[4] * node.x + matrix[5] * node.y + matrix[7],
		};

		expect(frame.x).toBe((node.x + camera.x) * camera.zoom);
		expect(frame.y).toBe((node.y + camera.y) * camera.zoom);
		expect(mappedTopLeft).toEqual({
			x: frame.x,
			y: frame.y,
		});
	});
});
