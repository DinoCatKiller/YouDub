import { createCollection } from '@tanstack/solid-db';
import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';
import { socketCollectionOptions } from './collection.ts';

const socket: Socket = io('http://localhost:9007', {
	transports: ['websocket'], // 强制使用 websocket
	path: '/ws',
	autoConnect: false, // 需要手动连接，确保在组件挂载时才连接
	reconnectionAttempts: Infinity, // 💡 允許無限次重連（或設定固定次數如 50）
	reconnectionDelay: 1000, // 💡 第一次重連的初始等待時間（毫秒），這裡設 1 秒
	reconnectionDelayMax: 30000, // 💡 關鍵：重連間隔的「上限」上限（毫秒），這裡設 30 秒
	randomizationFactor: 0.5, // 💡 關鍵：隨機擾動因子（0 到 1 之間
}); // 方便在其他地方获取同一个 socket 实例

const todoSchema = z.object({
	id: z.string(),
	text: z.string(),
	completed: z.boolean(),
});

const todoCollect = createCollection(
	socketCollectionOptions({
		socket,
		id: 'todo',
		schema: todoSchema,
		getKey: (todo) => todo.id,
		// Note: No onInsert/onUpdate/onDelete - handled by Socket automatically
	}),
);

// Use the collection
todoCollect.insert({ id: '1', text: 'Buy milk', completed: false });
