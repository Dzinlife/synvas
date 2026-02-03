import type { ReactNode } from "react";
import type {
	AudioClipMeta,
	ClipMeta,
	TimelineElement,
	VideoClipMeta,
} from "../types";

export type PrepareFrameContext = {
	element: TimelineElement;
	displayTime: number;
	fps: number;
	phase?: "beforeRender" | "afterRender";
};

export type RendererPrepareFrameContext = {
	element: TimelineElement;
	displayTime: number;
	fps: number;
	modelStore?: ComponentModelStore;
	getModelStore?: (id: string) => ComponentModelStore | undefined;
	canvasSize?: { width: number; height: number };
	fromNode?: ReactNode | null;
	toNode?: ReactNode | null;
};

export interface ComponentConstraints {
	minDuration?: number;
	maxDuration?: number;
	canTrimStart?: boolean;
	canTrimEnd?: boolean;
	aspectRatio?: number;
	minWidth?: number;
	maxWidth?: number;
	isLoading?: boolean;
	hasError?: boolean;
	errorMessage?: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	corrected?: Record<string, unknown>;
}

export interface ComponentModelState<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> {
	id: string;
	type: string;
	props: Props;
	constraints: ComponentConstraints;
	internal: Internal;
}

export interface ComponentModelActions<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> {
	setProps: (partial: Partial<Props>) => ValidationResult;
	setConstraints: (partial: Partial<ComponentConstraints>) => void;
	setInternal: (partial: Partial<Internal>) => void;
	validate: (newProps: Partial<Props>) => ValidationResult;
	init: () => Promise<void> | void;
	dispose: () => void;
	waitForReady?: () => Promise<void>;
	prepareFrame?: (context: PrepareFrameContext) => Promise<void> | void;
}

export type ComponentModel<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> = ComponentModelState<Props, Internal> &
	ComponentModelActions<Props, Internal>;

export type ComponentModelStore<
	Props = Record<string, unknown>,
	Internal = Record<string, unknown>,
> = {
	getState: () => ComponentModel<Props, Internal>;
};

export interface TimelineProps {
	start: number;
	end: number;
	startTimecode: string;
	endTimecode: string;
	fps: number;
}

export type { ClipMeta, VideoClipMeta, AudioClipMeta };

export type VideoClipModel = VideoClipMeta;
export type AudioClipModel = AudioClipMeta;
