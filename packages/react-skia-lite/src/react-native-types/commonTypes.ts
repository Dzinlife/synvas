export interface SharedValue<Value = unknown> {
	value: Value;
	get?(): Value;
	set?(value: Value | ((value: Value) => Value)): void;
	addListener?: (
		listenerID: number,
		listener: (value: Value) => void,
	) => void;
	removeListener?: (listenerID: number) => void;
	modify?: (
		modifier?: <T extends Value>(value: T) => T,
		forceUpdate?: boolean,
	) => void;
	_isSharedValue?: true;
}

export interface Mutable<Value = unknown> extends SharedValue<Value> {
	_value?: Value;
}
