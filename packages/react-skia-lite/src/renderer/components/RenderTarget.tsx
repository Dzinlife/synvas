import type { RenderTargetProps } from "../../dom/types";
import type { SkiaProps } from "../processors/Animations/Animations";

export const RenderTarget = ({
	children,
	...props
}: SkiaProps<RenderTargetProps>) => {
	return <skRenderTarget {...props}>{children}</skRenderTarget>;
};
