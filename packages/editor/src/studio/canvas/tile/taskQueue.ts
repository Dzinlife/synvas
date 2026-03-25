import { TILE_TASK_QUEUE_CAPACITY } from "./constants";
import type { RenderTask, TilePriority } from "./types";

const PRIORITY_ORDER: TilePriority[] = ["HIGH", "MID", "LOW"];

class RingQueue {
	private queue: Array<RenderTask | null>;

	private head = 0;

	private tail = 0;

	private count = 0;

	constructor(private readonly capacity: number) {
		this.queue = new Array<RenderTask | null>(capacity).fill(null);
	}

	push(task: RenderTask): boolean {
		if (this.count >= this.capacity) {
			return false;
		}
		this.queue[this.tail] = task;
		this.tail = (this.tail + 1) % this.capacity;
		this.count += 1;
		return true;
	}

	shift(): RenderTask | null {
		if (this.count === 0) {
			return null;
		}
		const task = this.queue[this.head];
		this.queue[this.head] = null;
		this.head = (this.head + 1) % this.capacity;
		this.count -= 1;
		return task;
	}

	clear(releaseTask: (task: RenderTask) => void): void {
		while (this.count > 0) {
			const task = this.shift();
			if (!task) continue;
			releaseTask(task);
		}
	}

	size(): number {
		return this.count;
	}
}

export class RenderTaskPool {
	private freeList: RenderTask[] = [];

	acquire(): RenderTask {
		const recycled = this.freeList.pop();
		if (recycled) {
			return recycled;
		}
		return {
			key: 0,
			lod: 0,
			tx: 0,
			ty: 0,
			priority: "LOW",
			queueEpoch: 0,
		};
	}

	release(task: RenderTask): void {
		task.key = 0;
		task.lod = 0;
		task.tx = 0;
		task.ty = 0;
		task.priority = "LOW";
		task.queueEpoch = 0;
		this.freeList.push(task);
	}

	size(): number {
		return this.freeList.length;
	}
}

export class PriorityTaskQueue {
	private readonly queueByPriority: Record<TilePriority, RingQueue> = {
		HIGH: new RingQueue(TILE_TASK_QUEUE_CAPACITY),
		MID: new RingQueue(TILE_TASK_QUEUE_CAPACITY),
		LOW: new RingQueue(TILE_TASK_QUEUE_CAPACITY),
	};

	enqueue(task: RenderTask): boolean {
		return this.queueByPriority[task.priority].push(task);
	}

	dequeue(): RenderTask | null {
		for (const priority of PRIORITY_ORDER) {
			const task = this.queueByPriority[priority].shift();
			if (task) {
				return task;
			}
		}
		return null;
	}

	clear(releaseTask: (task: RenderTask) => void): void {
		for (const priority of PRIORITY_ORDER) {
			this.queueByPriority[priority].clear(releaseTask);
		}
	}

	size(): number {
		let count = 0;
		for (const priority of PRIORITY_ORDER) {
			count += this.queueByPriority[priority].size();
		}
		return count;
	}
}
