/**
 * 轨道配置系统
 * 定义不同类型轨道的属性和兼容性规则
 */

import { componentRegistry } from "@/dsl/model/componentRegistry";
import type { TrackRole } from "@/dsl/types";
import { TrackConfig, TrackInstance } from "./types";

// ============================================================================
// 默认轨道配置
// ============================================================================

/**
 * 默认轨道高度
 */
export const DEFAULT_TRACK_HEIGHT = 60;

/**
 * 轨道内容与边界的统一间隙
 */
export const TRACK_CONTENT_GAP = 6;

/**
 * 元素默认高度
 */
export const DEFAULT_ELEMENT_HEIGHT = DEFAULT_TRACK_HEIGHT - TRACK_CONTENT_GAP;

export function getElementHeightForTrack(trackHeight: number): number {
	return Math.max(0, trackHeight - TRACK_CONTENT_GAP);
}

/**
 * 间隙检测阈值（像素）
 */
export const GAP_THRESHOLD = 12;

/**
 * 显著垂直移动阈值（轨道高度的比例）
 */
export const SIGNIFICANT_VERTICAL_MOVE_RATIO = 0.5;

/**
 * 各角色轨道的默认配置
 */
export const DEFAULT_TRACK_CONFIGS: Record<TrackRole, TrackConfig> = {
	clip: {
		role: "clip",
		height: 72,
		compatibleWith: ["clip"], // 主轨道只能放主要内容
		canCreateNew: false, // 主轨道不能创建新的
		minTracks: 1,
		maxTracks: 1,
	},
	overlay: {
		role: "overlay",
		height: 36,
		compatibleWith: ["overlay"], // 贴纸、水印等可以共存
		canCreateNew: true,
		minTracks: 0,
		maxTracks: -1,
	},
	effect: {
		role: "effect",
		height: 36,
		compatibleWith: ["effect"],
		canCreateNew: true,
		minTracks: 0,
		maxTracks: -1,
	},
	audio: {
		role: "audio",
		height: 36,
		compatibleWith: ["audio"],
		canCreateNew: true,
		minTracks: 0,
		maxTracks: -1,
	},
};

// ============================================================================
// 元素类型到轨道角色的映射
// ============================================================================

/**
 * 从 DSL 组件元数据获取轨道角色
 */
export function getElementRoleFromComponent(
	component: string,
	fallback: TrackRole = "overlay",
): TrackRole {
	const definition = componentRegistry.get(component);
	return definition?.meta.trackRole ?? fallback;
}

/**
 * 获取轨道配置
 */
export function getTrackConfig(role: TrackRole): TrackConfig {
	return DEFAULT_TRACK_CONFIGS[role] ?? DEFAULT_TRACK_CONFIGS.overlay;
}

// ============================================================================
// 轨道兼容性检查
// ============================================================================

/**
 * 检查元素是否可以放置在指定角色的轨道上
 */
export function canElementBeOnTrack(
	component: string,
	trackRole: TrackRole,
): boolean {
	const elementRole = getElementRoleFromComponent(component);
	const trackConfig = getTrackConfig(trackRole);
	return trackConfig.compatibleWith.includes(elementRole);
}

/**
 * 检查两个元素是否可以共存于同一轨道
 */
export function canElementsCoexist(
	component1: string,
	component2: string,
): boolean {
	const role1 = getElementRoleFromComponent(component1);
	const role2 = getElementRoleFromComponent(component2);
	const config1 = getTrackConfig(role1);
	return config1.compatibleWith.includes(role2);
}

// ============================================================================
// 轨道布局计算
// ============================================================================

/**
 * 轨道布局配置
 */
export interface TrackLayoutConfig {
	/** 各角色的轨道配置覆盖 */
	trackConfigs?: Partial<Record<TrackRole, Partial<TrackConfig>>>;
	/** 轨道间距 */
	trackGap?: number;
}

/**
 * 计算轨道实例列表
 * 根据元素列表和配置，生成运行时的轨道布局
 */
export function calculateTrackLayout(
	trackIndices: Map<string, number>,
	_elementTypes: Map<string, string>,
	config?: TrackLayoutConfig,
): TrackInstance[] {
	// 暂时使用简化版本，所有轨道使用相同高度
	// 未来可以根据元素类型计算不同高度
	const tracks: TrackInstance[] = [];
	const maxTrackIndex = Math.max(0, ...trackIndices.values());

	let currentY = 0;
	for (let i = maxTrackIndex; i >= 0; i--) {
		// 从上到下排列，高索引在上
		const role: TrackRole = i === 0 ? "clip" : "overlay";
		const trackConfig = getTrackConfig(role);
		const height = config?.trackConfigs?.[role]?.height ?? trackConfig.height;

		tracks.push({
			id: `track-${i}`,
			index: i,
			role,
			config: { ...trackConfig, height },
			y: currentY,
		});

		currentY += height + (config?.trackGap ?? 0);
	}

	return tracks;
}

/**
 * 根据 Y 坐标获取轨道索引
 */
export function getTrackIndexFromY(
	y: number,
	trackHeight: number,
	totalTracks: number,
): number {
	const trackFromTop = Math.floor(y / trackHeight);
	return Math.max(0, totalTracks - 1 - trackFromTop);
}

/**
 * 根据轨道索引获取 Y 坐标
 */
export function getYFromTrackIndex(
	trackIndex: number,
	trackHeight: number,
	totalTracks: number,
): number {
	return (totalTracks - 1 - trackIndex) * trackHeight;
}
