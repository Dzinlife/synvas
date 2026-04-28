import { scheduleAnimationFrameTask } from "../animation/runtime/core";
import type { SharedValue } from "../animation/runtime/types";
import type { SkCanvas, Skia, SkPaint } from "../skia/types";
import type { SkiaOffscreenSurfaceOptions } from "../skia/types/Surface/SurfaceFactory";
import { attachDisposeCleanup } from "../skia/web/Host";
import { skiaCanvasRegistry } from "../views/skiaCanvasRegistry";
import {
	handleContainerRedraw,
	handleContainerUnmount,
} from "./InteractiveTransitions";
import type { Node } from "./Node";
import { createDrawingContext } from "./Recorder/DrawingContext";
import { replay } from "./Recorder/Player";
import type { Recording } from "./Recorder/Recorder";
import { Recorder } from "./Recorder/Recorder";
import { visit } from "./Recorder/Visitor";

let nextAnimationListenerId = 1;

export abstract class Container {
	private _root: Node[] = [];
	protected recording: Recording | null = null;
	protected unmounted = false;
	protected paintPool: SkPaint[] = [];
	protected offscreenSurfaceOptions: SkiaOffscreenSurfaceOptions | undefined;

	constructor(protected Skia: Skia) {}

	get root() {
		return this._root;
	}

	set root(value: Node[]) {
		this._root = value;
	}

	mount() {
		this.unmounted = false;
	}

	unmount() {
		this.unmounted = true;
		handleContainerUnmount(this);
		for (const paint of this.paintPool) {
			try {
				paint.dispose();
			} catch {}
		}
		this.paintPool.length = 0;
	}

	setOffscreenSurfaceOptions(options: SkiaOffscreenSurfaceOptions | undefined) {
		const nextOptions = options ? { ...options } : undefined;
		const previousOptions = this.offscreenSurfaceOptions;
		if (
			previousOptions?.colorSpace === nextOptions?.colorSpace &&
			previousOptions?.dynamicRange === nextOptions?.dynamicRange &&
			previousOptions?.pixelRatio === nextOptions?.pixelRatio
		) {
			return;
		}
		this.offscreenSurfaceOptions = nextOptions;
		if (!this.unmounted && this.recording) {
			this.redraw();
		}
	}

	drawOnCanvas(
		canvas: SkCanvas,
		options?: {
			retainResources?: boolean;
			offscreenSurfaceOptions?: SkiaOffscreenSurfaceOptions;
		},
	) {
		if (!this.recording) {
			throw new Error("No recording to draw");
		}
		const ctx = createDrawingContext(this.Skia, this.paintPool, canvas, {
			...options,
			offscreenSurfaceOptions:
				options?.offscreenSurfaceOptions ?? this.offscreenSurfaceOptions,
		});
		replay(ctx, this.recording.commands);
		return ctx.takeRetainedResources();
	}

	abstract redraw(): void;

	isUnmounted() {
		return this.unmounted;
	}
}

export class StaticContainer extends Container {
	private animationListeners = new Map<SharedValue<unknown>, number>();
	private readonly scheduledPresent = () => {
		if (this.unmounted) {
			return;
		}
		this.present();
	};

	constructor(
		Skia: Skia,
		private canvasId: number,
	) {
		super(Skia);
	}

	override unmount() {
		this.clearAnimationSubscriptions();
		super.unmount();
	}

	redraw() {
		this.rebuildRecording();
		this.present();
	}

	rebuildRecording() {
		handleContainerRedraw(this, this.root);
		const recorder = new Recorder();
		visit(recorder, this.root);
		this.recording = recorder.getRecording();
		this.syncAnimationSubscriptions(this.recording.animationValues);
	}

	present() {
		if (this.recording === null || this.unmounted || this.canvasId === -1) {
			return;
		}
		const rec = this.Skia.PictureRecorder();
		let canvas: SkCanvas | null = null;
		try {
			canvas = rec.beginRecording();
			const retainedResources = this.drawOnCanvas(canvas, {
				retainResources: true,
			});
			const picture = rec.finishRecordingAsPicture();
			if (retainedResources.length > 0) {
				attachDisposeCleanup(picture, () => {
					for (const cleanup of retainedResources) {
						cleanup();
					}
				});
			}
			skiaCanvasRegistry.setCanvasProperty(this.canvasId, "picture", picture);
		} finally {
			(canvas as { dispose?: () => void } | null)?.dispose?.();
			rec.dispose?.();
		}
	}

	private syncAnimationSubscriptions(
		animationValues: Set<SharedValue<unknown>>,
	) {
		for (const [sharedValue, listenerId] of [
			...this.animationListeners.entries(),
		]) {
			if (animationValues.has(sharedValue)) {
				continue;
			}
			sharedValue.removeListener?.(listenerId);
			this.animationListeners.delete(sharedValue);
		}

		for (const sharedValue of animationValues) {
			if (
				this.animationListeners.has(sharedValue) ||
				typeof sharedValue.addListener !== "function"
			) {
				continue;
			}
			const listenerId = nextAnimationListenerId++;
			sharedValue.addListener(listenerId, () => {
				scheduleAnimationFrameTask(this.scheduledPresent);
			});
			this.animationListeners.set(sharedValue, listenerId);
		}
	}

	private clearAnimationSubscriptions() {
		for (const [sharedValue, listenerId] of this.animationListeners) {
			sharedValue.removeListener?.(listenerId);
		}
		this.animationListeners.clear();
	}
}
