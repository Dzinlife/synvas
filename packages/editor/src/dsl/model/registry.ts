import { useCallback, useSyncExternalStore } from "react";
import type {
	ComponentConstraints,
	ComponentModel,
	ComponentModelStore,
} from "./types";

// Model 注册表（单例）
class ModelRegistryClass {
	private models = new Map<string, ComponentModelStore<any, any>>();
	private listeners = new Set<() => void>();

	// 注册 model
	register<P, Internal>(
		id: string,
		store: ComponentModelStore<P, Internal>,
	): void {
		if (this.models.has(id)) {
			console.warn(`Model with id "${id}" already exists, replacing...`);
			this.unregister(id);
		}
		this.models.set(id, store);
		this.notify();
	}

	// 注销 model
	unregister(id: string): void {
		const store = this.models.get(id);
		if (store) {
			store.getState().dispose();
			this.models.delete(id);
			this.notify();
		}
	}

	// 获取 model
	get<P, Internal>(id: string): ComponentModelStore<P, Internal> | undefined {
		return this.models.get(id) as ComponentModelStore<P, Internal> | undefined;
	}

	// 检查是否存在
	has(id: string): boolean {
		return this.models.has(id);
	}

	// 获取所有 model ids
	getIds(): string[] {
		return Array.from(this.models.keys());
	}

	// 订阅变化
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	// 获取快照（用于 useSyncExternalStore）
	getSnapshot(): Map<string, ComponentModelStore<any, any>> {
		return this.models;
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

// 导出单例
export const modelRegistry = new ModelRegistryClass();

// ========== Hooks ==========

/**
 * 获取指定 id 的 model store
 * 注意：这个 hook 不会自动订阅 model 内部状态变化
 * 需要配合 useModelState 或 useModelSelector 使用
 */
export function useModel<
	P = Record<string, unknown>,
	Internal = Record<string, unknown>,
>(
	id: string,
): ComponentModelStore<P, Internal> {
	const store = modelRegistry.get<P, Internal>(id);
	if (!store) {
		throw new Error(`Model not found: ${id}`);
	}
	return store;
}

/**
 * 安全获取 model（可能不存在）
 */
export function useModelSafe<
	P = Record<string, unknown>,
	Internal = Record<string, unknown>,
>(
	id: string,
): ComponentModelStore<P, Internal> | undefined {
	return modelRegistry.get<P, Internal>(id);
}

/**
 * 订阅 model 的完整状态
 */
export function useModelState<
	P = Record<string, unknown>,
	Internal = Record<string, unknown>,
>(
	id: string,
): ComponentModel<P, Internal> {
	const store = useModel<P, Internal>(id);

	return useSyncExternalStore(
		store.subscribe,
		() => store.getState(),
		() => store.getState(),
	);
}

/**
 * 订阅 model 的特定字段（性能优化）
 */
export function useModelSelector<
	P,
	Internal = Record<string, unknown>,
	T = unknown,
>(
	id: string,
	selector: (state: ComponentModel<P, Internal>) => T,
	equalityFn?: (a: T, b: T) => boolean,
): T {
	const store = useModel<P, Internal>(id);

	const getSnapshot = useCallback(() => {
		return selector(store.getState());
	}, [store, selector]);

	return useSyncExternalStore(
		useCallback(
			(onStoreChange) => {
				let currentValue = selector(store.getState());

				return store.subscribe(() => {
					const newValue = selector(store.getState());
					const isEqual = equalityFn
						? equalityFn(currentValue, newValue)
						: currentValue === newValue;

					if (!isEqual) {
						currentValue = newValue;
						onStoreChange();
					}
				});
			},
			[store, selector, equalityFn],
		),
		getSnapshot,
		getSnapshot,
	);
}

export function createModelSelector<
	P,
	Internal = Record<string, unknown>,
>() {
	return function <T>(
		id: string,
		selector: (state: ComponentModel<P, Internal>) => T,
		equalityFn?: (a: T, b: T) => boolean,
	): T {
		return useModelSelector<P, Internal, T>(id, selector, equalityFn);
	};
}

/**
 * 只订阅 constraints
 */
export function useModelConstraints(id: string): ComponentConstraints {
	return useModelSelector(id, (state) => state.constraints);
}

/**
 * 安全订阅任意字段（id 可为空或不存在）
 */
export function useModelSelectorSafe<
	P,
	Internal = Record<string, unknown>,
	T = unknown,
>(
	id: string | undefined,
	selector: (state: ComponentModel<P, Internal>) => T,
	defaultValue: T,
	equalityFn?: (a: T, b: T) => boolean,
): T {
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsubs: Array<() => void> = [];
			unsubs.push(modelRegistry.subscribe(onStoreChange));
			if (id) {
				const store = modelRegistry.get<P, Internal>(id);
				if (store) {
					let currentValue = selector(store.getState());
					unsubs.push(
						store.subscribe(() => {
							const newValue = selector(store.getState());
							const isEqual = equalityFn
								? equalityFn(currentValue, newValue)
								: currentValue === newValue;
							if (!isEqual) {
								currentValue = newValue;
								onStoreChange();
							}
						}),
					);
				}
			}
			return () => {
				unsubs.forEach((unsub) => unsub());
			};
		},
		[id, selector, equalityFn],
	);

	const getSnapshot = useCallback(() => {
		if (!id) return defaultValue;
		const store = modelRegistry.get<P, Internal>(id);
		return store ? selector(store.getState()) : defaultValue;
	}, [id, selector, defaultValue]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 只订阅 props
 */
export function useModelProps<
	P = Record<string, unknown>,
	Internal = Record<string, unknown>,
>(id: string): P {
	return useModelSelector<P, Internal, P>(id, (state) => state.props);
}

/**
 * 检查 model 是否存在（响应式）
 */
export function useModelExists(id: string): boolean {
	return useSyncExternalStore(
		(onStoreChange) => modelRegistry.subscribe(onStoreChange),
		() => modelRegistry.has(id),
		() => modelRegistry.has(id),
	);
}
