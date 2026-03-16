import { describe, expect, it } from "vitest";

import { getEnum } from "../src/skia/web/Host";

describe("getEnum", () => {
	it("兼容 CanvasKit 新枚举形态里的 values 映射和 undefined 属性", () => {
		const srcOver = { value: 3, name: "SrcOver" };
		const dstOver = { value: 4, name: "DstOver" };
		const blendMode = Object.assign(() => undefined, {
			values: {
				3: srcOver,
				4: dstOver,
			},
			ke: undefined,
			SrcOver: srcOver,
			DstOver: dstOver,
		});

		const result = getEnum(
			{ BlendMode: blendMode } as never,
			"BlendMode" as never,
			3,
		);

		expect(result).toBe(srcOver);
	});
});
