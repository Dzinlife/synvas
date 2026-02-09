import type { ReactNode } from "react";
import type { OpaqueRoot } from "react-reconciler";
import ReactReconciler from "react-reconciler";
import { NodeType } from "../dom/types";
import type { SkCanvas, Skia } from "../skia/types";
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

export class SkiaSGRoot {
	private root: OpaqueRoot;
	private container: Container;

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
		this.container.mount();
		this.updateContainer(element);
	}

	drawOnCanvas(canvas: SkCanvas) {
		this.container.drawOnCanvas(canvas);
	}

	getPicture() {
		const recorder = this.Skia.PictureRecorder();
		const canvas = recorder.beginRecording();
		this.drawOnCanvas(canvas);
		return recorder.finishRecordingAsPicture();
	}

	unmount() {
		this.container.unmount();
		this.updateContainer(null, () => {
			debug("unmountContainer");
		});
	}
}
