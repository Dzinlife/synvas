import type { LucideIcon } from "lucide-react";
import { Hand, MousePointer2, Square, Type } from "lucide-react";

export type CanvasToolMode = "move" | "pan" | "text" | "frame";

export interface CanvasToolDefinition {
	mode: CanvasToolMode;
	label: string;
	icon: LucideIcon;
	cursor: string;
	enabled: boolean;
}

export const CANVAS_DEFAULT_TOOL_MODE: CanvasToolMode = "move";

export const CANVAS_TOOL_DEFINITIONS: readonly CanvasToolDefinition[] = [
	{
		mode: "move",
		label: "Move",
		icon: MousePointer2,
		cursor: "default",
		enabled: true,
	},
	{
		mode: "pan",
		label: "Pan",
		icon: Hand,
		cursor: "grab",
		enabled: false,
	},
	{
		mode: "text",
		label: "Text",
		icon: Type,
		cursor: "text",
		enabled: false,
	},
	{
		mode: "frame",
		label: "Frame",
		icon: Square,
		cursor: "crosshair",
		enabled: true,
	},
];

export const resolveCanvasToolDefinition = (
	mode: CanvasToolMode,
): CanvasToolDefinition => {
	return (
		CANVAS_TOOL_DEFINITIONS.find((item) => item.mode === mode) ??
		CANVAS_TOOL_DEFINITIONS[0]
	);
};

export const isCanvasToolModeEnabled = (mode: CanvasToolMode): boolean => {
	return resolveCanvasToolDefinition(mode).enabled;
};
