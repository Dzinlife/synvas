let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

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

export const getAudioContext = (): AudioContext | null => {
	const context = resolveAudioContext();
	if (!context) return null;
	if (!masterGain) {
		masterGain = context.createGain();
		masterGain.gain.value = 1;
		masterGain.connect(context.destination);
	}
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
