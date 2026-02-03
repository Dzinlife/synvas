import { useEffect, useRef } from "react";
import { useElements } from "@/editor/contexts/TimelineContext";
import type { TimelineElement } from "../types";
import { componentRegistry } from "./componentRegistry";
import { modelRegistry } from "./registry";

/**
 * ModelManager - 管理所有 DSL 组件的 Model 生命周期
 *
 * 职责：
 * 1. 监听 elements 变化
 * 2. 为新增的元素创建 Model 并初始化
 * 3. 为删除的元素销毁 Model
 * 4. 同步 elements props 到 Model（外部编辑场景）
 */
export const ModelManager: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const { elements } = useElements();
	const prevElementsRef = useRef<TimelineElement[]>([]);
	const initializedRef = useRef(false);

	// 首次渲染时直接初始化所有 model
	if (!initializedRef.current && elements.length > 0) {
		initializedRef.current = true;

		for (const element of elements) {
			const id = element.id;
			const definition = componentRegistry.get(element.component);

			if (!definition) {
				console.warn(
					`[ModelManager] Component not registered for element ${id}, component: ${element.component}`,
				);
				continue;
			}

			const store = definition.createModel(id, element.props);
			modelRegistry.register(id, store);
			store.getState().init();
		}

		prevElementsRef.current = elements;
	}

	useEffect(() => {
		// 跳过首次渲染（已在上面处理）
		if (!initializedRef.current) {
			return;
		}

		const prevIds = new Set(prevElementsRef.current.map((e) => e.id));
		const currIds = new Set(elements.map((e) => e.id));

		// 新增的元素：创建 model
		for (const element of elements) {
			const id = element.id;

			if (!prevIds.has(id) && !modelRegistry.has(id)) {
				const definition = componentRegistry.get(element.component);

				if (!definition) {
					console.warn(
						`[ModelManager] Component not registered for element ${id}, component: ${element.component}`,
					);
					continue;
				}

				console.log(
					`[ModelManager] Creating model for element ${id}, component: ${definition.component}`,
				);

				// 创建 model
				const store = definition.createModel(id, element.props);
				modelRegistry.register(id, store);

				// 初始化
				store.getState().init();
				console.log(`[ModelManager] Model created and initialized for ${id}`);
			}
		}

		// 删除的元素：销毁 model
		for (const element of prevElementsRef.current) {
			const id = element.id;

			if (!currIds.has(id)) {
				modelRegistry.unregister(id);
			}
		}

		// 更新现有 model 的 props（处理外部编辑场景）
		for (const element of elements) {
			const id = element.id;
			const store = modelRegistry.get(id);

			if (store) {
				const state = store.getState();
				const currentProps = state.props as any;
				const newProps = element.props;

				// 检查 props 是否有变化（简单的浅比较）
				const propsChanged = Object.keys(newProps).some(
					(key) => currentProps[key] !== newProps[key],
				);

				if (propsChanged) {
					state.setProps(newProps);
				}
			}
		}

		prevElementsRef.current = elements;
	}, [elements]);

	// 组件卸载时清理所有 model
	useEffect(() => {
		return () => {
			for (const id of modelRegistry.getIds()) {
				modelRegistry.unregister(id);
			}
		};
	}, []);

	return <>{children}</>;
};
