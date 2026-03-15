import { resolveClipboardNodeGeometry } from "../model/clipboardTransform";
import type { ElementComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createTextModel, type TextProps } from "./model";
import TextRenderer from "./renderer";
import { TextSetting } from "./setting";
import { TextTimeline } from "./timeline";

export {
	createTextModel,
	type TextAlignMode,
	type TextInternal,
	type TextProps,
} from "./model";
export { TextSetting } from "./setting";
export { TextTimeline } from "./timeline";

export const TextDefinition: ElementComponentDefinition<TextProps> = {
	type: "Text",
	component: "text",
	createModel: createTextModel,
	Renderer: TextRenderer,
	Timeline: TextTimeline,
	Setting: TextSetting,
	toCanvasClipboardNode: ({ element, sourceCanvasSize }) => {
		const props = (element.props ?? {}) as Partial<TextProps>;
		const geometry = resolveClipboardNodeGeometry(element, sourceCanvasSize, {
			width: 500,
			height: 160,
		});
		return {
			type: "text",
			name: element.name,
			text: typeof props.text === "string" ? props.text : "新建文本",
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
		name: "Text",
		category: "overlay",
		trackRole: "overlay",
		description: "Text overlay rendered by Skia Paragraph",
		defaultProps: {
			text: "新建文本",
			fontSize: 48,
			color: "#FFFFFF",
			textAlign: "left",
			lineHeight: 1.2,
		},
	},
};

componentRegistry.register(TextDefinition);

export default TextRenderer;
