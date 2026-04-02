import {
  isPathDef,
  isStringPathDef,
  processPath,
  processTransformProps2,
} from "../../../dom/nodes";
import type { ClipDef, CTMProps } from "../../../dom/types";
import type { Skia, SkPath, SkRect, SkRRect } from "../../../skia/types";
import { ClipOp, isRRect } from "../../../skia/types";
import type { DrawingContext } from "../DrawingContext";

const computeClip = (
  Skia: Skia,
  clip: ClipDef | undefined
):
  | undefined
  | { clipPath: SkPath; shouldDisposeClipPath: boolean }
  | { clipRect: SkRect }
  | { clipRRect: SkRRect } => {
  "worklet";
  if (clip) {
    if (isPathDef(clip)) {
      return {
        clipPath: processPath(Skia, clip),
        shouldDisposeClipPath: isStringPathDef(clip),
      };
    } else if (isRRect(clip)) {
      return { clipRRect: clip };
    } else {
      return { clipRect: clip };
    }
  }
  return undefined;
};

export const saveCTM = (ctx: DrawingContext, props: CTMProps) => {
  "worklet";
  const { canvas, Skia } = ctx;
	const {
		clip: rawClip,
		invertClip,
		matrix,
		transform,
		origin,
		translateX,
		translateY,
		scale,
		scaleX,
		scaleY,
		rotate,
		rotateZ,
		layer,
	} = props as CTMProps;
	const hasTransform =
		matrix !== undefined ||
		transform !== undefined ||
		translateX !== undefined ||
		translateY !== undefined ||
		scale !== undefined ||
		scaleX !== undefined ||
		scaleY !== undefined ||
		rotate !== undefined ||
		rotateZ !== undefined;
	const clip = computeClip(Skia, rawClip);
	const hasClip = clip !== undefined;
	const op = invertClip ? ClipOp.Difference : ClipOp.Intersect;
	const m3 = processTransformProps2(Skia, {
		matrix,
		transform,
		origin,
		translateX,
		translateY,
		scale,
		scaleX,
		scaleY,
		rotate,
		rotateZ,
	});
  const shouldSave = hasTransform || hasClip || !!layer;
  if (shouldSave) {
    if (layer) {
      if (typeof layer === "boolean") {
        canvas.saveLayer();
      } else {
        canvas.saveLayer(layer);
      }
    } else {
      canvas.save();
    }
  }
  if (m3) {
    try {
      canvas.concat(m3);
    } finally {
      ctx.queueDispose(m3);
    }
  }
  if (clip) {
    if ("clipRect" in clip) {
      canvas.clipRect(clip.clipRect, op, true);
    } else if ("clipRRect" in clip) {
      canvas.clipRRect(clip.clipRRect, op, true);
    } else {
      try {
        canvas.clipPath(clip.clipPath, op, true);
      } finally {
        if (clip.shouldDisposeClipPath) {
          ctx.queueDispose(clip.clipPath);
        }
      }
    }
  }
};
