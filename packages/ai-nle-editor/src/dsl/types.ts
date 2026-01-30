// ============================================================================
// 新架构：分离的属性系统
// ============================================================================

/**
 * 空间变换属性 (画布中心坐标系统)
 * 独立于组件 props，描述元素的空间位置和变换
 * 坐标系原点在画布中心，centerX=0, centerY=0 表示元素中心在画布中心
 */
export interface TransformMeta {
	centerX: number; // 中心点 X 坐标（相对于画布中心，正值向右）
	centerY: number; // 中心点 Y 坐标（相对于画布中心，正值向下）
	width: number; // 宽度（像素）
	height: number; // 高度（像素）
	rotation: number; // 旋转角度（弧度）
}

/**
 * 轨道角色类型
 * 为 agent 操作提供语义基础
 */
export type TrackRole =
	| "clip" // 片段轨道：主要内容（视频、音频主体）
	| "overlay" // 叠加层：贴纸、字幕、水印等
	| "effect" // 效果层：滤镜、特效等
	| "audio"; // 音频轨：背景音乐、音效等

/**
 * 时间线属性
 * 独立于组件 props，描述元素的时间范围和轨道位置
 */
export interface TimelineMeta {
	start: number; // 开始帧（整数）
	end: number; // 结束帧（整数）
	startTimecode: string; // 可读时间戳 (HH:MM:SS:FF)
	endTimecode: string; // 可读时间戳 (HH:MM:SS:FF)
	offset?: number; // 源素材起始偏移（帧）
	trackIndex?: number; // 轨道索引（0 为主轨道，在底部）
	trackId?: string; // 轨道标识（用于稳定轨道身份）
	role?: TrackRole; // 轨道角色（语义标识，用于 agent 理解）
}

/**
 * 渲染属性
 * 控制元素的渲染行为
 */
export interface RenderMeta {
	zIndex?: number; // Z 序
	visible?: boolean; // 可见性
	opacity?: number; // 透明度 (0-1)
}

/**
 * 渲染布局（传递给渲染器的布局信息）
 * 使用中心坐标系统
 */
export interface RenderLayout {
	cx: number; // 中心点 X
	cy: number; // 中心点 Y
	w: number; // 宽度
	h: number; // 高度
	rotation: number; // 旋转（弧度）
}

/**
 * Clip 元信息（仅用于模型层元数据）
 */
export type ClipKind = "video" | "audio";

export interface VideoClipMeta {
	kind: "video";
	audio: {
		enabled: boolean;
		splitAudioClipId?: string;
	};
}

export interface AudioClipMeta {
	kind: "audio";
	sourceVideoClipId?: string;
}

export type ClipMeta = VideoClipMeta | AudioClipMeta;

export const ELEMENT_TYPE_VALUES = [
	"VideoClip",
	"AudioClip",
	"Transition",
	"Filter",
	"Lottie",
	"Caption",
	"Text",
	"Image",
	"Background",
] as const;

export type ElementType = (typeof ELEMENT_TYPE_VALUES)[number];

/**
 * 转场元信息（仅用于模型层元数据）
 */
export interface TransitionMeta {
	duration: number;
	boundry: number;
	fromId: string;
	toId: string;
}

/**
 * 时间线元素（纯数据结构）
 * 不再是 React.ReactElement，而是纯 JSON 可序列化的数据对象
 */
export interface TimelineElement<Props = Record<string, any>> {
	id: string; // 唯一标识符
	type: ElementType; // 组件类型 ("Image" | "VideoClip" | "Lottie" | ...)
	component: string; // 组件实现标识（区分具体实现）
	name: string; // 显示名称

	transform: TransformMeta; // 空间属性
	timeline: TimelineMeta; // 时间属性
	render: RenderMeta; // 渲染属性

	props: Props; // 组件特定属性（仅业务逻辑）

	// ===== 模型层元数据（不影响当前渲染行为） =====
	clip?: ClipMeta;
	transition?: TransitionMeta;
}
