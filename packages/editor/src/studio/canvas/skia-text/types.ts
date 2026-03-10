import type { SkImage } from "react-skia-lite";

export interface SkiaUiTextStyle {
	fontFamily?: string;
	fontSizePx?: number;
	fontWeight?: number | string;
	lineHeightPx?: number;
	color?: string;
	paddingPx?: number;
}

export interface SkiaUiTextRequest {
	text: string;
	maxWidthPx?: number;
	slotKey?: string;
	style?: SkiaUiTextStyle;
	dprBucket?: number;
}

export interface NormalizedSkiaUiTextStyle {
	fontFamily: string;
	fontSizePx: number;
	fontWeight: string;
	lineHeightPx: number;
	color: string;
	paddingPx: number;
}

export interface NormalizedSkiaUiTextRequest {
	text: string;
	style: NormalizedSkiaUiTextStyle;
	dprBucket: number;
	signature: string;
}

export interface SkiaUiTextSprite {
	cacheKey: string;
	text: string;
	image: SkImage | null;
	textWidth: number;
	textHeight: number;
	ready: boolean;
}

export interface TextRasterEntry {
	cacheKey: string;
	text: string;
	textWidth: number;
	textHeight: number;
	image: SkImage | null;
	ready: boolean;
}
