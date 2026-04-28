import type { CanvasKit, FontMgr } from "canvaskit-wasm";

import type { FontStyle, SkFontMgr, SkTypeface } from "../types";

import { HostObject, throwNotImplementedOnWeb } from "./Host";

export class JsiSkFontMgr
	extends HostObject<FontMgr, "FontMgr">
	implements SkFontMgr
{
	constructor(CanvasKit: CanvasKit, ref: FontMgr) {
		super(CanvasKit, ref, "FontMgr");
	}
	countFamilies() {
		return this.ref.countFamilies();
	}
	getFamilyName(index: number) {
		return this.ref.getFamilyName(index);
	}
	matchFamilyStyle(_familyName: string, _fontStyle: FontStyle) {
		return throwNotImplementedOnWeb<SkTypeface>();
	}
}
