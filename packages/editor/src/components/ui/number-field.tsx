"use client";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import type * as React from "react";

import { cn } from "@/lib/utils";

const NumberField = NumberFieldPrimitive.Root;

function NumberFieldScrubArea({
	className,
	...props
}: NumberFieldPrimitive.ScrubArea.Props) {
	return (
		<NumberFieldPrimitive.ScrubArea
			className={cn("cursor-ew-resize", className)}
			{...props}
		/>
	);
}

function NumberFieldScrubAreaCursor({
	className,
	children,
	...props
}: NumberFieldPrimitive.ScrubAreaCursor.Props) {
	return (
		<NumberFieldPrimitive.ScrubAreaCursor
			className={cn("drop-shadow-[0_1px_1px_#0008] filter", className)}
			{...props}
		>
			{children ?? <CursorGrowIcon />}
		</NumberFieldPrimitive.ScrubAreaCursor>
	);
}

function NumberFieldGroup({
	className,
	...props
}: NumberFieldPrimitive.Group.Props) {
	return (
		<NumberFieldPrimitive.Group className={cn("flex", className)} {...props} />
	);
}

function NumberFieldDecrement({
	className,
	children,
	...props
}: NumberFieldPrimitive.Decrement.Props) {
	return (
		<NumberFieldPrimitive.Decrement
			className={cn(
				"flex size-10 items-center justify-center rounded-tl-md rounded-bl-md border border-gray-200 bg-gray-50 bg-clip-padding text-gray-900 select-none hover:bg-gray-100 active:bg-gray-100",
				className,
			)}
			{...props}
		>
			{children ?? <MinusIcon />}
		</NumberFieldPrimitive.Decrement>
	);
}

function NumberFieldInput({
	className,
	...props
}: NumberFieldPrimitive.Input.Props) {
	return (
		<NumberFieldPrimitive.Input
			className={cn(
				"h-10 w-24 border-t border-b border-gray-200 text-center text-base text-gray-900 tabular-nums focus:z-1 focus:outline-2 focus:-outline-offset-1 focus:outline-blue-800",
				className,
			)}
			{...props}
		/>
	);
}

function NumberFieldIncrement({
	className,
	children,
	...props
}: NumberFieldPrimitive.Increment.Props) {
	return (
		<NumberFieldPrimitive.Increment
			className={cn(
				"flex size-10 items-center justify-center rounded-tr-md rounded-br-md border border-gray-200 bg-gray-50 bg-clip-padding text-gray-900 select-none hover:bg-gray-100 active:bg-gray-100",
				className,
			)}
			{...props}
		>
			{children ?? <PlusIcon />}
		</NumberFieldPrimitive.Increment>
	);
}

function CursorGrowIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			width="26"
			height="14"
			viewBox="0 0 24 14"
			fill="black"
			stroke="white"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path d="M19.5 5.5L6.49737 5.51844V2L1 6.9999L6.5 12L6.49737 8.5L19.5 8.5V12L25 6.9999L19.5 2V5.5Z" />
		</svg>
	);
}

function PlusIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			stroke="currentcolor"
			strokeWidth="1.6"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path d="M0 5H5M10 5H5M5 5V0M5 5V10" />
		</svg>
	);
}

function MinusIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			stroke="currentcolor"
			strokeWidth="1.6"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path d="M0 5H10" />
		</svg>
	);
}

export {
	CursorGrowIcon,
	MinusIcon,
	NumberField,
	NumberFieldDecrement,
	NumberFieldGroup,
	NumberFieldIncrement,
	NumberFieldInput,
	NumberFieldScrubArea,
	NumberFieldScrubAreaCursor,
	PlusIcon,
};
