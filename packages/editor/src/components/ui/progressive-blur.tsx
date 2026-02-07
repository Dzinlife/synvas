"use client";

import type React from "react";

import { cn } from "@/lib/utils";

export interface ProgressiveBlurProps {
	className?: string;
	height?: string;
	position?: "top" | "bottom" | "both" | "right" | "left";
	blurLevels?: number[];
	children?: React.ReactNode;
}

export function ProgressiveBlur({
	className,
	position = "bottom",
	blurLevels = [0.5, 1, 2, 4, 8, 16, 32, 64],
}: ProgressiveBlurProps) {
	const middleLayers = [];
	for (let blurIndex = 1; blurIndex < blurLevels.length - 1; blurIndex += 1) {
		const startPercent = blurIndex * 12.5;
		const midPercent = (blurIndex + 1) * 12.5;
		const endPercent = (blurIndex + 2) * 12.5;
		const blurValue = blurLevels[blurIndex];
		const maskGradient =
			position === "bottom"
				? `linear-gradient(to bottom, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
				: position === "top"
					? `linear-gradient(to top, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
					: position === "right"
						? `linear-gradient(to right, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
						: position === "left"
							? `linear-gradient(to left, rgba(0,0,0,0) ${startPercent}%, rgba(0,0,0,1) ${midPercent}%, rgba(0,0,0,1) ${endPercent}%, rgba(0,0,0,0) ${endPercent + 12.5}%)`
							: `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`;
		middleLayers.push({
			key: `blur-${blurValue}-${startPercent}-${endPercent}`,
			blurValue,
			maskGradient,
		});
	}

	return (
		<div
			className={cn(
				"gradient-blur pointer-events-none relative",
				className,
				// position === "top"
				//   ? "top-0"
				//   : position === "bottom"
				//     ? "bottom-0"
				//     : "inset-y-0"
			)}
			// style={{
			//   height: position === "both" ? "100%" : height,
			// }}
		>
			{/* First blur layer (pseudo element) */}
			<div
				className="absolute inset-0"
				style={{
					backdropFilter: `blur(${blurLevels[0]}px)`,
					WebkitBackdropFilter: `blur(${blurLevels[0]}px)`,
					maskImage:
						position === "bottom"
							? `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)`
							: position === "top"
								? `linear-gradient(to top, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)`
								: position === "right"
									? `linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)`
									: position === "left"
										? `linear-gradient(to left, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%)`
										: `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`,
				}}
			/>

			{/* Middle blur layers */}
			{middleLayers.map((layer) => {
				return (
					<div
						key={layer.key}
						className="absolute inset-0"
						style={{
							backdropFilter: `blur(${layer.blurValue}px)`,
							WebkitBackdropFilter: `blur(${layer.blurValue}px)`,
							maskImage: layer.maskGradient,
							WebkitMaskImage: layer.maskGradient,
						}}
					/>
				);
			})}

			{/* Last blur layer (pseudo element) */}
			<div
				className="absolute inset-0"
				style={{
					backdropFilter: `blur(${blurLevels[blurLevels.length - 1]}px)`,
					WebkitBackdropFilter: `blur(${blurLevels[blurLevels.length - 1]}px)`,
					maskImage:
						position === "bottom"
							? `linear-gradient(to bottom, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)`
							: position === "top"
								? `linear-gradient(to top, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)`
								: position === "right"
									? `linear-gradient(to right, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)`
									: position === "left"
										? `linear-gradient(to left, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%)`
										: `linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,1) 5%, rgba(0,0,0,1) 95%, rgba(0,0,0,0) 100%)`,
				}}
			/>
		</div>
	);
}
