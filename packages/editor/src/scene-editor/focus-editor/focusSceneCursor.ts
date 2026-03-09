const encodeSvgCursor = (svg: string): string => {
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, auto`;
};

const buildRotateCursorSvg = (angleDeg: number): string => {
	return `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
	<rect x="0" y="0" width="24" height="24" fill="none"/>
	<g transform="rotate(${angleDeg} 12 12)">
		<path d="M12 4a8 8 0 1 1-6.4 3.2" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round"/>
		<path d="M3.8 7.4 6.4 11l3-2.4" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
	</g>
</svg>
`.trim();
};

export const FOCUS_ROTATE_CURSOR_TOP_LEFT = encodeSvgCursor(
	buildRotateCursorSvg(225),
);
export const FOCUS_ROTATE_CURSOR_TOP_RIGHT = encodeSvgCursor(
	buildRotateCursorSvg(315),
);
export const FOCUS_ROTATE_CURSOR_BOTTOM_RIGHT = encodeSvgCursor(
	buildRotateCursorSvg(45),
);
export const FOCUS_ROTATE_CURSOR_BOTTOM_LEFT = encodeSvgCursor(
	buildRotateCursorSvg(135),
);
