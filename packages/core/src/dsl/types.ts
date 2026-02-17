import type { TranscriptRecord } from "../asr/types";

// ============================================================================
// 新架构：分离的属性系统
// ============================================================================

export interface TransformSizeMeta {
	width: number; // 尺寸宽度（像素）
	height: number; // 尺寸高度（像素）
}

export interface TransformPositionMeta {
	x: number; // 锚点在画布坐标系中的 X（中心原点，右正）
	y: number; // 锚点在画布坐标系中的 Y（中心原点，上正）
	space: "canvas";
}

export interface TransformAnchorMeta {
	x: number; // 归一化锚点 X（0~1）
	y: number; // 归一化锚点 Y（0~1）
	space: "normalized";
}

export interface TransformScaleMeta {
	x: number; // 水平缩放，1=100%
	y: number; // 垂直缩放，1=100%
}

export interface TransformRotationMeta {
	value: number; // 旋转角度（度）
	unit: "deg";
}

export interface TransformCropMeta {
	left: number;
	right: number;
	top: number;
	bottom: number;
	unit: "normalized" | "px";
}

export type CornerPinPoint = {
	x: number;
	y: number;
};

export interface TransformDistortNone {
	type: "none";
}

export interface TransformDistortCornerPin {
	type: "cornerPin";
	points: [CornerPinPoint, CornerPinPoint, CornerPinPoint, CornerPinPoint];
	space: "normalized_local";
}

/**
 * 空间变换属性
 * 使用主流 NLE 的 SRT + Anchor 语义；四角形变仅预留接口
 */
export interface TransformMeta {
	baseSize: TransformSizeMeta;
	position: TransformPositionMeta;
	anchor: TransformAnchorMeta;
	scale: TransformScaleMeta;
	rotation: TransformRotationMeta;
	crop?: TransformCropMeta;
	distort?: TransformDistortNone | TransformDistortCornerPin;
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
 * Clip 元信息（仅记录非默认状态）
 */
export interface ClipMeta {
	/** 分离出来的音频来源 VideoClip */
	sourceVideoClipId?: string;
	/** VideoClip 是否静音源音频；仅静音时写入 true */
	muteSourceAudio?: true;
	/** 片段音量（dB），0 表示不增减 */
	gainDb?: number;
}

export const ELEMENT_TYPE_VALUES = [
	"VideoClip",
	"FreezeFrame",
	"AudioClip",
	"Transition",
	"Filter",
	"Lottie",
	"Caption",
	"Text",
	"Image",
] as const;

export type ElementType = (typeof ELEMENT_TYPE_VALUES)[number];

export const SOURCE_KIND_VALUES = [
	"video",
	"audio",
	"image",
	"lottie",
	"unknown",
] as const;

export type SourceKind = (typeof SOURCE_KIND_VALUES)[number];

export interface SourceDataSet {
	asr?: TranscriptRecord;
	[key: string]: unknown;
}

export interface TimelineSource {
	id: string;
	uri: string;
	kind: SourceKind;
	name?: string;
	data?: SourceDataSet;
}

export const SOURCE_BACKED_ELEMENT_TYPE_VALUES = [
	"VideoClip",
	"AudioClip",
	"Image",
	"Lottie",
	"FreezeFrame",
] as const;

export type SourceBackedElementType =
	(typeof SOURCE_BACKED_ELEMENT_TYPE_VALUES)[number];

const sourceBackedElementTypeSet = new Set<ElementType>(
	SOURCE_BACKED_ELEMENT_TYPE_VALUES,
);

export const isSourceBackedElementType = (
	type: ElementType,
): type is SourceBackedElementType => sourceBackedElementTypeSet.has(type);

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
	sourceId?: string; // 媒体源标识（共享素材/ASR 等扩展数据）

	transform?: TransformMeta; // 空间属性
	timeline: TimelineMeta; // 时间属性
	render?: RenderMeta; // 渲染属性

	props: Props; // 组件特定属性（仅业务逻辑）

	// ===== 模型层元数据（不影响当前渲染行为） =====
	clip?: ClipMeta;
	transition?: TransitionMeta;
}
