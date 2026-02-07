import type { ResolveRole } from "core/editor/utils/trackAssignment";
import type { TimelineElement } from "@/dsl/types";
import { getElementRoleFromComponent } from "../timeline/trackConfig";

/**
 * 编辑器侧统一的轨道角色解析规则
 */
export const resolveTimelineElementRole: ResolveRole = (
	element: TimelineElement,
) => getElementRoleFromComponent(element.component, "clip");
