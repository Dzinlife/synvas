import type { CanvasSink, WrappedCanvas } from "mediabunny";

type VideoPlaybackSession = {
	key: string;
	refCount: number;
	disposeTimer: ReturnType<typeof setTimeout> | null;
	playbackIdleTimer: ReturnType<typeof setTimeout> | null;
	lastTouch: number;
	asyncId: number;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	nextFrame: WrappedCanvas | null;
	isActive: boolean;
	isStepping: boolean;
	lastTargetTime: number | null;
	sink: CanvasSink | null;
	getIsExporting: (() => boolean) | null;
};

type StepVideoPlaybackSessionOptions = {
	key: string;
	sink: CanvasSink | null;
	targetTime: number;
	backJumpThresholdSeconds: number;
	isExporting?: () => boolean;
};

const SESSION_DISPOSE_IDLE_MS = 500;
const PLAYBACK_IDLE_MS = 500;

const sessionByKey = new Map<string, VideoPlaybackSession>();
const getNow = () =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

const createSession = (key: string): VideoPlaybackSession => ({
	key,
	refCount: 0,
	disposeTimer: null,
	playbackIdleTimer: null,
	lastTouch: 0,
	asyncId: 0,
	iterator: null,
	nextFrame: null,
	isActive: false,
	isStepping: false,
	lastTargetTime: null,
	sink: null,
	getIsExporting: null,
});

const getOrCreateSession = (key: string): VideoPlaybackSession => {
	const existing = sessionByKey.get(key);
	if (existing) {
		if (existing.disposeTimer) {
			clearTimeout(existing.disposeTimer);
			existing.disposeTimer = null;
		}
		return existing;
	}
	const created = createSession(key);
	sessionByKey.set(key, created);
	return created;
};

const stopSessionInternal = (session: VideoPlaybackSession) => {
	session.asyncId += 1;
	session.isActive = false;
	session.isStepping = false;
	session.lastTargetTime = null;
	session.nextFrame = null;
	if (session.playbackIdleTimer) {
		clearTimeout(session.playbackIdleTimer);
		session.playbackIdleTimer = null;
	}
	session.iterator?.return?.();
	session.iterator = null;
};

const disposeSessionInternal = (session: VideoPlaybackSession) => {
	if (session.disposeTimer) {
		clearTimeout(session.disposeTimer);
		session.disposeTimer = null;
	}
	stopSessionInternal(session);
	session.sink = null;
	session.getIsExporting = null;
	sessionByKey.delete(session.key);
};

const isSessionExporting = (session: VideoPlaybackSession): boolean => {
	return session.getIsExporting?.() === true;
};

const touchSession = (session: VideoPlaybackSession) => {
	session.lastTouch = getNow();
	if (session.playbackIdleTimer) {
		clearTimeout(session.playbackIdleTimer);
	}
	if (isSessionExporting(session)) {
		session.playbackIdleTimer = null;
		return;
	}
	session.playbackIdleTimer = setTimeout(() => {
		if (isSessionExporting(session)) return;
		const now = getNow();
		if (now - session.lastTouch < PLAYBACK_IDLE_MS) return;
		stopSessionInternal(session);
	}, PLAYBACK_IDLE_MS);
};

const startSessionPlayback = async (
	session: VideoPlaybackSession,
	sink: CanvasSink,
	startTime: number,
): Promise<void> => {
	stopSessionInternal(session);
	session.sink = sink;
	session.isActive = true;
	session.asyncId += 1;
	const currentAsyncId = session.asyncId;
	try {
		const iterator = sink.canvases(startTime);
		if (!iterator || typeof iterator.next !== "function") {
			session.isActive = false;
			return;
		}
		session.iterator = iterator;
		const firstResult = await iterator.next();
		if (session.asyncId !== currentAsyncId) return;
		session.nextFrame = firstResult.value ?? null;
	} catch (error) {
		console.warn("Start video playback session failed:", error);
		session.isActive = false;
	}
};

const drainSessionFrames = async (
	session: VideoPlaybackSession,
	targetTime: number,
): Promise<WrappedCanvas | null> => {
	if (!session.isActive || !session.iterator) return null;
	if (session.isStepping) return null;
	session.isStepping = true;
	const currentAsyncId = session.asyncId;
	try {
		let frameToShow: WrappedCanvas | null = null;
		while (session.nextFrame && session.nextFrame.timestamp <= targetTime) {
			frameToShow = session.nextFrame;
			const result = await session.iterator.next();
			if (session.asyncId !== currentAsyncId) return null;
			session.nextFrame = result.value ?? null;
			if (!session.nextFrame) break;
		}
		return frameToShow;
	} catch (error) {
		console.warn("Drain video playback session frames failed:", error);
		return null;
	} finally {
		session.isStepping = false;
	}
};

export const retainVideoPlaybackSession = (key: string) => {
	const session = getOrCreateSession(key);
	session.refCount += 1;
};

export const releaseVideoPlaybackSession = (key: string) => {
	const session = sessionByKey.get(key);
	if (!session) return;
	session.refCount = Math.max(0, session.refCount - 1);
	if (session.refCount > 0) return;
	if (session.disposeTimer) {
		clearTimeout(session.disposeTimer);
	}
	session.disposeTimer = setTimeout(() => {
		const latest = sessionByKey.get(key);
		if (!latest) return;
		if (latest.refCount > 0) return;
		disposeSessionInternal(latest);
	}, SESSION_DISPOSE_IDLE_MS);
};

export const stopVideoPlaybackSession = (key: string) => {
	const session = sessionByKey.get(key);
	if (!session) return;
	stopSessionInternal(session);
};

export const stepVideoPlaybackSession = async ({
	key,
	sink,
	targetTime,
	backJumpThresholdSeconds,
	isExporting,
}: StepVideoPlaybackSessionOptions): Promise<WrappedCanvas | null> => {
	if (!Number.isFinite(targetTime)) return null;
	if (!sink) return null;
	const session = getOrCreateSession(key);
	session.getIsExporting = isExporting ?? null;
	touchSession(session);
	if (session.sink && session.sink !== sink) {
		stopSessionInternal(session);
	}
	if (!session.isActive || session.sink !== sink) {
		await startSessionPlayback(session, sink, targetTime);
	}
	if (
		session.lastTargetTime !== null &&
		targetTime < session.lastTargetTime - backJumpThresholdSeconds
	) {
		await startSessionPlayback(session, sink, targetTime);
	}
	const frameToShow = await drainSessionFrames(session, targetTime);
	session.lastTargetTime = targetTime;
	return frameToShow;
};

export const __resetVideoPlaybackSessionPoolForTests = () => {
	for (const session of sessionByKey.values()) {
		disposeSessionInternal(session);
	}
	sessionByKey.clear();
};
