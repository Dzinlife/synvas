import type { CanvasKit, Surface } from "canvaskit-wasm";

import type { SkCanvas, SkImage, SkRect, SkSurface } from "../types";

import { HostObject } from "./Host";
import { JsiSkCanvas } from "./JsiSkCanvas";
import { JsiSkImage } from "./JsiSkImage";
import { JsiSkRect } from "./JsiSkRect";

export class JsiSkSurface
  extends HostObject<Surface, "Surface">
  implements SkSurface
{
  private cleanup?: () => void;

  constructor(CanvasKit: CanvasKit, ref: Surface, cleanup?: () => void) {
    super(CanvasKit, ref, "Surface");
    this.cleanup = cleanup;
  }

  [Symbol.dispose]() {
    const ref = this.ref;
    this.ref = null as unknown as Surface;
    try {
      if (ref && typeof ref.dispose === "function") {
        ref.dispose();
      } else if (ref && typeof ref.delete === "function") {
        ref.delete();
      }
    } finally {
      this.cleanup?.();
      this.cleanup = undefined;
    }
  }

  flush() {
    this.ref.flush();
  }

  width() {
    return this.ref.width();
  }

  height() {
    return this.ref.height();
  }

  getCanvas(): SkCanvas {
    return new JsiSkCanvas(this.CanvasKit, this.ref.getCanvas());
  }

  makeImageSnapshot(bounds?: SkRect, outputImage?: JsiSkImage): SkImage {
    const image = this.ref.makeImageSnapshot(
      bounds
        ? Array.from(JsiSkRect.fromValue(this.CanvasKit, bounds))
        : undefined
    );
    if (outputImage) {
      outputImage.ref = image;
    }
    return new JsiSkImage(this.CanvasKit, image);
  }

  getNativeTextureUnstable(): unknown {
    console.warn("getBackendTexture is not implemented on Web");
    return null;
  }
}
