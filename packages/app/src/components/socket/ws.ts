import type {
	ClientToServerEvents,
	ServerToClientEvents,
} from '@repo/api/src/socket.io/types';

// 注意：这里连接的是你的 Hono API (packages/api)
// 即使后端是 Hono 的 WebSocket，socket.io-client 也可以在特定配置下工作，
// 或者我们直接模拟 socket.io 的行为。

import { io, type Socket } from 'socket.io-client';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
	'http://localhost:9007',
	{
		transports: ['websocket'], // 强制使用 websocket
		path: '/ws',
		autoConnect: false, // 需要手动连接，确保在组件挂载时才连接
		reconnectionAttempts: Infinity, // 💡 允許無限次重連（或設定固定次數如 50）
		reconnectionDelay: 1000, // 💡 第一次重連的初始等待時間（毫秒），這裡設 1 秒
		reconnectionDelayMax: 30000, // 💡 關鍵：重連間隔的「上限」上限（毫秒），這裡設 30 秒
		randomizationFactor: 0.5, // 💡 關鍵：隨機擾動因子（0 到 1 之間
	},
); // 方便在其他地方获取同一个 socket 实例

socket.onAny((event, ...args) => {
	console.log(event, args); // 这里可以看到所有事件和数据，方便调试
});
