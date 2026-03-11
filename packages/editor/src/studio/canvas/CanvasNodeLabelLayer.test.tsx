// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { CanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeLabelLayer } from "./CanvasNodeLabelLayer";

const { mockUseSkiaUiTextSprites } = vi.hoisted(() => ({
	mockUseSkiaUiTextSprites: vi.fn(),
}));

vi.mock("@/studio/canvas/skia-text", () => ({
	useSkiaUiTextSprites: (
		requests: Array<{ text: string; slotKey?: string; maxWidthPx?: number }>,
	) => {
		mockUseSkiaUiTextSprites(requests);
		return requests.map((request, index) => ({
			cacheKey: request.slotKey ?? `slot-${index}`,
			text: request.text,
			image: `image-${index}`,
			textWidth: 120,
			textHeight: 15,
			ready: true,
		}));
	},
}));

vi.mock("react-skia-lite", () => ({
	useDerivedValue: <T,>(updater: () => T) => ({
		value: updater(),
		_isSharedValue: true as const,
	}),
	Group: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	Image: () => null,
}));

const createSharedValue = <T,>(value: T) => ({
	value,
	_isSharedValue: true as const,
});

const createVideoNode = (patch: Partial<CanvasNode> = {}): CanvasNode => ({
	id: "node-a",
	type: "video",
	name: "very-long-node-label",
	x: 0,
	y: 0,
	width: 100,
	height: 60,
	zIndex: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: "asset-a",
	...patch,
});

describe("CanvasNodeLabelLayer", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("label request 会把节点当前屏幕宽度传给 maxWidthPx", () => {
		render(
			<CanvasNodeLabelLayer
				width={800}
				height={600}
				camera={createSharedValue({ x: 0, y: 0, zoom: 1.5 })}
				getNodeLayout={() =>
					createSharedValue({ x: 0, y: 0, width: 100, height: 60 })
				}
				nodes={[createVideoNode()]}
				focusedNodeId={null}
			/>,
		);

		const labelRequests = mockUseSkiaUiTextSprites.mock.calls
			.map(
				(call) =>
					call[0] as Array<{
						text: string;
						slotKey?: string;
						maxWidthPx?: number;
					}>,
			)
			.find((requests) =>
				requests.some((request) => request.slotKey === "node-a"),
			);

		expect(labelRequests).toBeTruthy();
		expect(labelRequests?.[0]).toMatchObject({
			slotKey: "node-a",
			text: "very-long-node-label",
			maxWidthPx: 150,
		});
	});
});
