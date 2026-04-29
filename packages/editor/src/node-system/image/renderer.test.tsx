// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AgentRun } from "@synvas/agent";
import type { TimelineAsset } from "core/timeline-system/types";
import type { ImageCanvasNode } from "@/studio/project/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentRuntimeStore } from "@/agent-system";
import { ImageNodeSkiaRenderer } from "./renderer";

const mocks = vi.hoisted(() => ({
	acquireImageAsset: vi.fn(),
	peekImageAsset: vi.fn(),
	runtimeEffectMake: vi.fn<() => { type: string } | null>(() => ({
		type: "runtime-effect",
	})),
}));

vi.mock("@/assets/imageAsset", () => ({
	acquireImageAsset: mocks.acquireImageAsset,
	peekImageAsset: mocks.peekImageAsset,
}));

vi.mock("@/projects/projectStore", () => ({
	useProjectStore: (
		selector: (state: { currentProjectId: string | null }) => unknown,
	) =>
		selector({
			currentProjectId: "project-1",
		}),
}));

vi.mock("react-skia-lite", () => ({
	Rect: ({
		children,
		...props
	}: {
		children?: React.ReactNode;
		[key: string]: unknown;
	}) => (
		<div data-testid="rect" data-props={JSON.stringify(props)}>
			{children}
		</div>
	),
	ImageShader: (props: Record<string, unknown>) => (
		<div data-testid="image-shader" data-props={JSON.stringify(props)} />
	),
	Shader: (props: Record<string, unknown>) => {
		const normalizedProps = {
			...props,
			uniforms:
				typeof props.uniforms === "object" &&
				props.uniforms !== null &&
				"value" in props.uniforms
					? (props.uniforms as { value: unknown }).value
					: props.uniforms,
		};
		return (
			<div
				data-testid="loading-shader"
				data-props={JSON.stringify(normalizedProps)}
			/>
		);
	},
	Skia: {
		RuntimeEffect: {
			Make: mocks.runtimeEffectMake,
		},
	},
	useSharedValue: <T,>(initialValue: T) => ({
		value: initialValue,
		_isSharedValue: true as const,
	}),
}));

const createNode = (id = "node-1"): ImageCanvasNode => ({
	id,
	type: "image",
	name: "Image Node",
	x: 0,
	y: 0,
	width: 320,
	height: 180,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: "asset-1",
});

const createImageAsset = (uri: string): TimelineAsset => ({
	id: "asset-1",
	kind: "image",
	name: "image",
	locator: {
		type: "linked-remote",
		uri,
	},
});

const createMockHandle = (image: object) => {
	return {
		asset: {
			uri: "mock://image",
			image,
			width: 100,
			height: 100,
		},
		release: vi.fn(),
	};
};

const createActiveRun = (nodeId = "node-1"): AgentRun => {
	const now = Date.now();
	return {
		id: "run-1",
		sessionId: "session-1",
		providerId: "openai",
		modelId: "gpt-image-2",
		scope: { type: "node", projectId: "project-1", nodeId },
		kind: "image.generate",
		status: "running",
		actorId: "agent:local",
		input: { prompt: "loading" },
		params: {},
		context: {},
		steps: [],
		artifacts: [],
		effects: [],
		effectApplications: [],
		createdAt: now - 1200,
		updatedAt: now,
	};
};

describe("ImageNodeSkiaRenderer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.peekImageAsset.mockReturnValue(null);
		mocks.runtimeEffectMake.mockReturnValue({ type: "runtime-effect" });
		useAgentRuntimeStore.getState().clear();
	});

	afterEach(() => {
		cleanup();
		useAgentRuntimeStore.getState().clear();
	});

	it("有图片资源时会渲染 ImageShader", async () => {
		const image = { id: "img-1" };
		const handle = createMockHandle(image);
		mocks.acquireImageAsset.mockResolvedValue(handle);

		render(
			<ImageNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createImageAsset("https://example.com/image.png")}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		await waitFor(() => {
			expect(mocks.acquireImageAsset).toHaveBeenCalledWith(
				"https://example.com/image.png",
			);
			expect(screen.getByTestId("image-shader")).toBeTruthy();
		});
	});

	it("已有图片缓存时首帧直接渲染 ImageShader", () => {
		const image = { id: "img-cached" };
		mocks.peekImageAsset.mockReturnValue({
			image,
		});
		mocks.acquireImageAsset.mockReturnValue(new Promise(() => {}));

		render(
			<ImageNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createImageAsset("https://example.com/image.png")}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		expect(screen.getByTestId("image-shader")).toBeTruthy();
	});

	it("URI 变化时会释放旧 handle 并加载新图片", async () => {
		const handleA = createMockHandle({ id: "img-a" });
		const handleB = createMockHandle({ id: "img-b" });
		mocks.acquireImageAsset
			.mockResolvedValueOnce(handleA)
			.mockResolvedValueOnce(handleB);

		const { rerender, unmount } = render(
			<ImageNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createImageAsset("https://example.com/a.png")}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		await waitFor(() => {
			expect(mocks.acquireImageAsset).toHaveBeenCalledWith(
				"https://example.com/a.png",
			);
		});

		rerender(
			<ImageNodeSkiaRenderer
				node={createNode("node-2")}
				scene={null}
				asset={createImageAsset("https://example.com/b.png")}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		await waitFor(() => {
			expect(mocks.acquireImageAsset).toHaveBeenCalledWith(
				"https://example.com/b.png",
			);
			expect(handleA.release).toHaveBeenCalledTimes(1);
		});

		unmount();
		expect(handleB.release).toHaveBeenCalledTimes(1);
	});

	it("缺少图片资源时渲染空图片占位", () => {
		render(
			<ImageNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={null}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		expect(mocks.acquireImageAsset).not.toHaveBeenCalled();
		expect(screen.getAllByTestId("rect")).toHaveLength(2);
		expect(screen.queryByTestId("image-shader")).toBeNull();
	});

	it("empty image node 不需要 asset 也会渲染占位", () => {
		render(
			<ImageNodeSkiaRenderer
				node={{ ...createNode(), assetId: null }}
				scene={null}
				asset={null}
				isActive={false}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		expect(mocks.acquireImageAsset).not.toHaveBeenCalled();
		expect(screen.getAllByTestId("rect")).toHaveLength(2);
	});

	it("agent 运行中会渲染 shader loading", () => {
		useAgentRuntimeStore.getState().upsertRun(createActiveRun());

		render(
			<ImageNodeSkiaRenderer
				node={{ ...createNode(), assetId: null }}
				scene={null}
				asset={null}
				isActive={true}
				isFocused={false}
				runtimeManager={{} as never}
			/>,
		);

		expect(mocks.acquireImageAsset).not.toHaveBeenCalled();
		expect(screen.getByTestId("loading-shader")).toBeTruthy();
		expect(screen.queryByTestId("image-shader")).toBeNull();
	});
});
