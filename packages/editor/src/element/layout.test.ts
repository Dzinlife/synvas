import type { TransformMeta } from "core/element/types";
import { describe, expect, it } from "vitest";
import {
	renderLayoutToTopLeft,
	resolveTransformToRenderLayout,
} from "./layout";

describe("layout transform semantics", () => {
	it("renderLayoutToTopLeft 应保持旋转中心不变", () => {
		const layout = {
			cx: 300,
			cy: 400,
			w: 200,
			h: 100,
			rotation: Math.PI / 3,
		};

		const topLeft = renderLayoutToTopLeft(layout);
		const halfWidth = topLeft.width / 2;
		const halfHeight = topLeft.height / 2;
		const cos = Math.cos(topLeft.rotation);
		const sin = Math.sin(topLeft.rotation);
		const centerX = topLeft.x + halfWidth * cos - halfHeight * sin;
		const centerY = topLeft.y + halfWidth * sin + halfHeight * cos;

		expect(centerX).toBeCloseTo(layout.cx, 6);
		expect(centerY).toBeCloseTo(layout.cy, 6);
	});

	it("resolveTransformToRenderLayout 中 (0,0) 映射到画布中心，且不受 anchor 影响", () => {
		const baseTransform: Omit<TransformMeta, "anchor"> = {
			baseSize: { width: 200, height: 100 },
			position: { x: 0, y: 0, space: "canvas" },
			scale: { x: 1.2, y: 0.8 },
			rotation: { value: 30, unit: "deg" },
			distort: { type: "none" },
		};

		const anchorA: TransformMeta = {
			...baseTransform,
			anchor: { x: 0, y: 0, space: "normalized" },
		};
		const anchorB: TransformMeta = {
			...baseTransform,
			anchor: { x: 1, y: 1, space: "normalized" },
		};

		const picture = { width: 1920, height: 1080 };
		const canvas = { width: 1920, height: 1080 };
		const layoutA = resolveTransformToRenderLayout(anchorA, picture, canvas);
		const layoutB = resolveTransformToRenderLayout(anchorB, picture, canvas);

		expect(layoutA.cx).toBeCloseTo(960, 6);
		expect(layoutA.cy).toBeCloseTo(540, 6);
		expect(layoutA.cx).toBeCloseTo(layoutB.cx, 6);
		expect(layoutA.cy).toBeCloseTo(layoutB.cy, 6);
		expect(layoutA.w).toBeCloseTo(layoutB.w, 6);
		expect(layoutA.h).toBeCloseTo(layoutB.h, 6);
	});

	it("resolveTransformToRenderLayout 中 position.y 正向向上", () => {
		const baseTransform: Omit<TransformMeta, "anchor"> = {
			baseSize: { width: 200, height: 100 },
			position: { x: 0, y: 100, space: "canvas" },
			scale: { x: 1, y: 1 },
			rotation: { value: 0, unit: "deg" },
			distort: { type: "none" },
		};

		const transform: TransformMeta = {
			...baseTransform,
			anchor: { x: 0.5, y: 0.5, space: "normalized" },
		};
		const picture = { width: 1920, height: 1080 };
		const canvas = { width: 1920, height: 1080 };
		const layout = resolveTransformToRenderLayout(transform, picture, canvas);

		expect(layout.cx).toBeCloseTo(960, 6);
		expect(layout.cy).toBeCloseTo(440, 6);
	});
});
