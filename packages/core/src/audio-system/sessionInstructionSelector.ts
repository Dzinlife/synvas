type GainInstruction = {
	gain?: number;
};

type SessionInstruction = GainInstruction | null;

export type SessionInstructionCandidate<
	TInstruction extends SessionInstruction = SessionInstruction,
> = {
	id: string;
	timelineStart: number;
	instruction: TInstruction;
};

const EPSILON = 1e-6;

const resolveTimelineStart = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.round(value);
};

const resolveGain = (instruction: SessionInstruction): number => {
	if (!instruction) return 0;
	const gain = instruction.gain;
	if (!Number.isFinite(gain)) return 0;
	return gain ?? 0;
};

export const chooseSessionInstructionCandidate = <
	T extends SessionInstructionCandidate,
>(
	current: T,
	candidate: T,
): T => {
	if (!current.instruction && candidate.instruction) return candidate;
	if (current.instruction && !candidate.instruction) return current;
	if (!current.instruction && !candidate.instruction) return current;
	if (!current.instruction || !candidate.instruction) return current;

	const currentGain = resolveGain(current.instruction);
	const candidateGain = resolveGain(candidate.instruction);
	if (candidateGain > currentGain + EPSILON) return candidate;
	if (currentGain > candidateGain + EPSILON) return current;

	const currentStart = resolveTimelineStart(current.timelineStart);
	const candidateStart = resolveTimelineStart(candidate.timelineStart);
	if (candidateStart > currentStart) return candidate;
	if (currentStart > candidateStart) return current;

	if (candidate.id.localeCompare(current.id) > 0) {
		return candidate;
	}
	return current;
};
