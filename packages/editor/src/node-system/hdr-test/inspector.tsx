import type {
	HdrTestCanvasNode,
	HdrTestColorPreset,
} from "@/studio/project/types";
import type React from "react";
import { canDisplayHdrColors } from "react-skia-lite";
import type { CanvasNodeInspectorProps } from "../types";

const HDR_TEST_COLOR_OPTIONS: Array<{
	key: HdrTestColorPreset;
	label: string;
}> = [
	{ key: "sdr-white", label: "SDR White" },
	{ key: "p3-red", label: "P3 Red" },
	{ key: "hdr-white", label: "HDR White" },
	{ key: "hdr-red", label: "HDR Red" },
	{ key: "hdr-gradient", label: "HDR Gradient" },
];

const clampBrightness = (value: number): number => {
	if (!Number.isFinite(value)) return 2;
	return Math.min(4, Math.max(0, value));
};

const Field = ({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) => (
	<div className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
		<span className="text-[11px] text-white/60">{label}</span>
		{children}
	</div>
);

const ReadonlyItem = ({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) => (
	<div className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
		<div className="text-[11px] text-white/60">{label}</div>
		<div className="text-[11px] text-white/90">{value}</div>
	</div>
);

export const HdrTestNodeInspector: React.FC<
	CanvasNodeInspectorProps<HdrTestCanvasNode>
> = ({ node, updateNode }) => {
	const outputMode = canDisplayHdrColors()
		? "extended requested"
		: "standard fallback";
	const brightness = clampBrightness(node.brightness);
	const updateBrightness = (value: string) => {
		updateNode({ brightness: clampBrightness(Number(value)) });
	};
	return (
		<div
			data-testid="hdr-test-node-inspector"
			className="flex h-full min-h-0 w-full flex-col bg-neutral-900/90 ring-2 ring-neutral-800/80 shadow-2xl backdrop-blur-xl"
		>
			<div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/90">
				HDR Test
			</div>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
				<ReadonlyItem label="Output" value={outputMode} />
				<Field label="Color">
					<select
						data-testid="hdr-test-color-select"
						value={node.colorPreset}
						onChange={(event) => {
							updateNode({
								colorPreset: event.target.value as HdrTestColorPreset,
							});
						}}
						className="min-w-0 rounded border border-white/10 bg-neutral-950 px-1.5 py-0.5 text-[11px] text-white/90 outline-none"
					>
						{HDR_TEST_COLOR_OPTIONS.map((option) => (
							<option key={option.key} value={option.key}>
								{option.label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Brightness">
					<div className="grid grid-cols-[1fr_56px] gap-2">
						<input
							data-testid="hdr-test-brightness-slider"
							type="range"
							min={0}
							max={4}
							step={0.1}
							value={brightness}
							onChange={(event) => updateBrightness(event.target.value)}
							className="min-w-0"
						/>
						<input
							data-testid="hdr-test-brightness-input"
							type="number"
							min={0}
							max={4}
							step={0.1}
							value={brightness}
							onChange={(event) => updateBrightness(event.target.value)}
							className="min-w-0 rounded border border-white/10 bg-neutral-950 px-1.5 py-0.5 text-[11px] text-white/90 outline-none"
						/>
					</div>
				</Field>
			</div>
		</div>
	);
};
