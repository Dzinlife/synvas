export interface NodeInteractionBorderStyle {
	color: string;
	baseStrokeWidthPx: number;
}

export const resolveNodeInteractionBorderStyle = ({
	isActive,
	isSelected,
	isHovered,
}: {
	isActive: boolean;
	isSelected: boolean;
	isHovered: boolean;
}): NodeInteractionBorderStyle => {
	if (isActive) {
		return {
			color: "rgba(251,146,60,1)",
			baseStrokeWidthPx: 2,
		};
	}
	if (isSelected) {
		return {
			color: "rgba(56,189,248,1)",
			baseStrokeWidthPx: 2,
		};
	}
	if (isHovered) {
		return {
			color: "rgba(56,189,248,0.95)",
			baseStrokeWidthPx: 2,
		};
	}
	return {
		color: "rgba(255,255,255,0.2)",
		baseStrokeWidthPx: 1,
	};
};

export const resolveNodeInteractionStrokeWidth = (
	baseStrokeWidthPx: number,
	cameraZoom: number,
): number => {
	const safeZoom = Math.max(cameraZoom, 1e-6);
	return baseStrokeWidthPx / safeZoom;
};
