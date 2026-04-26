import { createElement } from "react";
import type { ViewProps } from "../react-native-types/ViewPropTypes";
import type {
	SkiaWebCanvasColorSpace,
	SkiaWebCanvasDynamicRange,
} from "../skia/web/canvasColorSpace";
import { SkiaPictureView } from "../views/SkiaPictureView";

export interface NativeProps extends ViewProps {
	debug?: boolean;
	opaque?: boolean;
	colorSpace?: SkiaWebCanvasColorSpace;
	dynamicRange?: SkiaWebCanvasDynamicRange;
	nativeID: string;
	pd?: number;
}

const SkiaPictureViewNativeComponent = (props: NativeProps) => {
	return createElement(SkiaPictureView, props);
};
// eslint-disable-next-line import/no-default-export
export default SkiaPictureViewNativeComponent;
