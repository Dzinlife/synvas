import { useEffect, useRef, useState } from "react";

import { Skia } from "../Skia";
import type { SkData, DataSourceParam, SkJSIInstance } from "../types";
import { resolveWebAssetSource } from "../../web/assets";

const factoryWrapper = <T>(
	data2: SkData,
	factory: (data: SkData) => T,
	onError?: (err: Error) => void,
) => {
	const factoryResult = factory(data2);
	if (factoryResult === null) {
		onError && onError(new Error("Could not load data"));
		return null;
	} else {
		return factoryResult;
	}
};

export const loadData = <T>(
	source: DataSourceParam,
	factory: (data: SkData) => T | null,
	onError?: (err: Error) => void,
): Promise<T | null> => {
	if (source === null || source === undefined) {
		return new Promise((resolve) => resolve(null));
	} else {
		const resolvedSource = resolveWebAssetSource(source);
		if (resolvedSource instanceof Uint8Array) {
			return new Promise((resolve) =>
				resolve(
					factoryWrapper(Skia.Data.fromBytes(resolvedSource), factory, onError),
				),
			);
		}
		return Skia.Data.fromURI(resolvedSource).then((d) =>
			factoryWrapper(d, factory, onError),
		);
	}
};

const useLoading = <T extends SkJSIInstance<string>>(
	source: DataSourceParam,
	loader: () => Promise<T | null>,
) => {
	const mounted = useRef(false);
	const [data, setData] = useState<T | null>(null);
	const dataRef = useRef<T | null>(null);
	useEffect(() => {
		mounted.current = true;
		loader().then((value) => {
			if (mounted.current) {
				setData(value);
				dataRef.current = value;
			}
		});
		return () => {
			mounted.current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [source]);
	return data;
};

export const useCollectionLoading = <T extends SkJSIInstance<string>>(
	source: DataSourceParam[],
	loader: () => Promise<(T | null)[]>,
) => {
	const mounted = useRef(false);
	const [data, setData] = useState<T[] | null>(null);
	const dataRef = useRef<T[] | null>(null);

	useEffect(() => {
		mounted.current = true;
		loader().then((result) => {
			const value = result.filter((r) => r !== null) as T[];
			if (mounted.current) {
				setData(value);
				dataRef.current = value;
			}
		});

		return () => {
			mounted.current = false;
		};

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [source]);

	return data;
};

export const useRawData = <T extends SkJSIInstance<string>>(
	source: DataSourceParam,
	factory: (data: SkData) => T | null,
	onError?: (err: Error) => void,
) => useLoading(source, () => loadData<T>(source, factory, onError));

const identity = (data: SkData) => data;

export const useData = (
	source: DataSourceParam,
	onError?: (err: Error) => void,
) => useRawData(source, identity, onError);
