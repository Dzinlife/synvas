import { TimelineElement } from "../../dsl/types";

/**
 * 层叠关联关系
 * - parentId: 父元素（主轨道元素）
 * - childId: 子元素（叠加轨道元素）
 */
export interface AttachmentRelation {
	parentId: string;
	childId: string;
}

/**
 * 检查子元素的 start 是否在父元素的时间范围内
 * 只要子元素的开始时间在父元素范围内，就认为是关联的
 */
function isStartWithinRange(
	parent: TimelineElement,
	child: TimelineElement,
): boolean {
	return (
		child.timeline.start >= parent.timeline.start &&
		child.timeline.start < parent.timeline.end
	);
}

/**
 * 获取元素的轨道索引（默认为 0）
 */
function getTrackIndex(element: TimelineElement): number {
	return element.timeline?.trackIndex ?? 0;
}

/**
 * 查找所有层叠关联关系
 *
 * 关联条件：
 * 1. 子元素的 start 在父元素的时间范围内
 * 2. 父元素在主轨道（trackIndex: 0），子元素在叠加轨道（trackIndex > 0）
 *
 * @param elements 所有时间线元素
 * @returns 父元素 ID -> 子元素 ID 列表 的映射
 */
export function findAttachments(
	elements: TimelineElement[],
): Map<string, string[]> {
	const result = new Map<string, string[]>();

	if (elements.length < 2) {
		return result;
	}

	// 分离主轨道元素和叠加轨道元素
	const mainTrackElements = elements.filter((el) => getTrackIndex(el) === 0);
	const overlayElements = elements.filter((el) => getTrackIndex(el) > 0);

	// 为每个叠加元素找到其对应的主轨道父元素
	for (const child of overlayElements) {
		// 找到 start 在范围内的主轨道元素
		for (const parent of mainTrackElements) {
			if (isStartWithinRange(parent, child)) {
				const existing = result.get(parent.id) ?? [];
				existing.push(child.id);
				result.set(parent.id, existing);
				break; // 一个子元素只关联一个父元素
			}
		}
	}

	return result;
}

/**
 * 获取某个元素的所有子元素 ID
 */
export function getChildIds(
	attachments: Map<string, string[]>,
	parentId: string,
): string[] {
	return attachments.get(parentId) ?? [];
}

/**
 * 检查一个元素是否是另一个元素的子元素
 */
export function isChildOf(
	attachments: Map<string, string[]>,
	childId: string,
	parentId: string,
): boolean {
	const children = attachments.get(parentId);
	return children?.includes(childId) ?? false;
}

/**
 * 获取元素的父元素 ID（如果有）
 */
export function getParentId(
	attachments: Map<string, string[]>,
	childId: string,
): string | null {
	for (const [parentId, children] of attachments.entries()) {
		if (children.includes(childId)) {
			return parentId;
		}
	}
	return null;
}
