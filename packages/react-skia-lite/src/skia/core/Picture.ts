import { Skia } from "../Skia";
import type { SkCanvas, SkRect, SkSize } from "../types";
import { isRect } from "../types";

/**
 * Memoizes and returns an SkPicture that can be drawn to another canvas.
 * @param rect Picture bounds
 * @param cb Callback for drawing to the canvas
 * @returns SkPicture
 */
export const createPicture = (
  cb: (canvas: SkCanvas) => void,
  rect?: SkRect | SkSize
) => {
  "worklet";
  const recorder = Skia.PictureRecorder();
  let canvas: SkCanvas | null = null;
  try {
    let bounds: undefined | SkRect;
    if (rect) {
      bounds = isRect(rect) ? rect : Skia.XYWHRect(0, 0, rect.width, rect.height);
    }
    canvas = recorder.beginRecording(bounds);
    cb(canvas);
    return recorder.finishRecordingAsPicture();
  } finally {
    (canvas as { dispose?: () => void } | null)?.dispose?.();
    recorder.dispose?.();
  }
};
