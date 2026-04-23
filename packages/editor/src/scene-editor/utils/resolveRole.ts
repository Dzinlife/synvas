import type { TimelineElement } from "core/timeline-system/types";
import type { ResolveRole } from "core/timeline-system/utils/trackAssignment";
import { getElementRoleFromComponent } from "../timeline/trackConfig";

/**
 * 编辑器侧统一的轨道角色解析规则
 */
export const resolveTimelineElementRole: ResolveRole = (
	element: TimelineElement,
) => getElementRoleFromComponent(element.component, "clip");
