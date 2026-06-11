import { aq } from 'agnostic-query';
import { toDb0 } from 'agnostic-query/db0/sqlite.js';
import { openaiDefaults, ytdlpDefaults } from '@repo/config';
import { db, sql } from '#/db/index.ts';
import type {
	SaveOpenAISettingsInput,
	Settings,
} from '#/feat/settings/schema.ts';
import { settings } from '#/feat/settings/table.ts';
import { normalizeOpenAIBaseUrl } from '@repo/cli/src/ml/openai/url.ts';

// 1. 重载一：当传了必填的默认值时，返回值绝对没有 undefined，直接就是 T
export async function get_setting<T extends string | number>(
	key: string,
	defaultVul: T,
): Promise<T>;
// 2. 重载二：当没有传默认值时，返回值可以是 T 或者 undefined
export async function get_setting<T extends string | number = string>(
	key: string,
): Promise<T | undefined>;
// 3. 实际的函数实现体
export async function get_setting<T extends string | number>(
	key: string,
	defaultVul?: T,
) {
	const qs = aq<Settings>({ table: 'settings' })
		.where('key', '=', key)
		.toJSON();

	const [row] = await toDb0(sql, qs);
	if (typeof defaultVul === 'number') {
		return row ? (Number(row.value) as T) : defaultVul;
	}
	return (row?.value as T) || defaultVul;
}
export const set_setting = async (key: string, value: string) => {
	const [row] = await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value },
		})
		.returning();
	return row;
};

export const get_ytdlp_settings = async () => {
	const defaults = ytdlpDefaults();
	return {
		proxy_port: (await get_setting('ytdlp_proxy_port')) || defaults.proxyPort,
	};
};
export const save_ytdlp_settings = async (proxy_port: string) => {
	const ret = await set_setting('ytdlp_proxy_port', proxy_port.trim());
	return {
		proxy_port: ret.value,
	};
};

export const get_openai_settings = async () => {
	const defaults = openaiDefaults();
	return {
		base_url: normalizeOpenAIBaseUrl(
			await get_setting('openai.base_url', defaults.baseUrl),
		),
		api_key: await get_setting('openai.api_key', defaults.apiKey),
		model: await get_setting('openai.model', defaults['model']),
		translate_concurrency: await get_setting(
			'openai.translate_concurrency',
			defaults.translateConcurrency,
		),
	};
};

export const save_openai_settings = async ({
	base_url,
	api_key,
	model,
	translate_concurrency,
}: SaveOpenAISettingsInput) => {
	if (base_url) {
		await set_setting('openai.base_url', normalizeOpenAIBaseUrl(base_url));
	}
	if (api_key !== undefined) {
		await set_setting('openai.api_key', api_key.trim());
	}
	if (translate_concurrency !== undefined) {
		await set_setting(
			'openai.translate_concurrency',
			String(translate_concurrency),
		);
	}
	if (model) {
		await set_setting('openai.model', model.trim());
	}
};
