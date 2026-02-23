import type { CanvasNode } from "core/studio/types";
import type { CanvasNodeDefinition } from "./types";

class CanvasNodeRegistryClass {
	private definitions = new Map<CanvasNode["type"], CanvasNodeDefinition>();

	register<TNode extends CanvasNode>(
		definition: CanvasNodeDefinition<TNode>,
	): void {
		if (this.definitions.has(definition.type)) {
			console.warn(
				`Canvas node definition "${definition.type}" already registered, replacing...`,
			);
		}
		this.definitions.set(
			definition.type,
			definition as unknown as CanvasNodeDefinition,
		);
	}

	get(type: CanvasNode["type"]): CanvasNodeDefinition | undefined {
		return this.definitions.get(type);
	}

	getAll(): CanvasNodeDefinition[] {
		return Array.from(this.definitions.values());
	}
}

const canvasNodeRegistry = new CanvasNodeRegistryClass();

export const registerCanvasNodeDefinition = <TNode extends CanvasNode>(
	definition: CanvasNodeDefinition<TNode>,
): void => {
	canvasNodeRegistry.register(definition);
};

export const getCanvasNodeDefinition = (
	type: CanvasNode["type"],
): CanvasNodeDefinition => {
	const definition = canvasNodeRegistry.get(type);
	if (!definition) {
		throw new Error(`Canvas node definition "${type}" is not registered.`);
	}
	return definition;
};

export const getCanvasNodeDefinitionList = (): CanvasNodeDefinition[] => {
	return canvasNodeRegistry.getAll();
};
