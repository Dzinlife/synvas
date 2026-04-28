import {
	type AgentClient,
	type AgentRun,
	type AgentRunRequest,
	isTerminalAgentRunStatus,
	LocalMockAgentClient,
} from "@synvas/agent";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
} from "react";
import { applyAgentEffects } from "./applyAgentEffects";
import { useAgentRuntimeStore } from "./agentRuntimeStore";

interface AgentRuntimeContextValue {
	client: AgentClient;
	startRun: (request: AgentRunRequest) => Promise<AgentRun>;
}

interface AgentProviderProps {
	children: ReactNode;
	client?: AgentClient;
}

const createRuntime = (client: AgentClient): AgentRuntimeContextValue => {
	const applyingRunIds = new Set<string>();
	const unsubscribeByRunId = new Map<string, () => void>();

	const startRun = async (request: AgentRunRequest): Promise<AgentRun> => {
		const run = await client.createRun(request);
		const unsubscribe = client.subscribeRun(run.id, (event) => {
			const nextRun = event.run;
			useAgentRuntimeStore.getState().upsertRun(nextRun);
			if (
				nextRun.status === "applying_effects" &&
				!applyingRunIds.has(nextRun.id)
			) {
				applyingRunIds.add(nextRun.id);
				void applyAgentEffects(nextRun)
					.then((applications) =>
						client.completeRunApplication(nextRun.id, applications),
					)
					.catch((error) =>
						client.failRunApplication(nextRun.id, [], String(error)),
					);
			}
			if (isTerminalAgentRunStatus(nextRun.status)) {
				unsubscribeByRunId.get(nextRun.id)?.();
				unsubscribeByRunId.delete(nextRun.id);
				applyingRunIds.delete(nextRun.id);
			}
		});
		unsubscribeByRunId.set(run.id, unsubscribe);
		return run;
	};

	return { client, startRun };
};

const defaultRuntime = createRuntime(new LocalMockAgentClient());

const AgentRuntimeContext =
	createContext<AgentRuntimeContextValue>(defaultRuntime);

export const AgentProvider = ({ children, client }: AgentProviderProps) => {
	const fallbackClientRef = useRef<AgentClient | null>(null);
	if (!fallbackClientRef.current) {
		fallbackClientRef.current = new LocalMockAgentClient();
	}
	const runtimeClient = client ?? fallbackClientRef.current;
	const runtime = useMemo(() => createRuntime(runtimeClient), [runtimeClient]);
	return (
		<AgentRuntimeContext.Provider value={runtime}>
			{children}
		</AgentRuntimeContext.Provider>
	);
};

export const useAgentRuntime = (): AgentRuntimeContextValue => {
	return useContext(AgentRuntimeContext);
};

export const useAgentClient = (): AgentClient => {
	return useAgentRuntime().client;
};

export const useStartAgentRun = () => {
	const { startRun } = useAgentRuntime();
	return useCallback(
		(request: AgentRunRequest) => startRun(request),
		[startRun],
	);
};
