import { Hono } from 'hono';
import deviceRoute from '#/feat/device/device-route.ts';
import settingsRoute from '#/feat/settings/route.ts';
import tasksRoute from '#/feat/tasks/route.ts';
import logRoute from '#/feat/logs/log-route.ts';
import daemonRoute from '#/feat/daemon/route.ts';

const route = new Hono()
	.route('', deviceRoute)
	.route('', tasksRoute)
	.route('', settingsRoute)
	.route('', logRoute)
	.route('', daemonRoute);

const app = new Hono()
	.basePath('/api')
	.get('/', (c) => {
		return c.text('Hello Hono!');
	})
	.route('', route);

export type AppType = typeof route;

export default app;
