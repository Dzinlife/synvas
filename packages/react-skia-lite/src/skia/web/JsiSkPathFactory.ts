import type { CanvasKit } from "canvaskit-wasm";

import type {
  PathCommand,
  PathOp,
  SkFont,
  SkPath,
  SkPoint,
  SkRSXform,
} from "../types";
import type { PathFactory } from "../types/Path/PathFactory";

import { Host, getEnum } from "./Host";
import { JsiSkFont } from "./JsiSkFont";
import { JsiSkPath } from "./JsiSkPath";
import { JsiSkRSXform } from "./JsiSkRSXform";

export class JsiSkPathFactory extends Host implements PathFactory {
  constructor(CanvasKit: CanvasKit) {
    super(CanvasKit);
  }

  Make() {
    return new JsiSkPath(this.CanvasKit, new this.CanvasKit.Path());
  }

  MakeFromSVGString(str: string) {
    const path = this.CanvasKit.Path.MakeFromSVGString(str);
    if (path === null) {
      return null;
    }
    return new JsiSkPath(this.CanvasKit, path);
  }

  MakeFromOp(one: SkPath, two: SkPath, op: PathOp) {
    const path = this.CanvasKit.Path.MakeFromOp(
      JsiSkPath.fromValue(one),
      JsiSkPath.fromValue(two),
      getEnum(this.CanvasKit, "PathOp", op)
    );
    if (path === null) {
      return null;
    }
    return new JsiSkPath(this.CanvasKit, path);
  }

  MakeFromCmds(cmds: PathCommand[]) {
    const path = this.CanvasKit.Path.MakeFromCmds(cmds.flat());
    if (path === null) {
      return null;
    }
    return new JsiSkPath(this.CanvasKit, path);
  }

  MakeFromGlyphs(
    glyphs: number[],
    positions: SkPoint[],
    font: SkFont
  ) {
    const path = this.CanvasKit.Path.MakeFromGlyphs(
      glyphs,
      positions.flatMap(({ x, y }) => [x, y]),
      JsiSkFont.fromValue(font)
    );
    if (path === null) {
      return null;
    }
    return new JsiSkPath(this.CanvasKit, path);
  }

  MakeFromRSXformGlyphs(
    glyphs: number[],
    rsxforms: SkRSXform[],
    font: SkFont
  ) {
    const path = this.CanvasKit.Path.MakeFromRSXformGlyphs(
      glyphs,
      rsxforms.flatMap((rsxform) => Array.from(JsiSkRSXform.fromValue(rsxform))),
      JsiSkFont.fromValue(font)
    );
    if (path === null) {
      return null;
    }
    return new JsiSkPath(this.CanvasKit, path);
  }

  MakeFromText(text: string, x: number, y: number, font: SkFont) {
    const path = this.CanvasKit.Path.MakeFromText(
      text,
      x,
      y,
      JsiSkFont.fromValue(font)
    );
    if (path === null) {
      return null;
    }
    return new JsiSkPath(this.CanvasKit, path);
  }
}
