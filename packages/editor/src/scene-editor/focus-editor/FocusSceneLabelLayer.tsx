import type { FocusSceneLabelItem } from "./useFocusSceneSkiaInteractions";

interface FocusSceneLabelLayerProps {
	labels: FocusSceneLabelItem[];
}

export const FocusSceneLabelLayer = ({ labels }: FocusSceneLabelLayerProps) => {
	if (labels.length === 0) return null;

	return (
		<div
			data-testid="focus-scene-skia-layer"
			className="absolute inset-0 pointer-events-none z-30"
		>
			{labels.map((label) => {
				let translateY = 0;
				if (
					Math.abs(label.rotationDeg % 180) > 45 &&
					Math.abs(label.rotationDeg % 180) < 135
				) {
					translateY = label.screenWidth / 2 + 20;
				} else {
					translateY = label.screenHeight / 2 + 20;
				}

				let normalizedRotation = label.rotationDeg % 90;
				if (label.rotationDeg % 90 > 45) {
					normalizedRotation -= 90 * Math.ceil(normalizedRotation / 90);
				} else if (label.rotationDeg % 90 < -45) {
					normalizedRotation -= 90 * Math.floor(normalizedRotation / 90);
				}

				return (
					<div
						key={label.id}
						className="absolute text-red-500 bg-black/80 border border-red-500/70 max-w-32 truncate font-medium backdrop-blur-sm backdrop-saturate-150 px-3 py-1 -top-8 rounded-full text-xs whitespace-nowrap pointer-events-none"
						style={{
							left: label.screenX,
							top: label.screenY,
							transform: `translate(-50%, -50%) rotate(${normalizedRotation}deg) translateY(${translateY}px)`,
						}}
					>
						{Math.round(label.canvasWidth)} &times; {Math.round(label.canvasHeight)}
					</div>
				);
			})}
		</div>
	);
};
