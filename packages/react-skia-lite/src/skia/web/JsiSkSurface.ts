import type { CanvasKit, Surface } from "canvaskit-wasm";

import type { SkCanvas, SkImage, SkRect, SkSurface } from "../types";

import {
  HostObject,
  SKIA_DISPOSE_SYMBOL,
} from "./Host";
import { JsiSkCanvas } from "./JsiSkCanvas";
import { JsiSkImage } from "./JsiSkImage";
import { JsiSkRect } from "./JsiSkRect";
import { toCanvasKitWebGPU } from "./renderBackend";

export class JsiSkSurface
  extends HostObject<Surface, "Surface">
  implements SkSurface
{
  private cleanup?: () => void;
  private canvas: JsiSkCanvas | null = null;

  private setSurfaceCurrentContextIfNeeded(ref: Surface | null | undefined) {
    if (!ref || typeof ref !== "object") {
      return;
    }
    const contextHandle = (ref as Surface & { _context?: unknown })._context;
    if (contextHandle === undefined || contextHandle === null) {
      return;
    }
    const canvasKitWithContext = this.CanvasKit as CanvasKit & {
      setCurrentContext?: (context: unknown) => boolean;
    };
    canvasKitWithContext.setCurrentContext?.(contextHandle);
  }

  constructor(
    CanvasKit: CanvasKit,
    ref: Surface,
    cleanup?: () => void,
  ) {
    super(CanvasKit, ref, "Surface");
    this.cleanup = cleanup;
  }

  [SKIA_DISPOSE_SYMBOL]() {
    const canvas = this.canvas;
    this.canvas = null;
    canvas?.dispose?.();
    const ref = this.ref;
    this.ref = null as unknown as Surface;
    try {
      this.setSurfaceCurrentContextIfNeeded(ref);
      if (ref && typeof ref.dispose === "function") {
        ref.dispose();
      } else if (ref && typeof ref.delete === "function") {
        ref.delete();
      }
    } finally {
      super[SKIA_DISPOSE_SYMBOL]();
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
    if (this.canvas && this.canvas.ref) {
      return this.canvas;
    }
    const nextCanvas = new JsiSkCanvas(this.CanvasKit, this.ref.getCanvas(), {
      ownsRef: false,
    });
    this.canvas = nextCanvas;
    return nextCanvas;
  }

  asImage(bounds?: SkRect): SkImage | null {
    this.setSurfaceCurrentContextIfNeeded(this.ref);
    const subset = bounds
      ? Array.from(JsiSkRect.fromValue(this.CanvasKit, bounds))
      : undefined;
    const image = bounds
      ? toCanvasKitWebGPU(this.CanvasKit).SkSurfaces?.AsImageCopy?.(
          this.ref,
          subset,
          false
        ) ?? this.ref.makeImageSnapshot(subset)
      : toCanvasKitWebGPU(this.CanvasKit).SkSurfaces?.AsImage?.(this.ref) ??
        this.ref.makeImageSnapshot();
    return image ? new JsiSkImage(this.CanvasKit, image) : null;
  }

  asImageCopy(bounds?: SkRect, mipmapped = false): SkImage | null {
    this.setSurfaceCurrentContextIfNeeded(this.ref);
    const subset = bounds
      ? Array.from(JsiSkRect.fromValue(this.CanvasKit, bounds))
      : undefined;
    const image =
      toCanvasKitWebGPU(this.CanvasKit).SkSurfaces?.AsImageCopy?.(
        this.ref,
        subset,
        mipmapped
      ) ??
      this.ref.makeImageSnapshot(subset);
    return image ? new JsiSkImage(this.CanvasKit, image) : null;
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
}
