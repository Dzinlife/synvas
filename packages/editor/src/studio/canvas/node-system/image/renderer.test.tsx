// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { TimelineAsset } from "core/element/types";
import type { ImageCanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageNodeSkiaRenderer } from "./renderer";

const mocks = vi.hoisted(() => ({
	acquireImageAsset: vi.fn(),
}));

vi.mock("@/assets/imageAsset", () => ({
	acquireImageAsset: mocks.acquireImageAsset,
}));

vi.mock("@/projects/projectStore", () => ({
	useProjectStore: (selector: (state: { currentProjectId: string | null }) => unknown) =>
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
}));

const createNode = (id = "node-1"): ImageCanvasNode => ({
	id,
	type: "image",
	name: "Image Node",
	x: 0,
	y: 0,
	width: 320,
	height: 180,
	zIndex: 0,
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

describe("ImageNodeSkiaRenderer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
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
				isDimmed={false}
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
				isDimmed={false}
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
				isDimmed={false}
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

	it("缺少图片资源时保留占位并跳过加载", () => {
		render(
			<ImageNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={null}
				isActive={false}
				isFocused={false}
				isDimmed={false}
				runtimeManager={{} as never}
			/>,
		);

		expect(mocks.acquireImageAsset).not.toHaveBeenCalled();
		expect(screen.getByTestId("rect")).toBeTruthy();
		expect(screen.queryByTestId("image-shader")).toBeNull();
	});
});
