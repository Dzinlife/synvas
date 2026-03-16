import {
	type SkiaWebBackendPreference,
	resolveSkiaWebBackendPreference,
	setSkiaWebBackendPreference,
	SKIA_WEB_BACKEND_QUERY_PARAM,
} from "react-skia-lite/bootstrap";

export type { SkiaWebBackendPreference } from "react-skia-lite/bootstrap";

export const getEditorSkiaBackendPreference = (): SkiaWebBackendPreference => {
	return resolveSkiaWebBackendPreference();
};

export const applyEditorSkiaBackendPreference = (
	preference: SkiaWebBackendPreference,
) => {
	setSkiaWebBackendPreference(preference);
	if (typeof window === "undefined") {
		return;
	}
	const nextUrl = new URL(window.location.href);
	const hadQueryOverride = nextUrl.searchParams.has(
		SKIA_WEB_BACKEND_QUERY_PARAM,
	);
	nextUrl.searchParams.delete(SKIA_WEB_BACKEND_QUERY_PARAM);
	if (hadQueryOverride) {
		window.location.assign(nextUrl.toString());
		return;
	}
	window.location.reload();
};
