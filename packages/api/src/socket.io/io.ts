import { Server as Engine } from '@socket.io/bun-engine';
import { Server } from 'socket.io';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
} from '#/socket.io/types.ts';

export const io = new Server<ClientToServerEvents, ServerToClientEvents>({
	cors: {
		origin: '*',
	},
});

export const engine = new Engine({
	path: '/ws/',
});

io.bind(engine);
