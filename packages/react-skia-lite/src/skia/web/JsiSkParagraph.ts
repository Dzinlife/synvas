import type {
  CanvasKit,
  GlyphInfo as CanvasKitGlyphInfo,
  GlyphRun as CanvasKitGlyphRun,
  Paragraph,
  ShapedLine as CanvasKitShapedLine,
} from "canvaskit-wasm";

import type {
  GlyphInfo,
  GlyphRun,
  ShapedLine,
  SkRect,
  SkRectWithDirection,
  SkParagraph,
  LineMetrics,
} from "../types";

import { HostObject } from "./Host";
import type { JsiSkCanvas } from "./JsiSkCanvas";
import { JsiSkRect } from "./JsiSkRect";
import { JsiSkTypeface } from "./JsiSkTypeface";

const resolveTextDirection = (
  direction: { value: number } | number
): number => (typeof direction === "number" ? direction : direction.value);

const normalizeGlyphInfo = (
  CanvasKit: CanvasKit,
  value: CanvasKitGlyphInfo | null
): GlyphInfo | null => {
  if (value === null) {
    return null;
  }
  return {
    graphemeLayoutBounds: new JsiSkRect(CanvasKit, value.graphemeLayoutBounds),
    graphemeClusterTextRange: value.graphemeClusterTextRange,
    dir: resolveTextDirection(value.dir),
    isEllipsis: value.isEllipsis,
  };
};

const normalizeGlyphRun = (
  CanvasKit: CanvasKit,
  run: CanvasKitGlyphRun
): GlyphRun => ({
  typeface: run.typeface ? new JsiSkTypeface(CanvasKit, run.typeface) : null,
  size: run.size,
  fakeBold: run.fakeBold,
  fakeItalic: run.fakeItalic,
  glyphs: run.glyphs,
  positions: run.positions,
  offsets: run.offsets,
  flags: run.flags,
});

export const normalizeShapedLines = (
  CanvasKit: CanvasKit,
  lines: CanvasKitShapedLine[]
): ShapedLine[] =>
  lines.map((line) => ({
    textRange: line.textRange,
    top: line.top,
    bottom: line.bottom,
    baseline: line.baseline,
    runs: line.runs.map((run) => normalizeGlyphRun(CanvasKit, run)),
  }));

export class JsiSkParagraph
  extends HostObject<Paragraph, "Paragraph">
  implements SkParagraph
{
  constructor(CanvasKit: CanvasKit, ref: Paragraph) {
    super(CanvasKit, ref, "Paragraph");
  }
  getMinIntrinsicWidth() {
    return this.ref.getMinIntrinsicWidth();
  }

  getMaxIntrinsicWidth() {
    return this.ref.getMaxIntrinsicWidth();
  }

  getLongestLine() {
    return this.ref.getLongestLine();
  }

  layout(width: number) {
    this.ref.layout(width);
  }
  paint(canvas: JsiSkCanvas, x: number, y: number) {
    canvas.ref.drawParagraph(this.ref, x, y);
  }
  getHeight() {
    return this.ref.getHeight();
  }
  getMaxWidth() {
    return this.ref.getMaxWidth();
  }
  getGlyphPositionAtCoordinate(x: number, y: number) {
    return this.ref.getGlyphPositionAtCoordinate(x, y).pos;
  }
  getClosestGlyphInfoAtCoordinate(x: number, y: number) {
    return normalizeGlyphInfo(
      this.CanvasKit,
      this.ref.getClosestGlyphInfoAtCoordinate(x, y)
    );
  }
  getGlyphInfoAt(index: number) {
    return normalizeGlyphInfo(this.CanvasKit, this.ref.getGlyphInfoAt(index));
  }
  getRectsForPlaceholders(): SkRectWithDirection[] {
    return this.ref.getRectsForPlaceholders().map(({ rect, dir }) => ({
      rect: new JsiSkRect(this.CanvasKit, rect),
      direction: dir.value,
    }));
  }
  getRectsForRange(start: number, end: number): SkRect[] {
    return this.ref
      .getRectsForRange(
        start,
        end,
        { value: 0 } /** kTight */,
        { value: 0 } /** kTight */
      )
      .map(({ rect }) => new JsiSkRect(this.CanvasKit, rect));
  }
  getLineMetrics(): LineMetrics[] {
    return this.ref.getLineMetrics();
  }
  getShapedLines(): ShapedLine[] {
    return normalizeShapedLines(this.CanvasKit, this.ref.getShapedLines());
  }
}
