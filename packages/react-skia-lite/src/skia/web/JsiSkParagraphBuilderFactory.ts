import type { CanvasKit } from "canvaskit-wasm";

import type {
  FontBlock,
  ParagraphBuilderFactory,
  ShapedLine,
  SkParagraphStyle,
  SkTypefaceFontProvider,
} from "../types";

import { Host } from "./Host";
import { JsiSkParagraphBuilder } from "./JsiSkParagraphBuilder";
import { normalizeShapedLines } from "./JsiSkParagraph";
import { JsiSkParagraphStyle } from "./JsiSkParagraphStyle";
import { JsiSkTypeface } from "./JsiSkTypeface";
import { JsiSkTypefaceFontProvider } from "./JsiSkTypefaceFontProvider";

export class JsiSkParagraphBuilderFactory
  extends Host
  implements ParagraphBuilderFactory
{
  constructor(CanvasKit: CanvasKit) {
    super(CanvasKit);
  }

  Make(
    paragraphStyle: SkParagraphStyle,
    typefaceProvider?: SkTypefaceFontProvider
  ) {
    const style = new this.CanvasKit.ParagraphStyle(
      JsiSkParagraphStyle.toParagraphStyle(this.CanvasKit, paragraphStyle ?? {})
    );
    if (typefaceProvider === undefined) {
      throw new Error(
        "SkTypefaceFontProvider is required on React Native Web."
      );
    }
    const fontCollection = this.CanvasKit.FontCollection.Make();
    fontCollection.setDefaultFontManager(
      JsiSkTypefaceFontProvider.fromValue(typefaceProvider)
    );
    fontCollection.enableFontFallback();

    return new JsiSkParagraphBuilder(
      this.CanvasKit,
      this.CanvasKit.ParagraphBuilder.MakeFromFontCollection(
        style,
        fontCollection
      )
    );
  }

  ShapeText(text: string, runs: FontBlock[], width?: number): ShapedLine[] {
    const shapedLines = this.CanvasKit.ParagraphBuilder.ShapeText(
      text,
      runs.map((run) => ({
        length: run.length,
        typeface: JsiSkTypeface.fromValue(run.typeface),
        size: run.size,
        fakeBold: run.fakeBold,
        fakeItalic: run.fakeItalic,
      })),
      width
    );
    return normalizeShapedLines(this.CanvasKit, shapedLines);
  }
}
