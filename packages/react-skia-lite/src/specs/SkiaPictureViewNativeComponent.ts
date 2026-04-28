import { createElement } from "react";
import type * as React from "react";
import type { ViewProps } from "../react-native-types/ViewPropTypes";
import type {
	SkiaWebCanvasColorSpace,
	SkiaWebCanvasDynamicRange,
} from "../skia/web/canvasColorSpace";
import {
	SkiaPictureView,
	type SkiaPictureViewHandle,
} from "../views/SkiaPictureView";

export interface NativeProps extends ViewProps {
	debug?: boolean;
	opaque?: boolean;
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
	nativeID: string;
	pd?: number;
	ref?: React.Ref<SkiaPictureViewHandle>;
}

const SkiaPictureViewNativeComponent = (props: NativeProps) => {
	return createElement(SkiaPictureView, props);
};
// eslint-disable-next-line import/no-default-export
export default SkiaPictureViewNativeComponent;
