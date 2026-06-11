import { Hono } from 'hono';
import { getDeviceInfo } from '@repo/device';

const deviceRoute = new Hono().get('/deviceInfo', async (c) => {
	const info = await getDeviceInfo();
	return c.json(info);
});

export default deviceRoute;
