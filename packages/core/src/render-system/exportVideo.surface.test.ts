// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	createSkiaCanvasSurfaceMock,
	getSkiaRenderBackendMock,
} = vi.hoisted(() => ({
	createSkiaCanvasSurfaceMock: vi.fn(),
	getSkiaRenderBackendMock: vi.fn(),
}));

vi.mock("react-skia-lite", () => ({
	createSkiaCanvasSurface: createSkiaCanvasSurfaceMock,
	getSkiaRenderBackend: getSkiaRenderBackendMock,
	JsiSkSurface: class {},
	Skia: { id: "skia" },
	SkiaSGRoot: class {},
}));

import { __createSurfaceForExportForTests } from "./exportVideo";

describe("exportVideo surface selection", () => {
	beforeEach(() => {
		createSkiaCanvasSurfaceMock.mockReset();
		getSkiaRenderBackendMock.mockReset();
		(globalThis as { CanvasKit?: unknown }).CanvasKit = { id: "canvaskit" };
	});

	it.each([
		{ bundle: "webgpu", kind: "webgpu" },
		{ bundle: "webgl", kind: "webgl" },
	] as const)(
		"resolved backend 为 $kind 时会走统一 surface 工厂",
		({ bundle, kind }) => {
			const surface = { dispose: vi.fn() };
			getSkiaRenderBackendMock.mockReturnValue({ bundle, kind });
			createSkiaCanvasSurfaceMock.mockReturnValue(surface);
			const canvas = document.createElement("canvas");

			const result = __createSurfaceForExportForTests(canvas, 640, 360);

			expect(canvas.width).toBe(640);
			expect(canvas.height).toBe(360);
			expect(createSkiaCanvasSurfaceMock).toHaveBeenCalledWith(
				(globalThis as { CanvasKit?: unknown }).CanvasKit,
				canvas,
				{ bundle, kind },
				{ colorSpace: "srgb" },
			);
			expect(result).toEqual({
				surface,
				canvas,
			});
		},
	);
});
