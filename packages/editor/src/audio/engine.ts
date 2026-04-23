import {
	DEFAULT_EXPORT_AUDIO_DSP_SETTINGS,
	type ExportAudioDspSettings,
	resolveExportAudioDspSettings,
} from "core/audio-system/settings";
import type { PreviewLoudnessSnapshot } from "@/audio/types";
import { PREVIEW_DSP_WORKLET_PROCESSOR_NAME } from "./previewDspConstants";

export type { PreviewLoudnessSnapshot } from "@/audio/types";

const PREVIEW_DSP_WORKLET_MODULE_URL = new URL(
	"./previewDspWorklet.ts",
	import.meta.url,
);

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let previewDspNode: AudioWorkletNode | null = null;
let previewDspNodeInitPromise: Promise<void> | null = null;
let directDestinationConnected = false;

type PreviewMeterMessage = {
	type: "meter";
	leftRms: number;
	rightRms: number;
	leftPeak: number;
	rightPeak: number;
};

const createDefaultAudioSettings = (): ExportAudioDspSettings => ({
	...DEFAULT_EXPORT_AUDIO_DSP_SETTINGS,
	compressor: { ...DEFAULT_EXPORT_AUDIO_DSP_SETTINGS.compressor },
});

let previewAudioSettings: ExportAudioDspSettings = createDefaultAudioSettings();

const createInitialPreviewLoudnessSnapshot = (): PreviewLoudnessSnapshot => ({
	leftRms: 0,
	rightRms: 0,
	leftPeak: 0,
	rightPeak: 0,
	updatedAtMs: 0,
});

let previewLoudnessSnapshot = createInitialPreviewLoudnessSnapshot();
const previewLoudnessListeners = new Set<
	(snapshot: PreviewLoudnessSnapshot) => void
>();

const clampUnit = (value: unknown): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const nowMilliseconds = (): number => {
	if (
		typeof performance !== "undefined" &&
		Number.isFinite(performance.now())
	) {
		return performance.now();
	}
	return Date.now();
};

const applyPreviewMeterMessage = (message: PreviewMeterMessage) => {
	const nextSnapshot: PreviewLoudnessSnapshot = {
		leftRms: clampUnit(message.leftRms),
		rightRms: clampUnit(message.rightRms),
		leftPeak: clampUnit(message.leftPeak),
		rightPeak: clampUnit(message.rightPeak),
		updatedAtMs: nowMilliseconds(),
	};
	previewLoudnessSnapshot = nextSnapshot;
	for (const listener of previewLoudnessListeners) {
		listener(nextSnapshot);
	}
};

