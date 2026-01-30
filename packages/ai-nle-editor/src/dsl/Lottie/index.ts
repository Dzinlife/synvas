import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { createLottieModel, type LottieProps } from "./model";
import Lottie from "./renderer";
import { LottieTimeline } from "./timeline";

export { createLottieModel, type LottieProps } from "./model";
export { LottieTimeline } from "./timeline";

// 组件定义
export const LottieDefinition: DSLComponentDefinition<LottieProps> = {
	type: "Lottie",
	component: "lottie",
	createModel: createLottieModel,
	Renderer: Lottie,
	Timeline: LottieTimeline,
	meta: {
		name: "Lottie Animation",
		category: "animation",
		trackRole: "overlay",
		description: "Lottie animation playback",
	},
};

// 注册到全局组件注册表
componentRegistry.register(LottieDefinition);

export default Lottie;
