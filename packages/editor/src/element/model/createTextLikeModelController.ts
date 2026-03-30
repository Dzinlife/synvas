import type {
	SkParagraph,
	SkTypeface,
	SkTypefaceFontProvider,
} from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import {
	type TextTypographyRunPlan,
	textTypographyFacade,
} from "@/typography/textTypographyFacade";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "./types";

export interface TextLikeModelInternalBase {
	paragraph: SkParagraph | null;
	fontProvider: SkTypefaceFontProvider | null;
	isReady: boolean;
}

export interface CreateTextLikeModelControllerOptions<
	Props extends { text: string },
	Internal extends TextLikeModelInternalBase,
> {
	id: string;
	type: string;
	initialProps: Props;
	normalizeProps: (props: Partial<Props> | Props | undefined) => Props;
	validateProps: (newProps: Partial<Props>) => ValidationResult;
	createInitialInternal: () => Internal;
	buildParagraphFromRunPlan: (params: {
		props: Props;
		fontProvider: SkTypefaceFontProvider | null;
		runPlan: TextTypographyRunPlan[];
		primaryFamily: string;
	}) => SkParagraph;
	buildExtraInternal?: (params: {
		props: Props;
		runPlan: TextTypographyRunPlan[];
		primaryTypeface: SkTypeface | null;
	}) => Partial<Internal>;
	disposeExtraInternal?: (internal: Internal) => void;
	disposeBuiltExtraInternal?: (internal: Partial<Internal>) => void;
}

export const createTextLikeModelController = <
	Props extends { text: string },
	Internal extends TextLikeModelInternalBase,
>(
	options: CreateTextLikeModelControllerOptions<Props, Internal>,
): ComponentModelStore<Props, Internal> => {
	let disposed = false;
	let rebuildEpoch = 0;
	let unsubscribeTypographyRevision: (() => void) | null = null;
	let store!: ComponentModelStore<Props, Internal>;

	const setLoadingState = () => {
		store.setState((state) => ({
			...state,
			constraints: {
				...state.constraints,
				isLoading: true,
				hasError: false,
				errorMessage: undefined,
			},
			internal: {
				...state.internal,
				isReady: false,
			},
		}));
	};

	const applyBuildError = (error: unknown) => {
		store.setState((state) => ({
			...state,
			constraints: {
				...state.constraints,
				isLoading: false,
				hasError: true,
				errorMessage: error instanceof Error ? error.message : String(error),
			},
			internal: {
				...state.internal,
				isReady: false,
			},
		}));
	};

	const disposePreviousInternal = (internal: Internal) => {
		internal.paragraph?.dispose();
		options.disposeExtraInternal?.(internal);
	};

	const rebuildParagraph = async (props: Props): Promise<void> => {
		const currentEpoch = ++rebuildEpoch;
		const normalizedProps = options.normalizeProps(props);
		setLoadingState();

		let renderContext: Awaited<
			ReturnType<typeof textTypographyFacade.resolveRenderContext>
		>;
		try {
			renderContext = await textTypographyFacade.resolveRenderContext(
				normalizedProps.text,
			);
		} catch (error) {
			if (disposed || currentEpoch !== rebuildEpoch) {
				return;
			}
			applyBuildError(error);
			return;
		}

		if (disposed || currentEpoch !== rebuildEpoch) {
			return;
		}

		let paragraph: SkParagraph | null = null;
		let nextExtraInternal: Partial<Internal> = {};
		try {
			paragraph = options.buildParagraphFromRunPlan({
				props: normalizedProps,
				fontProvider: renderContext.fontProvider,
				runPlan: renderContext.runPlan,
				primaryFamily: renderContext.primaryFamily,
			});
			nextExtraInternal =
				options.buildExtraInternal?.({
					props: normalizedProps,
					runPlan: renderContext.runPlan,
					primaryTypeface: renderContext.primaryTypeface,
				}) ?? {};
		} catch (error) {
			paragraph?.dispose();
			options.disposeBuiltExtraInternal?.(nextExtraInternal);
			if (disposed || currentEpoch !== rebuildEpoch) {
				return;
			}
			applyBuildError(error);
			return;
		}

		if (disposed || currentEpoch !== rebuildEpoch) {
			paragraph?.dispose();
			options.disposeBuiltExtraInternal?.(nextExtraInternal);
			return;
		}

		const previousInternal = store.getState().internal;
		if (
			previousInternal.paragraph &&
			previousInternal.paragraph !== paragraph
		) {
			previousInternal.paragraph.dispose();
		}
		options.disposeExtraInternal?.(previousInternal);
		const resetInternal = options.createInitialInternal();
		store.setState((state) => ({
			...state,
			constraints: {
				...state.constraints,
				isLoading: false,
				hasError: false,
				errorMessage: undefined,
			},
			internal: {
				...state.internal,
				...resetInternal,
				...nextExtraInternal,
				paragraph,
				fontProvider: renderContext.fontProvider,
				isReady: true,
			},
		}));
	};

	store = createStore<ComponentModel<Props, Internal>>()(
		subscribeWithSelector((set, get) => ({
			id: options.id,
			type: options.type,
			props: options.normalizeProps(options.initialProps),
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
				isLoading: false,
			},
			internal: options.createInitialInternal(),

			setProps: (partial) => {
				const result = options.validateProps(partial);
				if (!result.valid) return result;
				const nextProps = options.normalizeProps({
					...get().props,
					...partial,
				});
				set((state) => ({
					...state,
					props: nextProps,
				}));
				void rebuildParagraph(nextProps);
				return result;
			},

			setConstraints: (partial) => {
				set((state) => ({
					...state,
					constraints: {
						...state.constraints,
						...partial,
					},
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					...state,
					internal: {
						...state.internal,
						...partial,
					},
				}));
			},

			validate: (newProps) => {
				return options.validateProps(newProps);
			},

			init: async () => {
				await rebuildParagraph(get().props);
			},

			dispose: () => {
				disposed = true;
				rebuildEpoch += 1;
				unsubscribeTypographyRevision?.();
				unsubscribeTypographyRevision = null;
				disposePreviousInternal(get().internal);
				const resetInternal = options.createInitialInternal();
				set((state) => ({
					...state,
					internal: {
						...state.internal,
						...resetInternal,
						paragraph: null,
						fontProvider: null,
						isReady: false,
					},
					constraints: {
						...state.constraints,
						isLoading: false,
					},
				}));
			},

			waitForReady: () => {
				return new Promise<void>((resolve) => {
					const currentState = get();
					if (
						currentState.internal.isReady &&
						!currentState.constraints.isLoading
					) {
						resolve();
						return;
					}
					const unsubscribe = store.subscribe((state) => {
						if (!state.internal.isReady || state.constraints.isLoading) return;
						unsubscribe();
						resolve();
					});
				});
			},
		})),
	);

	unsubscribeTypographyRevision = textTypographyFacade.subscribeRevision(() => {
		if (disposed) return;
		void rebuildParagraph(store.getState().props);
	});

	return store;
};