const resolveAudioContext = (): AudioContext | null => {
	if (typeof window === "undefined") return null;
	const AudioContextImpl =
		window.AudioContext ||
		(window as Window & { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;
	if (!AudioContextImpl) return null;
	if (!audioContext) {
		audioContext = new AudioContextImpl();
	}
	return audioContext;
};

const safeDisconnect = (
	node: Pick<AudioNode, "disconnect"> | null | undefined,
) => {
	if (!node) return;
	try {
		node.disconnect();
	} catch {}
};

const connectMasterDirectly = (context: AudioContext) => {
	if (!masterGain || directDestinationConnected) return;
	masterGain.connect(context.destination);
	directDestinationConnected = true;
};

const disconnectMasterDirect = () => {
	if (!masterGain || !directDestinationConnected) return;
	try {
		masterGain.disconnect();
	} catch {}
	directDestinationConnected = false;
};

const postDspConfigToWorklet = () => {
	if (!previewDspNode) return;
	previewDspNode.port.postMessage({
		type: "config",
		config: previewAudioSettings,
	});
};

const supportsAudioWorklet = (
	context: AudioContext,
): context is AudioContext & { audioWorklet: AudioWorklet } => {
	return typeof context.audioWorklet?.addModule === "function";
};

const ensurePreviewDspNodeAsync = (context: AudioContext) => {
	if (!masterGain) return;
	if (previewDspNode?.context === context) {
		postDspConfigToWorklet();
		return;
	}
	if (previewDspNodeInitPromise) return;

	connectMasterDirectly(context);

	if (
		!supportsAudioWorklet(context) ||
		typeof AudioWorkletNode === "undefined"
	) {
		console.warn("[AudioEngine] AudioWorklet 不可用，预览音频将绕过 DSP。");
		return;
	}

	previewDspNodeInitPromise = (async () => {
		await context.audioWorklet.addModule(PREVIEW_DSP_WORKLET_MODULE_URL.href);
		// 构建期间上下文可能已切换，避免连接到过期上下文
		if (audioContext !== context || !masterGain) return;

		const nextDspNode = new AudioWorkletNode(
			context,
			PREVIEW_DSP_WORKLET_PROCESSOR_NAME,
			{
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				channelCount: 2,
				channelCountMode: "explicit",
				channelInterpretation: "speakers",
				processorOptions: {
					config: previewAudioSettings,
				},
			},
		);
		nextDspNode.port.onmessage = (event: MessageEvent<PreviewMeterMessage>) => {
			const message = event.data;
			if (!message || message.type !== "meter") return;
			applyPreviewMeterMessage(message);
		};
		nextDspNode.connect(context.destination);
		safeDisconnect(previewDspNode);
		previewDspNode = nextDspNode;

		disconnectMasterDirect();
		masterGain.connect(nextDspNode);
		postDspConfigToWorklet();
	})()
		.catch((error) => {
			console.error("[AudioEngine] AudioWorklet 初始化失败:", error);
			connectMasterDirectly(context);
		})
		.finally(() => {
			previewDspNodeInitPromise = null;
		});
};

const ensureMasterOutputGraph = (context: AudioContext) => {
	if (!masterGain) return;
	if (previewDspNode?.context === context) {
		disconnectMasterDirect();
		postDspConfigToWorklet();
		return;
	}
	ensurePreviewDspNodeAsync(context);
};

export const setPreviewAudioDspSettings = (
	settings: ExportAudioDspSettings | undefined,
) => {
	const next = resolveExportAudioDspSettings(settings);
	previewAudioSettings = {
		...next,
		compressor: { ...next.compressor },
	};
	postDspConfigToWorklet();
	const context = audioContext;
	if (!context || !masterGain) return;
	ensureMasterOutputGraph(context);
};

export const getPreviewLoudnessSnapshot = (): PreviewLoudnessSnapshot => {
	return previewLoudnessSnapshot;
};

export const subscribePreviewLoudness = (
	listener: (snapshot: PreviewLoudnessSnapshot) => void,
): (() => void) => {
	previewLoudnessListeners.add(listener);
	return () => {
		previewLoudnessListeners.delete(listener);
	};
};

export const getAudioContext = (): AudioContext | null => {
	const context = resolveAudioContext();
	if (!context) return null;
	if (!masterGain) {
		masterGain = context.createGain();
		masterGain.gain.value = 1;
	}
	ensureMasterOutputGraph(context);
	return context;
};

export const ensureAudioContext = async (): Promise<AudioContext | null> => {
	const context = getAudioContext();
	if (!context) return null;
	if (context.state === "suspended") {
		try {
			await context.resume();
		} catch {
			return context;
		}
	}
	return context;
};

export const getMasterGain = (): GainNode | null => {
	getAudioContext();
	return masterGain;
};

export const createClipGain = (): GainNode | null => {
	const context = getAudioContext();
	if (!context) return null;
	const master = getMasterGain();
	if (!master) return null;
	const gain = context.createGain();
	gain.gain.value = 1;
	gain.connect(master);
	return gain;
};

export const __resetAudioEngineForTests = () => {
	safeDisconnect(masterGain);
	safeDisconnect(previewDspNode);
	masterGain = null;
	previewDspNode = null;
	audioContext = null;
	previewDspNodeInitPromise = null;
	directDestinationConnected = false;
	previewAudioSettings = createDefaultAudioSettings();
	previewLoudnessListeners.clear();
	previewLoudnessSnapshot = createInitialPreviewLoudnessSnapshot();
};
