import type React from "react";
import type { ElementType, TrackRole } from "../types";
import type { ComponentModelStore, RendererPrepareFrameContext } from "./types";

/**
 * 组件定义接口
 */
export interface DSLComponentDefinition<Props = any, Internal = any> {
	// 组件类型名称（大类）
	type: ElementType;
	// 组件实现标识（区分具体实现）
	component: string;

	// Model 工厂函数
	createModel: (
		id: string,
		props: Props,
	) => ComponentModelStore<Props, Internal>;

	// 渲染组件（用于 Preview 和导出）
	Renderer: React.ComponentType<any>;

	prepareRenderFrame?: (
		context: RendererPrepareFrameContext,
	) => Promise<void> | void;

	// 时间线组件
	Timeline: React.ComponentType<any>;

	// 组件元数据
	meta: {
		name: string; // 显示名称
		category: string; // 分类
		trackRole?: TrackRole; // 轨道角色
		icon?: React.ComponentType; // 图标组件
		description?: string; // 描述
		defaultProps?: Partial<Props>; // 默认 props
	};
}

/**
 * 组件注册表（单例）
 */
class ComponentRegistryClass {
	private components = new Map<string, DSLComponentDefinition>();
	// Renderer -> component 的反向映射
	private componentToId = new Map<React.ComponentType<any>, string>();

	/**
	 * 注册组件
	 */
	register<Props = any>(definition: DSLComponentDefinition<Props>): void {
		console.log("register", definition.component, definition);
		if (this.components.has(definition.component)) {
			console.warn(
				`Component "${definition.component}" already registered, replacing...`,
			);
		}
		this.components.set(definition.component, definition);
		// 建立 Renderer -> component 的反向映射
		this.componentToId.set(definition.Renderer, definition.component);
	}

	/**
	 * 获取组件定义
	 */
	get(component: string): DSLComponentDefinition | undefined {
		return this.components.get(component);
	}

	/**
	 * 通过 Renderer 组件获取 type
	 */
	getComponentIdByRenderer(
		component: React.ComponentType<any>,
	): string | undefined {
		return this.componentToId.get(component);
	}

	/**
	 * 通过 Renderer 组件获取完整定义
	 */
	getByComponent(
		component: React.ComponentType<any>,
	): DSLComponentDefinition | undefined {
		const componentId = this.componentToId.get(component);
		return componentId ? this.components.get(componentId) : undefined;
	}

	/**
	 * 检查是否已注册
	 */
	has(component: string): boolean {
		return this.components.has(component);
	}

	/**
	 * 获取所有已注册的组件类型
	 */
	getComponentIds(): string[] {
		return Array.from(this.components.keys());
	}

	getTypes(): ElementType[] {
		const types = new Set<ElementType>(
			Array.from(this.components.values()).map((def) => def.type),
		);
		return Array.from(types);
	}

	/**
	 * 获取所有组件定义
	 */
	getAll(): DSLComponentDefinition[] {
		return Array.from(this.components.values());
	}

	/**
	 * 按分类获取组件
	 */
	getByCategory(category: string): DSLComponentDefinition[] {
		return this.getAll().filter((def) => def.meta.category === category);
	}

	getByType(type: ElementType): DSLComponentDefinition[] {
		return this.getAll().filter((def) => def.type === type);
	}

	/**
	 * 获取所有分类
	 */
	getCategories(): string[] {
		const categories = new Set(this.getAll().map((def) => def.meta.category));
		return Array.from(categories);
	}
}

// 导出单例
export const componentRegistry = new ComponentRegistryClass();
