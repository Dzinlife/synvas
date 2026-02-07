import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<typeof InputPrimitive>;

function Input({ className, ...props }: InputProps) {
	return (
		<InputPrimitive
			className={cn(
				"h-10 w-56 rounded-md border border-gray-200 pl-3.5 text-base text-gray-900 focus:outline-2 focus:-outline-offset-1 focus:outline-blue-800",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
