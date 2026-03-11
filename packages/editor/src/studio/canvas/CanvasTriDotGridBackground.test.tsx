// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CanvasTriDotGridBackground,
	resolveDotGridLod,
	TRI_DOT_GRID_SHADER_CODE,
} from "./CanvasTriDotGridBackground";

const mocks = vi.hoisted(() => ({
	runtimeEffectMake: vi.fn<() => { type: string } | null>(() => ({
		type: "runtime-effect",
	})),
}));

vi.mock("react-skia-lite", () => ({
	useDerivedValue: <T,>(updater: () => T) => ({
		value: updater(),
		_isSharedValue: true as const,
	}),
	Rect: ({
		children,
		...props
	}: {
		children?: React.ReactNode;
		[key: string]: unknown;
	}) => (
		<div data-testid="grid-rect" data-props={JSON.stringify(props)}>
			{children}
		</div>
	),
	Shader: (props: Record<string, unknown>) => {
		const normalizedProps = {
			...props,
			uniforms:
				typeof props.uniforms === "object" &&
				props.uniforms !== null &&
				"value" in props.uniforms
					? (props.uniforms as { value: unknown }).value
					: props.uniforms,
		};
		return (
			<div
				data-testid="grid-shader"
				data-props={JSON.stringify(normalizedProps)}
			/>
		);
	},
	Skia: {
		RuntimeEffect: {
			Make: mocks.runtimeEffectMake,
		},
	},
}));

const readProps = <T,>(testId: string): T => {
	const raw = screen.getByTestId(testId).getAttribute("data-props") ?? "{}";
	return JSON.parse(raw) as T;
};

describe("CanvasTriDotGridBackground", () => {
	beforeEach(() => {
		mocks.runtimeEffectMake.mockReset();
		mocks.runtimeEffectMake.mockReturnValue({ type: "runtime-effect" });
	});

	afterEach(() => {
		cleanup();
	});

	it("resolveDotGridLod 在 2x 边界前后给出正确 level 与 fade", () => {
		expect(resolveDotGridLod(1)).toEqual({ level: 0, fade: 0 });

		const nearTwo = resolveDotGridLod(1.99);
		expect(nearTwo.level).toBe(0);
		expect(nearTwo.fade).toBeGreaterThan(0.95);

		expect(resolveDotGridLod(2)).toEqual({ level: 1, fade: 0 });
	});

	it("会把 camera 与 LOD 信息映射到 shader uniforms", () => {
		render(
			<CanvasTriDotGridBackground
				width={800}
				height={600}
				camera={{ x: 12, y: -8, zoom: 1.5 }}
			/>,
		);

		expect(mocks.runtimeEffectMake).toHaveBeenCalledWith(
			TRI_DOT_GRID_SHADER_CODE,
		);

		expect(readProps<{ width: number; height: number }>("grid-rect")).toEqual(
			expect.objectContaining({ width: 800, height: 600 }),
		);

		const shaderProps = readProps<{
			uniforms: {
				uResolution: [number, number];
				uCamera: [number, number];
				uZoom: number;
				uLevel: number;
				uFade: number;
				uCameraParallaxFactor: number;
			};
		}>("grid-shader");
		expect(shaderProps.uniforms.uResolution).toEqual([800, 600]);
		expect(shaderProps.uniforms.uCamera).toEqual([12, -8]);
		expect(shaderProps.uniforms.uZoom).toBe(1.5);
		expect(shaderProps.uniforms.uLevel).toBe(0);
		expect(shaderProps.uniforms.uFade).toBeGreaterThan(0);
		expect(shaderProps.uniforms.uFade).toBeLessThan(1);
		expect(shaderProps.uniforms.uCameraParallaxFactor).toBe(0.9);
	});

	it("RuntimeEffect 创建失败时不渲染背景", () => {
		mocks.runtimeEffectMake.mockReturnValueOnce(null);

		const { queryByTestId } = render(
			<CanvasTriDotGridBackground
				width={800}
				height={600}
				camera={{ x: 0, y: 0, zoom: 1 }}
			/>,
		);

		expect(queryByTestId("grid-rect")).toBeNull();
		expect(queryByTestId("grid-shader")).toBeNull();
	});
});
