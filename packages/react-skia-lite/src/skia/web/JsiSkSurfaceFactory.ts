import type { CanvasKit } from "canvaskit-wasm";

import type { SurfaceFactory } from "../types";

import { Host } from "./Host";
import { JsiSkSurface } from "./JsiSkSurface";
import { createSkiaOffscreenSurface } from "./surfaceFactory";

export class JsiSkSurfaceFactory extends Host implements SurfaceFactory {
	constructor(CanvasKit: CanvasKit) {
		super(CanvasKit);
	}

	Make(width: number, height: number) {
		return new JsiSkSurface(
			this.CanvasKit,
			this.CanvasKit.MakeSurface(width, height)!,
		);
	}

	MakeOffscreen(width: number, height: number, pixelRatio?: number) {
		return createSkiaOffscreenSurface(
			this.CanvasKit,
			width,
			height,
			undefined,
			pixelRatio,
		);
	}
}
