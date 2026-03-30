import type { SkTypeface, SkTypefaceFontProvider } from "react-skia-lite";
import {
	FONT_REGISTRY_PRIMARY_FAMILY,
	fontRegistry,
	type RunPlan,
} from "./fontRegistry";

export interface TextTypographyRenderContext {
	fontProvider: SkTypefaceFontProvider | null;
	primaryTypeface: SkTypeface | null;
	runPlan: RunPlan[];
	primaryFamily: string;
}

export type TextTypographyRevisionListener = () => void;

const queueMicrotaskSafe = (task: () => void) => {
	if (typeof queueMicrotask === "function") {
		queueMicrotask(task);
		return;
	}
	void Promise.resolve().then(task);
};

class TextTypographyFacade {
	private listeners = new Set<TextTypographyRevisionListener>();
	private unsubscribeFontRegistry: (() => void) | null = null;
	private revision = 0;
	private flushScheduled = false;
	private pendingRafId: number | null = null;

	private ensureFontRegistrySubscription() {
		if (this.unsubscribeFontRegistry) {
			return;
		}
		this.unsubscribeFontRegistry = fontRegistry.subscribe(() => {
			this.scheduleRevisionFlush();
		});
	}

	private releaseFontRegistrySubscriptionIfIdle() {
		if (this.listeners.size > 0) {
			return;
		}
		this.unsubscribeFontRegistry?.();
		this.unsubscribeFontRegistry = null;
	}

	private flushRevision() {
		this.flushScheduled = false;
		this.pendingRafId = null;
		if (this.listeners.size <= 0) {
			return;
		}
		this.revision += 1;
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.warn("[TextTypographyFacade] revision listener failed:", error);
			}
		}
	}

	private scheduleRevisionFlush() {
		if (this.flushScheduled) {
			return;
		}
		this.flushScheduled = true;
		if (
			typeof window !== "undefined" &&
			typeof window.requestAnimationFrame === "function"
		) {
			this.pendingRafId = window.requestAnimationFrame(() => {
				this.flushRevision();
			});
			return;
		}
		queueMicrotaskSafe(() => {
			this.flushRevision();
		});
	}

	async resolveRenderContext(
		text: string,
	): Promise<TextTypographyRenderContext> {
		const normalizedText = typeof text === "string" ? text : "";
		try {
			await fontRegistry.ensureCoverage({ text: normalizedText });
		} catch (error) {
			console.warn("[TextTypographyFacade] ensureCoverage failed:", error);
		}
		const fontProvider = await fontRegistry.getFontProvider();
		const runPlan = fontRegistry.getParagraphRunPlan(normalizedText);
		const primaryTypeface = fontRegistry.getPrimaryTypeface();
		return {
			fontProvider,
			primaryTypeface,
			runPlan,
			primaryFamily: FONT_REGISTRY_PRIMARY_FAMILY,
		};
	}

	subscribeRevision(listener: TextTypographyRevisionListener): () => void {
		this.ensureFontRegistrySubscription();
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
			this.releaseFontRegistrySubscriptionIfIdle();
		};
	}

	getRevisionForTests(): number {
		return this.revision;
	}

	resetForTests() {
		if (this.pendingRafId !== null && typeof window !== "undefined") {
			window.cancelAnimationFrame?.(this.pendingRafId);
		}
		this.pendingRafId = null;
		this.flushScheduled = false;
		this.revision = 0;
		this.listeners.clear();
		this.unsubscribeFontRegistry?.();
		this.unsubscribeFontRegistry = null;
	}
}

export const textTypographyFacade = new TextTypographyFacade();

export const TEXT_TYPOGRAPHY_PRIMARY_FAMILY = FONT_REGISTRY_PRIMARY_FAMILY;

export const __resetTextTypographyFacadeForTests = (): void => {
	textTypographyFacade.resetForTests();
};

export type { RunPlan as TextTypographyRunPlan };
