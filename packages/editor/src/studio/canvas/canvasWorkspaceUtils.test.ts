import type { SceneNode } from "core/studio/types";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_MIN_ZOOM,
	resolveDynamicMinZoom,
} from "./canvasWorkspaceUtils";

const createSceneNode = (overrides: Partial<SceneNode> = {}): SceneNode => {
	return {
		id: "node-scene",
		type: "scene",
		sceneId: "scene-1",
		name: "Scene",
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		zIndex: 0,
		locked: false,
		hidden: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
};

describe("resolveDynamicMinZoom", () => {
	const baseInput = {
		stageWidth: 1200,
		stageHeight: 800,
		safeInsets: {
			top: 12,
			right: 12,
			bottom: 12,
			left: 12,
		},
	};

	it("fitHalf 高于默认下限时保持默认值", () => {
		const minZoom = resolveDynamicMinZoom({
			...baseInput,
			nodes: [createSceneNode({ width: 200, height: 100 })],
		});
		expect(minZoom).toBe(DEFAULT_MIN_ZOOM);
	});

	it("包含 hidden 节点时 fitHalf 低于默认值会跟随动态值", () => {
		const minZoom = resolveDynamicMinZoom({
			...baseInput,
			nodes: [
				createSceneNode({ id: "visible-node", width: 100, height: 100 }),
				createSceneNode({
					id: "hidden-node",
					hidden: true,
					width: 8000,
					height: 100,
				}),
			],
		});
		expect(minZoom).toBeCloseTo(0.0735, 4);
		expect(minZoom).toBeLessThan(DEFAULT_MIN_ZOOM);
	});

	it("fitHalf 低于默认值时允许继续降低以俯瞰全局", () => {
		const minZoom = resolveDynamicMinZoom({
			...baseInput,
			nodes: [createSceneNode({ width: 12000, height: 100 })],
		});
		expect(minZoom).toBeCloseTo(0.049, 3);
		expect(minZoom).toBeLessThan(DEFAULT_MIN_ZOOM);
	});

	it("无节点时回退到默认下限", () => {
		const minZoom = resolveDynamicMinZoom({
			...baseInput,
			nodes: [],
		});
		expect(minZoom).toBe(DEFAULT_MIN_ZOOM);
	});
});
