import { resolveClipboardNodeGeometry } from "../model/clipboardTransform";
import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createFancyTextModel, type FancyTextProps } from "./model";
import FancyTextRenderer from "./renderer";
import { FancyTextSetting } from "./setting";
import { FancyTextTimeline } from "./timeline";

export {
	createFancyTextModel,
	type FancyTextInternal,
	type FancyTextProps,
	type TextAlignMode,
} from "./model";
export { FancyTextSetting } from "./setting";
export { FancyTextTimeline } from "./timeline";

export const FancyTextDefinition: ElementComponentDefinition<FancyTextProps> = {
	type: "Text",
	component: "fancy-text",
	createModel: createFancyTextModel,
	Renderer: FancyTextRenderer,
	Timeline: FancyTextTimeline,
	Setting: FancyTextSetting,
	toCanvasClipboardNode: ({ element, sourceCanvasSize }) => {
		const props = (element.props ?? {}) as Partial<FancyTextProps>;
		const geometry = resolveClipboardNodeGeometry(element, sourceCanvasSize, {
			width: 500,
			height: 160,
		});
		return {
			type: "text",
			name: element.name,
			text: typeof props.text === "string" ? props.text : "花字演示",
			fontSize:
				typeof props.fontSize === "number" && Number.isFinite(props.fontSize)
					? Math.max(8, Math.round(props.fontSize))
					: 48,
			x: geometry.x,
			y: geometry.y,
			width: geometry.width,
			height: geometry.height,
		};
	},
	meta: {
		name: "Fancy Text",
		category: "overlay",
		trackRole: "overlay",
		resizeBehavior: "text-width-reflow",
		description: "Glyph-shaped fancy text demo with a moving wave effect",
		defaultProps: {
			text: "花字演示 Demo",
			fontSize: 48,
			color: "#FFFFFF",
			textAlign: "left",
			lineHeight: 1.2,
			locale: "zh-CN",
			waveRadius: 48,
			waveTranslateY: 8,
			waveScale: 0.16,
		},
	},
};

componentRegistry.register(FancyTextDefinition);

export default FancyTextRenderer;
