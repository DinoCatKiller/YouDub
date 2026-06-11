import { client, getYtdlpSettings } from '@repo/api/src/client';
import {
	type GetOpenAIModelsInput,
	type SaveOpenAISettingsInput,
	settingsSchema,
} from '@repo/api/src/feat/settings/schema';
import { getQueryClient } from '@repo/ui-solid/tanstack-query/provider';
import { createCollection } from '@tanstack/solid-db';
import { queryOptions } from '@tanstack/solid-query';
import { socketCollectionOptions } from 'socket-collection/collection';
import { socket } from '#/components/socket/ws.ts';
import { request } from '#/lib/api.ts';

export const tasksCollect = createCollection(
	socketCollectionOptions({
		socket,
		id: 'settings',
		schema: settingsSchema,
		getKey: (todo) => todo.key,
		syncMode: 'on-demand',
	}),
);

export const cookieInfoQ = queryOptions({
	queryKey: ['cookieInfo'],
	queryFn: async () => {
		const res = await client.get_youtube_cookie.$get();
		if (!res.ok) {
			throw new Error('Failed to fetch YouTube cookie info');
		}
		return await res.json();
	},
});

export const saveCookie = async (content: string) => {
	return await socket.emitWithAck('save_youtube_cookie', content);
	// return request('/api/cookies/youtube', {
	// 	method: 'POST',
	// 	body: JSON.stringify({ content }),
	// });
};

export const ytdlpSettingsQ = queryOptions({
	queryKey: ['ytdlpSettings'],
	queryFn: getYtdlpSettings,
});

export const saveYtdlpSettings = async (proxy_port: string) => {
	const res = await client.save_ytdlp_settings.$put({ json: { proxy_port } });
	const data = await res.json();

	if (!data.ok) {
		throw new Error(data.msg || 'Failed to save ytdlp settings');
	}
	const qc = getQueryClient();
	qc.invalidateQueries({ queryKey: ['ytdlpSettings'] });
	return data.data;
};

export const openAISettings = queryOptions({
	queryKey: ['openAISettings'],
	queryFn: async () => {
		const res = await client.get_openai_settings.$get();
		if (!res.ok) {
			throw new Error('Failed to fetch OpenAI settings');
		}
		return await res.json();
	},
});
export const saveOpenAISettings = async (settings: SaveOpenAISettingsInput) => {
	const res = await client.save_openai_settings.$put({ json: settings });
	if (!res.ok) {
		throw new Error('Failed to save OpenAI settings');
	}
	const qc = getQueryClient();
	qc.invalidateQueries({ queryKey: ['openAISettings'] });
	return res.json();
};

export const getOpenAIModels = async (input: GetOpenAIModelsInput) => {
	const res = await client.get_openai_models.$put({ json: input });
	const ret = await res.json();
	if (!ret.ok) {
		throw new Error(ret.msg);
	}
	return ret;
};
