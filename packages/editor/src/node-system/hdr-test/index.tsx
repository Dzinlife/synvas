import type { HdrTestCanvasNode } from "@/studio/project/types";
import { registerCanvasNodeDefinition } from "../registryCore";
import type { CanvasNodeDefinition } from "../types";
import { HdrTestNodeInspector } from "./inspector";
import { HdrTestNodeSkiaRenderer } from "./renderer";
import { HdrTestNodeToolbar } from "./toolbar";

const hdrTestDefinition: CanvasNodeDefinition<HdrTestCanvasNode> = {
	type: "hdr-test",
	title: "HDR Test",
	create: () => ({
		type: "hdr-test",
		name: "HDR Test",
		width: 560,
		height: 320,
		colorPreset: "hdr-white",
		brightness: 2,
	}),
	skiaRenderer: HdrTestNodeSkiaRenderer,
	toolbar: HdrTestNodeToolbar,
	inspector: HdrTestNodeInspector,
	focusable: false,
};

registerCanvasNodeDefinition(hdrTestDefinition);
