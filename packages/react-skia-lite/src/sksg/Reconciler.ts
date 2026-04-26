import { Fragment, createElement, type ReactNode } from "react";
import type { OpaqueRoot } from "react-reconciler";
import ReactReconciler from "react-reconciler";
import { NodeType } from "../dom/types";
import type { SkCanvas, Skia } from "../skia/types";
import type { SkiaOffscreenSurfaceOptions } from "../skia/types/Surface/SurfaceFactory";
import { attachDisposeCleanup } from "../skia/web/Host";
import { createContainer } from "./Container";
import { debug, sksgHostConfig } from "./HostConfig";
import type { Container } from "./StaticContainer";

import "./Elements";

const skiaReconciler = ReactReconciler(sksgHostConfig);

type SyncCapableReconciler = typeof skiaReconciler & {
	updateContainerSync: (
		element: ReactNode,
		container: OpaqueRoot,
		parentComponent: null,
		callback: null,
	) => void;
	flushSyncWork: () => void;
};

const syncCapableReconciler = skiaReconciler as SyncCapableReconciler;

skiaReconciler.injectIntoDevTools({
	bundleType: 1,
	version: "0.0.1",
	rendererPackageName: "react-native-skia",
});

type ViteHotContext = {
	on: (event: string, callback: (payload: unknown) => void) => void;
	off: (event: string, callback: (payload: unknown) => void) => void;
	dispose?: (callback: () => void) => void;
};

const getViteHotContext = (): ViteHotContext | null => {
	const meta = import.meta as unknown as { hot?: ViteHotContext };
	return meta.hot ?? null;
};

const rootRegistry = new Set<SkiaSGRoot>();
let hmrListenerInstalled = false;
let hmrAfterUpdateHandler: ((payload: unknown) => void) | null = null;

const ensureHmrListener = () => {
	if (hmrListenerInstalled) return;
	const hot = getViteHotContext();
	if (!hot) return;
	const handler = () => {
		// HMR 后统一触发所有 Skia root 的重渲染，覆盖手动 root.render 场景。
		for (const root of rootRegistry) {
			root.refreshForHmr();
		}
	};
	hot.on("vite:afterUpdate", handler);
	hot.dispose?.(() => {
		hot.off("vite:afterUpdate", handler);
		if (hmrAfterUpdateHandler === handler) {
			hmrAfterUpdateHandler = null;
			hmrListenerInstalled = false;
		}
	});
	hmrAfterUpdateHandler = handler;
	hmrListenerInstalled = true;
};

export class SkiaSGRoot {
	private root: OpaqueRoot;
	private container: Container;
	private currentElement: ReactNode = null;
	private hmrRefreshVersion = 0;
	private unmounted = false;

	constructor(
		public Skia: Skia,
		nativeId = -1,
	) {
		const strictMode = false;
		this.container = createContainer(Skia, nativeId);
		this.root = skiaReconciler.createContainer(
			this.container,
			0,
			null,
			strictMode,
			null,
			"",
			console.error,
			console.error,
			console.error,
			() => {},
			null,
		);
		rootRegistry.add(this);
		ensureHmrListener();
	}

	get sg() {
		const children = this.container.root;
		return { type: NodeType.Group, props: {}, children, isDeclaration: false };
	}

	private updateContainer(element: ReactNode, onCommit?: () => void) {
		syncCapableReconciler.updateContainerSync(element, this.root, null, null);
		syncCapableReconciler.flushSyncWork();
		onCommit?.();
	}

	render(element: ReactNode) {
		this.currentElement = element;
		this.unmounted = false;
		this.container.mount();
		this.updateContainer(element);
	}

	refreshForHmr() {
		if (this.unmounted) return;
		this.container.mount();
		this.hmrRefreshVersion += 1;
		// 用 key 强制过一遍 reconciler，确保热更新后样式树立即重算。
		const nextElement = createElement(
			Fragment,
			{ key: `skia-hmr-${this.hmrRefreshVersion}` },
			this.currentElement,
		);
		this.updateContainer(nextElement);
	}

	drawOnCanvas(
		canvas: SkCanvas,
		options?: {
			retainResources?: boolean;
			offscreenSurfaceOptions?: SkiaOffscreenSurfaceOptions;
		},
	) {
		return this.container.drawOnCanvas(canvas, options);
	}

	setOffscreenSurfaceOptions(options: SkiaOffscreenSurfaceOptions | undefined) {
		this.container.setOffscreenSurfaceOptions(options);
	}

	getPicture() {
		const recorder = this.Skia.PictureRecorder();
		let canvas: SkCanvas | null = null;
		try {
			canvas = recorder.beginRecording();
			const retainedResources = this.drawOnCanvas(canvas, {
				retainResources: true,
			});
			const picture = recorder.finishRecordingAsPicture();
			if (retainedResources.length > 0) {
				attachDisposeCleanup(picture, () => {
					for (const cleanup of retainedResources) {
						cleanup();
					}
				});
			}
			return picture;
		} finally {
			(canvas as { dispose?: () => void } | null)?.dispose?.();
			recorder.dispose?.();
		}
	}

	unmount() {
		this.unmounted = true;
		rootRegistry.delete(this);
		this.container.unmount();
		this.updateContainer(null, () => {
			debug("unmountContainer");
		});
	}
}
