import type { ReactNode } from "react";
import type { StoreApi } from "zustand";
import type {
	AudioClipMeta,
	ClipMeta,
	TimelineElement,
	VideoClipMeta,
} from "../types";

export type PrepareFrameContext = {
	element: TimelineElement;
	displayTime: number;
	fps: number;
	phase?: "beforeRender" | "afterRender";
};

export type RendererPrepareFrameContext = {
	element: TimelineElement;
	displayTime: number;
	fps: number;
	modelStore?: ComponentModelStore;
	getModelStore?: (id: string) => ComponentModelStore | undefined;
	canvasSize?: { width: number; height: number };
	fromNode?: ReactNode | null;
	toNode?: ReactNode | null;
};

// 组件约束信息
export interface ComponentConstraints {
	// 时间约束
	minDuration?: number;
	maxDuration?: number;
	canTrimStart?: boolean;
	canTrimEnd?: boolean;

	// 布局约束
	aspectRatio?: number;
	minWidth?: number;
	maxWidth?: number;

	// 状态
	isLoading?: boolean;
	hasError?: boolean;
	errorMessage?: string;
}

// 验证结果
export interface ValidationResult {
	valid: boolean;
	errors: string[];
	// 修正后的值（当验证失败时，提供一个合法的替代值）
	corrected?: Record<string, unknown>;
}

// Model State 基础类型
export interface ComponentModelState<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> {
	id: string;
	type: string;
	props: Props;
	constraints: ComponentConstraints;
	// 内部状态（组件特有的，如解码器实例等）
	internal: Internal;
}

// Model Actions 基础类型
export interface ComponentModelActions<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> {
	setProps: (partial: Partial<Props>) => ValidationResult;
	setConstraints: (partial: Partial<ComponentConstraints>) => void;
	setInternal: (partial: Partial<Internal>) => void;

	// 验证
	validate: (newProps: Partial<Props>) => ValidationResult;

	// 生命周期
	init: () => Promise<void> | void;
	dispose: () => void;

	// 资源就绪接口（用于离屏渲染等场景）
	waitForReady?: () => Promise<void>;
	prepareFrame?: (context: PrepareFrameContext) => Promise<void> | void;
}

// 完整 Model 类型
export type ComponentModel<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> = ComponentModelState<Props, Internal> &
	ComponentModelActions<Props, Internal>;

// Model Store 类型
export type ComponentModelStore<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> = StoreApi<ComponentModel<Props, Internal>>;

// 时间线 Props（传递给 Timeline 组件）
export interface TimelineProps {
	start: number;
	end: number;
	startTimecode: string;
	endTimecode: string;
	fps: number;
}

// ===== 模型层元类型（用于之后的交互/轨道扩展） =====
export type { ClipMeta, VideoClipMeta, AudioClipMeta };

export type VideoClipModel = VideoClipMeta;
export type AudioClipModel = AudioClipMeta;
