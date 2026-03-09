import type { TransformProps } from "../../types";
import type { Skia, SkMatrix } from "../../../skia/types";
import type { Transforms3d } from "../../../skia/types";
import { processTransform } from "../../../skia/types";

const resolveFiniteNumber = (value: unknown): number | null => {
	const candidate =
		typeof value === "object" &&
		value !== null &&
		"value" in value &&
		Number.isFinite((value as { value: unknown }).value)
			? (value as { value: unknown }).value
			: value;
	if (!Number.isFinite(candidate)) return null;
	return Number(candidate);
};

const resolveTransformWithShorthand = (
	props: TransformProps,
): Transforms3d | undefined => {
	const transforms: Transforms3d = [];
	const translateX = resolveFiniteNumber(props.translateX);
	if (translateX !== null && translateX !== 0) {
		transforms.push({ translateX });
	}
	const translateY = resolveFiniteNumber(props.translateY);
	if (translateY !== null && translateY !== 0) {
		transforms.push({ translateY });
	}
	const scale = resolveFiniteNumber(props.scale);
	if (scale !== null && scale !== 1) {
		transforms.push({ scale });
	}
	const scaleX = resolveFiniteNumber(props.scaleX);
	if (scaleX !== null && scaleX !== 1) {
		transforms.push({ scaleX });
	}
	const scaleY = resolveFiniteNumber(props.scaleY);
	if (scaleY !== null && scaleY !== 1) {
		transforms.push({ scaleY });
	}
	const rotate = resolveFiniteNumber(props.rotate);
	if (rotate !== null && rotate !== 0) {
		transforms.push({ rotate });
	}
	const rotateZ = resolveFiniteNumber(props.rotateZ);
	if (rotateZ !== null && rotateZ !== 0) {
		transforms.push({ rotateZ });
	}
	if (Array.isArray(props.transform) && props.transform.length > 0) {
		transforms.push(...props.transform);
	}
	if (transforms.length === 0) return undefined;
	return transforms;
};

export const processTransformProps = (m3: SkMatrix, props: TransformProps) => {
	"worklet";

	const { origin, matrix } = props;
	const transform = resolveTransformWithShorthand(props);
	if (matrix) {
		if (origin) {
			m3.translate(origin.x, origin.y);
			m3.concat(matrix);
			m3.translate(-origin.x, -origin.y);
		} else {
			m3.concat(matrix);
		}
	} else if (transform) {
		if (origin) {
			m3.translate(origin.x, origin.y);
		}
		processTransform(m3, transform);
		if (origin) {
			m3.translate(-origin.x, -origin.y);
		}
	}
};

export const processTransformProps2 = (Skia: Skia, props: TransformProps) => {
	"worklet";

	const { origin, matrix } = props;
	const transform = resolveTransformWithShorthand(props);
	if (matrix) {
		const m3 = Skia.Matrix();
		if (origin) {
			m3.translate(origin.x, origin.y);
			m3.concat(matrix);
			m3.translate(-origin.x, -origin.y);
		} else {
			m3.concat(matrix);
		}
		return m3;
	} else if (transform) {
		const m3 = Skia.Matrix();
		if (origin) {
			m3.translate(origin.x, origin.y);
		}
		processTransform(m3, transform);
		if (origin) {
			m3.translate(-origin.x, -origin.y);
		}
		return m3;
	}
	return null;
};
