import { hc } from 'hono/client';
import type { AppType } from '#/app.ts';

export const client = hc<AppType>('/api');

export const getDeviceInfo = async () =>
	await client.deviceInfo.$get().then((res) => res.json());

export const getYtdlpSettings = async () =>
	await client.get_ytdlp_settings.$get().then((res) => res.json());

// export const saveYtdlpSettings = async (proxy_port: string) =>
// 	await client.save_ytdlp_settings
// 		.$put({ json: { proxy_port } })
// 		.then((res) => res.json());
