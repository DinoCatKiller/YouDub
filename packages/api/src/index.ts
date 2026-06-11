import { engine } from '#/socket.io/route.ts';
import { ensureRuntimeDirs, env } from '@repo/config';
import { startMLDaemon } from '#/feat/daemon/ml-daemon.ts';

ensureRuntimeDirs();

startMLDaemon().then(() => {
  console.log('[Daemon] ML pipeline daemon ready');
}).catch((err) => {
  console.error('[Daemon] Failed to start ML daemon:', err);
});

const io = engine.handler();

import app from './app';

console.log('[Pipeline] API delegates execution to CLI pipeline runner');

export default Bun.serve({
	port: 9007,
	idleTimeout: 60,

	fetch(req: Request, server: any) {
		if (req.url.includes('/ws/')) {
			return io.fetch(req, server);
		}
		return app.fetch(req, server);
	},
	websocket: io.websocket,
});
