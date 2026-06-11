import { client } from '@repo/api/src/client';
import { socket } from '#/components/socket/ws.ts';

const API_BASE =
	(import.meta as Record<string, any>).env?.VITE_API_BASE_URL ?? '';

export interface TaskStage {
	task_id: string;
	name: string;
	label: string;
	status: string;
	started_at: string | null;
	completed_at: string | null;
	last_message: string | null;
	error_message: string | null;
}

export interface Task {
	id: string;
	url: string;
	title: string | null;
	status: string;
	current_stage: string | null;
	session_path: string | null;
	final_video_path: string | null;
	error_message: string | null;
	created_at: string;
	started_at: string | null;
	completed_at: string | null;
	stages: TaskStage[];
}

export interface TaskSummary {
	id: string;
	url: string;
	title: string | null;
	status: string;
	current_stage: string | null;
	created_at: string;
}

export interface CookieInfo {
	exists: boolean;
	size: number;
	updated_at: number | null;
	content: string;
}

export interface OpenAISettings {
	base_url: string;
	api_key: string;
	has_api_key: boolean;
	model: string;
	translate_concurrency: string;
}

export interface OpenAISettingsUpdate {
	base_url: string;
	api_key: string;
	model: string;
	translate_concurrency: string;
	clear_api_key?: boolean;
}

export interface OpenAIModels {
	models: string[];
}

export interface YtdlpSettings {
	proxy_port: string;
}

export type LocalDirection = 'en-zh' | 'zh-en';

const createRequestFn =
	({
		method = 'GET',
		baseUrl,
	}: {
		baseUrl?: string;
		method?: 'GET' | 'POST' | 'PUT';
	}) =>
	async <T>(path: string, options?: RequestInit): Promise<T> => {
		const url = `${baseUrl}${path}`;
		const res = await fetch(url, {
			method,
			...options,
			headers: {
				'Content-Type': 'application/json',
				...options?.headers,
			},
			cache: 'no-store',
		});

		if (!res.ok) {
			// 错误信息也可能是 text 或者 json
			const isJson = res.headers
				.get('Content-Type')
				?.includes('application/json');
			const body = isJson ? await res.json().catch(() => null) : null;
			const textDetail = !isJson ? await res.text().catch(() => null) : null;
			throw new Error(body?.detail ?? textDetail ?? `HTTP ${res.status}`);
		}
		if (res.status === 204) return undefined as T;
		// 👇 根据 Content-Type 动态决定解析方式
		const contentType = res.headers.get('Content-Type') || '';
		if (contentType.includes('application/json')) {
			return res.json() as Promise<T>;
		} else {
			return res.text() as unknown as Promise<T>;
		}
	};
export const request = createRequestFn({ baseUrl: API_BASE });

export function getTaskLog(id: string): Promise<string> {
	return request(`/api/tasks/${id}/log`);
}

// export function rerunTask(id: string): Promise<Task> {
// 	return request(`/api/tasks/${id}/rerun`, { method: 'POST' });
// }

// export function resumeTask(id: string): Promise<Task> {
// 	return request(`/api/tasks/${id}/resume`, { method: 'POST' });
// }

// export function rerunStage(
// 	id: string,
// 	stage: string,
// 	cascade = false,
// ): Promise<Task> {
// 	return request(`/api/tasks/${id}/rerun-stage`, {
// 		method: 'POST',
// 		body: JSON.stringify({ stage, cascade }),
// 	});
// }

export function uploadLocalTask(
	file: File,
	direction: LocalDirection,
): Promise<Task> {
	const form = new FormData();
	form.append('file', file);
	form.append('direction', direction);
	return fetch(`${API_BASE}/api/tasks/upload`, {
		method: 'POST',
		body: form,
	}).then(async (res) => {
		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new Error(body?.detail ?? `HTTP ${res.status}`);
		}
		return res.json() as Promise<Task>;
	});
}

export function finalVideoUrl(final_video_path: string): string {
	client.finalVideoUrl.$get({ query: { final_video_path } }); // 预热接口
	return `${API_BASE}/api/finalVideoUrl?final_video_path=${encodeURIComponent(final_video_path)}`;
}

export function finalVideoDownloadUrl(final_video_path: string): string {
	return `${API_BASE}/api/finalVideoUrl?final_video_path=${encodeURIComponent(final_video_path)}&download=true`;
}
