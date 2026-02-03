import JSZip from "jszip";
import { type SkData, Skia, type SkSkottieAnimation } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ComponentModel, ComponentModelStore } from "../model/types";

export interface LottieProps {
	uri?: string;
	loop?: boolean;
	speed?: number;
}

export interface LottieInternal {
	animation: SkSkottieAnimation | null;
	isReady: boolean;
}

export type LottieModelStore = ComponentModelStore<LottieProps, LottieInternal>;

// 加载 Lottie 动画
async function loadLottieAnimation(
	uri: string,
): Promise<SkSkottieAnimation | null> {
	const isDotLottie = uri.toLowerCase().endsWith(".lottie");

	let json: string;
	let assets: Record<string, SkData> | undefined;

	if (isDotLottie) {
		const response = await fetch(uri);
		if (!response.ok) {
			throw new Error(`Failed to load dotLottie file: ${response.statusText}`);
		}
		const arrayBuffer = await response.arrayBuffer();

		const zip = await JSZip.loadAsync(arrayBuffer);

		const manifestFile = zip.file("manifest.json");
		if (!manifestFile) {
			throw new Error("dotLottie file missing manifest.json");
		}

		const manifestText = await manifestFile.async("string");
		const manifest = JSON.parse(manifestText);

		const activeAnimationId =
			manifest.activeAnimationId ||
			(manifest.animations && manifest.animations[0]?.id) ||
			null;

		if (!activeAnimationId) {
			throw new Error("No active animation found in dotLottie file");
		}

		let animationFile =
			zip.file(`animations/${activeAnimationId}.json`) ||
			zip.file(`a/${activeAnimationId}.json`) ||
			zip.file(`${activeAnimationId}.json`);

		if (!animationFile) {
			const jsonFiles = Object.keys(zip.files).filter(
				(name) =>
					name.endsWith(".json") &&
					(name.startsWith("animations/") ||
						name.startsWith("a/") ||
						!name.includes("/")),
			);
			if (jsonFiles.length > 0) {
				animationFile = zip.file(jsonFiles[0]);
			}
		}

		if (!animationFile) {
			throw new Error(`Animation file not found for ID: ${activeAnimationId}`);
		}

		json = await animationFile.async("string");

		const imageDirName = zip.folder("images")
			? "images"
			: zip.folder("i")
				? "i"
				: null;
		if (imageDirName) {
			assets = {};
			const assetPromises: Promise<void>[] = [];
			zip.forEach((relativePath, file) => {
				if (!file.dir && relativePath.startsWith(imageDirName + "/")) {
					assetPromises.push(
						(async () => {
							const imageData = await file.async("uint8array");
							const fileName = relativePath.split("/").pop() || relativePath;
							if (assets) {
								assets[fileName] = Skia.Data.fromBytes(imageData);
							}
						})(),
					);
				}
			});
			await Promise.all(assetPromises);
		}
	} else {
		const response = await fetch(uri);
		if (!response.ok) {
			throw new Error(`Failed to load Lottie file: ${response.statusText}`);
		}
		json = await response.text();

		try {
			const lottieData = JSON.parse(json);
			if (lottieData.assets && Array.isArray(lottieData.assets)) {
				assets = {};
				const baseUrl = new URL(uri);
				const basePath = baseUrl.pathname.substring(
					0,
					baseUrl.pathname.lastIndexOf("/") + 1,
				);

				const assetPromises: Promise<void>[] = [];
				for (const asset of lottieData.assets) {
					if (asset.p || asset.u) {
						const assetPath = asset.p || asset.u;
						if (!assetPath) continue;

						let assetUrl: string;
						if (
							assetPath.startsWith("http://") ||
							assetPath.startsWith("https://")
						) {
							assetUrl = assetPath;
						} else if (assetPath.startsWith("/")) {
							assetUrl = `${baseUrl.origin}${assetPath}`;
						} else {
							assetUrl = `${baseUrl.origin}${basePath}${assetPath}`;
						}

						const fileName = assetPath.split("/").pop() || assetPath;

						assetPromises.push(
							(async () => {
								try {
									const assetResponse = await fetch(assetUrl);
									if (assetResponse.ok) {
										const arrayBuffer = await assetResponse.arrayBuffer();
										const uint8Array = new Uint8Array(arrayBuffer);
										if (assets) {
											assets[fileName] = Skia.Data.fromBytes(uint8Array);
										}
									}
								} catch (err) {
									console.warn(`Failed to load asset ${assetUrl}:`, err);
								}
							})(),
						);
					}
				}
				await Promise.all(assetPromises);
			}
		} catch (err) {
			console.warn("Failed to parse Lottie JSON for assets:", err);
		}
	}

	const skottieAnimation = Skia.Skottie.Make(json, assets);
	if (!skottieAnimation) {
		throw new Error("Failed to create Skottie animation");
	}

	return skottieAnimation;
}

export function createLottieModel(
	id: string,
	initialProps: LottieProps,
): LottieModelStore {
	const store = createStore<ComponentModel<LottieProps, LottieInternal>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Lottie",
			props: {
				loop: true,
				speed: 1.0,
				...initialProps,
			},
			constraints: {
				isLoading: false,
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				animation: null,
				isReady: false,
			},

			setProps: (partial) => {
				set((state) => ({
					...state,
					props: { ...state.props, ...partial },
				}));
				return { valid: true, errors: [] };
			},

			setConstraints: (partial) => {
				set((state) => ({
					...state,
					constraints: { ...state.constraints, ...partial },
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					...state,
					internal: { ...state.internal, ...partial },
				}));
			},

			validate: () => ({ valid: true, errors: [] }),

			init: async () => {
				const { uri } = get().props;
				if (!uri) return;

				try {
					set((state) => ({
						...state,
						constraints: { ...state.constraints, isLoading: true },
					}));

					const animation = await loadLottieAnimation(uri);

					set((state) => ({
						...state,
						constraints: { ...state.constraints, isLoading: false },
						internal: {
							...state.internal,
							animation,
							isReady: true,
						},
					}));
				} catch (err) {
					console.error(`Failed to load Lottie for ${id}:`, err);
					set((state) => ({
						...state,
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: true,
							errorMessage: err instanceof Error ? err.message : String(err),
						},
					}));
				}
			},

			dispose: () => {
				set((state) => ({
					...state,
					internal: {
						...state.internal,
						animation: null,
						isReady: false,
					},
				}));
			},

			waitForReady: () => {
				return new Promise<void>((resolve) => {
					const { internal } = get();
					if (internal.isReady) {
						resolve();
						return;
					}
					const unsubscribe = store.subscribe(
						(state) => state.internal.isReady,
						(isReady) => {
							if (isReady) {
								unsubscribe();
								resolve();
							}
						},
					);
				});
			},
		})),
	);

	return store;
}
