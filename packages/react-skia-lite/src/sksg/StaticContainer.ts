import { scheduleAnimationFrameTask } from "../animation/runtime/core";
import type { SharedValue } from "../react-native-types";
import type { SkCanvas, Skia, SkPaint } from "../skia/types";
import { SkiaViewApi } from "../views/api";
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
import "../views/api";

let nextAnimationListenerId = 1;

export abstract class Container {
	private _root: Node[] = [];
	protected recording: Recording | null = null;
	protected unmounted = false;
	protected paintPool: SkPaint[] = [];

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

	drawOnCanvas(canvas: SkCanvas) {
		if (!this.recording) {
			throw new Error("No recording to draw");
		}
		const ctx = createDrawingContext(
			this.Skia,
			this.paintPool,
			canvas,
		);
		replay(ctx, this.recording.commands);
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
		private nativeId: number,
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
		if (this.recording === null || this.unmounted || this.nativeId === -1) {
			return;
		}
		const rec = this.Skia.PictureRecorder();
		const canvas = rec.beginRecording();
		this.drawOnCanvas(canvas);
		const picture = rec.finishRecordingAsPicture();
		SkiaViewApi.setJsiProperty(this.nativeId, "picture", picture);
	}

	private syncAnimationSubscriptions(animationValues: Set<SharedValue<unknown>>) {
		for (const [sharedValue, listenerId] of [...this.animationListeners.entries()]) {
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
