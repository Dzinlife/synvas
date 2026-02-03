import type { DSLComponentDefinition } from "../model/componentRegistry";
import { componentRegistry } from "../model/componentRegistry";
import { type CloudBackgroundProps, createCloudBackgroundModel } from "./model";
import CloudBackgroundRenderer from "./renderer";
import { CloudBackgroundTimeline } from "./timeline";

// 组件定义
export const CloudBackgroundDefinition: DSLComponentDefinition<CloudBackgroundProps> =
	{
		type: "Background",
		component: "background/cloud",
		createModel: createCloudBackgroundModel,
		Renderer: CloudBackgroundRenderer,
		Timeline: CloudBackgroundTimeline,
		meta: {
			name: "Cloud Background",
			category: "background",
			trackRole: "clip",
			description: "Animated cloud background with shader effects",
			defaultProps: {
				speed: 1.0,
				cloudDensity: 1.0,
				skyColor: "#87CEEB",
				cloudColor: "#FFFFFF",
			},
		},
	};

// 注册到全局组件注册表
componentRegistry.register(CloudBackgroundDefinition);

export default CloudBackgroundRenderer;
