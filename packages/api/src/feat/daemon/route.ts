import { Hono } from 'hono';
import { getMLDaemon } from '#/feat/daemon/ml-daemon.ts';

const daemonRoute = new Hono();

daemonRoute.get('/daemon/status', (c) => {
  const daemon = getMLDaemon();
  if (!daemon) {
    return c.json({ alive: false, ready: false, message: 'MLDaemon not initialized' });
  }
  return c.json({
    alive: !daemon.exited,
    ready: daemon.ready,
    pid: daemon.pid,
  });
});

export default daemonRoute;
