export const LottieIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => {
	return (
		<svg
			width="156"
			height="156"
			viewBox="0 0 156 156"
			fill="none"
			aria-hidden="true"
			{...props}
		>
			<rect width="156" height="156" fill="#00DDB3" />
			<path
				d="M118.543 34.934C91.695 34.934 81.746 54.104 73.746 69.504L68.519 79.357C60.049 95.689 53.719 105.617 37.409 105.617C36.3962 105.616 35.3933 105.815 34.4576 106.203C33.5219 106.59 32.6718 107.159 31.956 107.875C31.2402 108.591 30.6725 109.441 30.2853 110.376C29.8981 111.312 29.6989 112.314 29.6992 113.327C29.6995 114.339 29.8992 115.341 30.2869 116.277C30.6747 117.212 31.2428 118.061 31.959 118.777C33.4047 120.222 35.3645 121.036 37.409 121.039C64.268 121.039 74.217 101.868 82.217 86.469L87.433 76.616C95.914 60.283 102.244 50.356 118.543 50.356C119.557 50.3578 120.561 50.1595 121.498 49.7725C122.435 49.3856 123.286 48.8176 124.003 48.101C124.72 47.3849 125.289 46.5344 125.677 45.5982C126.065 44.662 126.265 43.6585 126.265 42.645C126.261 40.5993 125.446 38.6387 123.998 37.1933C122.55 35.748 120.589 34.9358 118.543 34.935V34.934Z"
				fill="white"
			/>
		</svg>
	);
};

export const RippleEditingIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => {
	return (
		<svg
			width="32"
			height="32"
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M6 16L9 19M6 16L9 13M6 16H16" />
			<path d="M26 16L23 19M26 16L23 13M26 16H16" />
			<path d="M16 7V25" />
		</svg>
	);
};

export const ScrollPreviewIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => {
	return (
		<svg
			width="32"
			height="32"
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M15 17.5H6C5.72386 17.5 5.5 17.2761 5.5 17V10C5.5 9.72386 5.72386 9.5 6 9.5H25C25.2761 9.5 25.5 9.72386 25.5 10V16.5" />
			<path d="M12.5 6L12.5 25" />
			<path d="M19.7972 24.4931L16.1733 15.4333C16.108 15.27 16.27 15.108 16.4333 15.1733L25.4931 18.7972C25.666 18.8664 25.6588 19.1137 25.482 19.1727L21.5949 20.4684C21.5351 20.4883 21.4883 20.5351 21.4684 20.5949L20.1727 24.482C20.1137 24.6588 19.8664 24.666 19.7972 24.4931Z" />
		</svg>
	);
};

export const SnapIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => {
	return (
		<svg
			width="32"
			height="32"
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			aria-hidden="true"
			{...props}
		>
			<rect x="4" y="12.5" width="11" height="7" rx="0.5" />
			<rect x="17" y="12.5" width="11" height="7" rx="0.5" />
			<path d="M16 9V5" />
			<path d="M16 23V27" />
			<path d="M20.5 9.5L23.5 7.5" />
			<path d="M20.5 22.5L23.5 24.5" />
			<path d="M11.5 9.5L8.5 7.5" />
			<path d="M11.5 22.5L8.5 24.5" />
		</svg>
	);
};

export const AutoAttachIcon: React.FC<React.SVGProps<SVGSVGElement>> = (
	props,
) => {
	return (
		<svg
			width="32"
			height="32"
			viewBox="0 0 32 32"
			fill="none"
			stroke="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M15.5 14.5H19C19.2761 14.5 19.5 14.7239 19.5 15V22C19.5 22.2761 19.2761 22.5 19 22.5H6C5.72386 22.5 5.5 22.2761 5.5 22V15C5.5 14.7239 5.72386 14.5 6 14.5H11.5" />
			<path d="M21.5 17.5H27C27.2761 17.5 27.5 17.2761 27.5 17V10C27.5 9.72386 27.2761 9.5 27 9.5H14C13.7239 9.5 13.5 9.72386 13.5 10V17C13.5 17.2761 13.7239 17.5 14 17.5H17.5" />
		</svg>
	);
};
