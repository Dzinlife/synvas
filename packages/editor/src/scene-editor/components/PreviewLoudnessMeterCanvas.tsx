import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import {
	getPreviewLoudnessSnapshot,
	type PreviewLoudnessSnapshot,
	subscribePreviewLoudness,
} from "@/audio/engine";

const METER_MIN_DB = -60;
const METER_MAX_DB = 0;
const PEAK_HOLD_MS = 600;
const METER_SIGNAL_STALE_MS = 180;
const METER_ACTIVE_AMP_EPSILON = 0.001;
const METER_STATE_EPSILON_DB = 0.1;
const RMS_RISE_SMOOTHING_PER_SECOND = 20;
const RMS_FALL_DB_PER_SECOND = 40;
const PEAK_FALL_DB_PER_SECOND = 24;

type MeterState = {
	lastFrameMs: number;
	leftDb: number;
	rightDb: number;
	leftPeakDb: number;
	rightPeakDb: number;
	leftPeakHoldUntilMs: number;
	rightPeakHoldUntilMs: number;
};

const clampDb = (value: number): number => {
	if (!Number.isFinite(value)) return METER_MIN_DB;
	return Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, value));
};

const ampToDb = (amp: number): number => {
	const safeAmp = Math.max(1e-5, Number.isFinite(amp) ? amp : 0);
	return clampDb(20 * Math.log10(safeAmp));
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

interface PreviewLoudnessMeterCanvasProps {
	active?: boolean;
}

const PreviewLoudnessMeterCanvas: React.FC<PreviewLoudnessMeterCanvasProps> = ({
	active = true,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const viewportRef = useRef({ width: 60, height: 44 });
	const targetSnapshotRef = useRef<PreviewLoudnessSnapshot>(
		getPreviewLoudnessSnapshot(),
	);
	const meterStateRef = useRef<MeterState>({
		lastFrameMs: 0,
		leftDb: METER_MIN_DB,
		rightDb: METER_MIN_DB,
		leftPeakDb: METER_MIN_DB,
		rightPeakDb: METER_MIN_DB,
		leftPeakHoldUntilMs: 0,
		rightPeakHoldUntilMs: 0,
	});
	const rafIdRef = useRef<number | null>(null);

	const drawFrame = useCallback((frameTimeMs: number): boolean => {
		const canvas = canvasRef.current;
		if (!canvas) return false;
		const ctx = canvas.getContext("2d");
		if (!ctx) return false;

		const { width, height } = viewportRef.current;
		if (width <= 0 || height <= 0) return false;

		const state = meterStateRef.current;
		if (!state.lastFrameMs) {
			state.lastFrameMs = frameTimeMs;
		}
		const deltaSeconds = Math.max(
			0,
			Math.min(0.1, (frameTimeMs - state.lastFrameMs) / 1000),
		);
		state.lastFrameMs = frameTimeMs;

		const snapshot = targetSnapshotRef.current;
		const isSignalStale =
			snapshot.updatedAtMs <= 0 ||
			frameTimeMs - snapshot.updatedAtMs > METER_SIGNAL_STALE_MS;
		const leftTargetDb = ampToDb(isSignalStale ? 0 : snapshot.leftRms);
		const rightTargetDb = ampToDb(isSignalStale ? 0 : snapshot.rightRms);
		const leftPeakTargetDb = ampToDb(isSignalStale ? 0 : snapshot.leftPeak);
		const rightPeakTargetDb = ampToDb(isSignalStale ? 0 : snapshot.rightPeak);

		const riseFactor =
			1 - Math.exp(-RMS_RISE_SMOOTHING_PER_SECOND * deltaSeconds);

		if (leftTargetDb >= state.leftDb) {
			state.leftDb += (leftTargetDb - state.leftDb) * riseFactor;
		} else {
			state.leftDb = Math.max(
				leftTargetDb,
				state.leftDb - RMS_FALL_DB_PER_SECOND * deltaSeconds,
			);
		}
		if (rightTargetDb >= state.rightDb) {
			state.rightDb += (rightTargetDb - state.rightDb) * riseFactor;
		} else {
			state.rightDb = Math.max(
				rightTargetDb,
				state.rightDb - RMS_FALL_DB_PER_SECOND * deltaSeconds,
			);
		}

		if (leftPeakTargetDb >= state.leftPeakDb) {
			state.leftPeakDb = leftPeakTargetDb;
			state.leftPeakHoldUntilMs = frameTimeMs + PEAK_HOLD_MS;
		} else if (frameTimeMs > state.leftPeakHoldUntilMs) {
			state.leftPeakDb = Math.max(
				leftPeakTargetDb,
				state.leftPeakDb - PEAK_FALL_DB_PER_SECOND * deltaSeconds,
			);
		}
		if (rightPeakTargetDb >= state.rightPeakDb) {
			state.rightPeakDb = rightPeakTargetDb;
			state.rightPeakHoldUntilMs = frameTimeMs + PEAK_HOLD_MS;
		} else if (frameTimeMs > state.rightPeakHoldUntilMs) {
			state.rightPeakDb = Math.max(
				rightPeakTargetDb,
				state.rightPeakDb - PEAK_FALL_DB_PER_SECOND * deltaSeconds,
			);
		}

		state.leftDb = clampDb(state.leftDb);
		state.rightDb = clampDb(state.rightDb);
		state.leftPeakDb = clampDb(state.leftPeakDb);
		state.rightPeakDb = clampDb(state.rightPeakDb);

		const paddingTop = 0;
		const paddingBottom = 0;
		const paddingLeft = 0;
		const paddingRight = 0;
		const meterTop = paddingTop;
		const meterBottom = height - paddingBottom;
		const meterHeight = meterBottom - meterTop;
		const meterAreaLeft = paddingLeft;
		const meterAreaRight = width - paddingRight;
		const meterAreaWidth = meterAreaRight - meterAreaLeft;
		const channelGap = 2;
		const channelWidth = (meterAreaWidth - channelGap) / 2;
		const leftChannelX = meterAreaLeft;
		const rightChannelX = meterAreaLeft + channelWidth + channelGap;

		const dbToY = (db: number): number => {
			const ratio =
				(clampDb(db) - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
			return meterBottom - ratio * meterHeight;
		};

		ctx.clearRect(0, 0, width, height);

		const dividerY = Math.round(dbToY(-6));
		const drawChannelBackground = (x: number) => {
			const topHeight = Math.max(0, dividerY - meterTop);
			const bottomY = dividerY + 1;
			const bottomHeight = Math.max(0, meterBottom - bottomY);
			ctx.fillStyle = "rgba(239,68,68,0.18)";
			ctx.fillRect(x, meterTop, channelWidth, topHeight);
			ctx.fillStyle = "rgba(34,197,94,0.16)";
			ctx.fillRect(x, bottomY, channelWidth, bottomHeight);
		};
		drawChannelBackground(leftChannelX);
		drawChannelBackground(rightChannelX);

		const drawChannelLevel = (x: number, levelDb: number) => {
			const levelY = dbToY(levelDb);
			const zones = [
				{ topDb: 0, bottomDb: -6, color: "rgba(239,68,68,0.95)" },
				{ topDb: -6, bottomDb: -12, color: "rgba(234,179,8,0.95)" },
				{ topDb: -12, bottomDb: -60, color: "rgba(34,197,94,0.95)" },
			] as const;
			for (const zone of zones) {
				const zoneTopY = dbToY(zone.topDb);
				const zoneBottomY = dbToY(zone.bottomDb);
				const fillTopY = Math.max(levelY, zoneTopY);
				if (fillTopY < zoneBottomY) {
					ctx.fillStyle = zone.color;
					ctx.fillRect(x, fillTopY, channelWidth, zoneBottomY - fillTopY);
				}
			}
		};

		drawChannelLevel(leftChannelX, state.leftDb);
		drawChannelLevel(rightChannelX, state.rightDb);

		const hasActiveSignal =
			!isSignalStale &&
			Math.max(
				snapshot.leftRms,
				snapshot.rightRms,
				snapshot.leftPeak,
				snapshot.rightPeak,
			) > METER_ACTIVE_AMP_EPSILON;
		const hasResidualAnimation =
			state.leftDb > METER_MIN_DB + METER_STATE_EPSILON_DB ||
			state.rightDb > METER_MIN_DB + METER_STATE_EPSILON_DB ||
			state.leftPeakDb > METER_MIN_DB + METER_STATE_EPSILON_DB ||
			state.rightPeakDb > METER_MIN_DB + METER_STATE_EPSILON_DB ||
			state.leftPeakHoldUntilMs > frameTimeMs ||
			state.rightPeakHoldUntilMs > frameTimeMs;
		return hasActiveSignal || hasResidualAnimation;
	}, []);

	const startAnimation = useCallback(() => {
		if (typeof window === "undefined") return;
		if (rafIdRef.current !== null) return;
		const animate = (frameTime: number) => {
			rafIdRef.current = null;
			const shouldContinue = drawFrame(frameTime);
			if (!shouldContinue) {
				return;
			}
			rafIdRef.current = window.requestAnimationFrame(animate);
		};
		rafIdRef.current = window.requestAnimationFrame(animate);
	}, [drawFrame]);

	const stopAnimation = useCallback(() => {
		if (typeof window === "undefined") return;
		if (rafIdRef.current === null) return;
		window.cancelAnimationFrame(rafIdRef.current);
		rafIdRef.current = null;
	}, []);

	useEffect(() => {
		const syncSnapshot = (snapshot: PreviewLoudnessSnapshot) => {
			targetSnapshotRef.current = snapshot;
			if (!active) {
				return;
			}
			const hasActiveSignal =
				Math.max(
					snapshot.leftRms,
					snapshot.rightRms,
					snapshot.leftPeak,
					snapshot.rightPeak,
				) > METER_ACTIVE_AMP_EPSILON;
			if (hasActiveSignal) {
				startAnimation();
			}
		};
		syncSnapshot(getPreviewLoudnessSnapshot());
		return subscribePreviewLoudness(syncSnapshot);
	}, [active, startAnimation]);

	useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) return;

		const resize = () => {
			const rect = container.getBoundingClientRect();
			const width =
				container.clientWidth || container.offsetWidth || rect.width;
			const height =
				container.clientHeight || container.offsetHeight || rect.height;
			if (width <= 0 || height <= 0) return;
			const dpr = window.devicePixelRatio || 1;
			viewportRef.current = { width, height };
			canvas.width = Math.round(width * dpr);
			canvas.height = Math.round(height * dpr);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			const shouldContinue = drawFrame(nowMilliseconds());
			if (shouldContinue && active) {
				startAnimation();
			}
		};

		resize();
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(resize);
		observer.observe(container);
		return () => {
			observer.disconnect();
		};
	}, [active, drawFrame, startAnimation]);

	useEffect(() => {
		return () => {
			stopAnimation();
		};
	}, [stopAnimation]);

	return (
		<div
			ref={containerRef}
			data-testid="preview-loudness-meter"
			className="relative pointer-events-none w-3 h-7"
		>
			<canvas
				ref={canvasRef}
				aria-label="preview loudness meter"
				className="block w-full h-full"
			/>
		</div>
	);
};

export default PreviewLoudnessMeterCanvas;
