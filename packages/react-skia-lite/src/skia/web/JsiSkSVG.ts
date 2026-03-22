import type { CanvasKit } from "canvaskit-wasm";

import type { SkSVG } from "../types";

import { HostObject, SKIA_DISPOSE_SYMBOL } from "./Host";

export class JsiSkSVG
  extends HostObject<HTMLImageElement, "SVG">
  implements SkSVG
{
  constructor(CanvasKit: CanvasKit, ref: HTMLImageElement) {
    super(CanvasKit, ref, "SVG");
  }

  width(): number {
    return this.ref.width;
  }
  height(): number {
    return this.ref.height;
  }

  [SKIA_DISPOSE_SYMBOL]() {
    if (this.ref.parentNode) {
      this.ref.parentNode.removeChild(this.ref);
    }
  }
}
