import { Hono } from 'hono';
import { getDeviceInfo } from './device-info';

const deviceRoute = new Hono();

deviceRoute.get('/device/info', async (c) => {
  try {
    const info = await getDeviceInfo();
    return c.json(info);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default deviceRoute;
