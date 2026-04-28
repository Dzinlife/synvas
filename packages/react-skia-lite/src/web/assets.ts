export type WebAssetModule =
	| {
			default: string;
	  }
	| {
			uri: string;
	  };

export type WebAssetSource = string | Uint8Array | WebAssetModule;

export const resolveWebAssetSource = (
	source: WebAssetSource,
): string | Uint8Array => {
	if (typeof source === "string" || source instanceof Uint8Array) {
		return source;
	}
	if ("uri" in source) {
		return source.uri;
	}
	return source.default;
};
