"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
	className,
	defaultValue,
	value,
	...props
}: SliderPrimitive.Root.Props) {
	const values = React.useMemo(() => {
		const current = value ?? defaultValue;
		if (Array.isArray(current)) {
			return current;
		}
		if (typeof current === "number") {
			return [current];
		}
		return [0];
	}, [value, defaultValue]);
	const thumbKeys = React.useMemo(() => {
		const counts = new Map<number, number>();
		return values.map((thumbValue) => {
			const count = (counts.get(thumbValue) ?? 0) + 1;
			counts.set(thumbValue, count);
			return `thumb-${thumbValue}-${count}`;
		});
	}, [values]);

	return (
		<SliderPrimitive.Root defaultValue={defaultValue} value={value} {...props}>
			<SliderPrimitive.Control
				className={cn(
					"flex w-56 touch-none items-center py-3 select-none",
					className,
				)}
			>
				<SliderPrimitive.Track className="h-1 w-full rounded bg-gray-200 shadow-[inset_0_0_0_1px] shadow-gray-200 select-none">
					<SliderPrimitive.Indicator className="rounded bg-gray-700 select-none" />
					{thumbKeys.map((thumbKey) => (
						<SliderPrimitive.Thumb
							key={thumbKey}
							className="size-4 rounded-full bg-white outline outline-gray-300 select-none has-focus-visible:outline-2 has-focus-visible:outline-blue-800"
						/>
					))}
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

export { Slider };
