import {
	fitRects,
	rect2rect,
	type SkRect,
	type Transforms3d,
} from "react-skia-lite";

export const resolveVideoImageTransform = (options: {
	src: SkRect;
	dst: SkRect;
	rotation: 0 | 90 | 180 | 270;
}): Transforms3d => {
	const { src, dst, rotation } = options;
	const fitted = fitRects(
		"contain",
		rotation === 90 || rotation === 270
			? { x: 0, y: 0, width: src.height, height: src.width }
			: src,
		dst,
	);
	const base = rect2rect(fitted.src, fitted.dst);
	if (rotation === 90) {
		return [...base, { translate: [src.height, 0] }, { rotate: Math.PI / 2 }];
	}
	if (rotation === 180) {
		return [...base, { translate: [src.width, src.height] }, { rotate: Math.PI }];
	}
	if (rotation === 270) {
		return [...base, { translate: [0, src.width] }, { rotate: -Math.PI / 2 }];
	}
	return base;
};
