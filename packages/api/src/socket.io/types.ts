import type { QuerySchema } from 'agnostic-query';
import { z } from 'zod';
import type { CookieInfo } from '#/feat/settings/cookie.ts';
import type { ModelStatus } from '@repo/voxlab';
import { AppErr, AppError, appErrCode, newErr, type Ret } from '#/ws/errors.ts';
import type {
	CollectClientToServerEvents,
	CollectServerToClientEvents,
} from '#/ws/types.ts';

export interface ClientToServerEvents extends CollectClientToServerEvents {
	save_youtube_cookie: (
		input: string,
		result: (res: Ret<CookieInfo>) => void,
	) => void;
	get_youtube_cookie: (_: void, result: (res: Ret<CookieInfo>) => void) => void;
	hello: () => void;
	message: (data: string) => void;
	msg: (text: string) => void;
	ping: (callback: (response: string) => void) => void;
	sync: (payload: { id: string }) => void;
	echo: (data: { hello: string }) => void;
	binaryEcho: (data: Uint8Array) => void;

	'ml:voxcpm:prepare': (
		data: Record<string, never>,
		callback: (response: {
			status: 'success' | 'error' | 'processing';
			message: string;
		}) => void,
	) => void;
	'test:event': (data: { timestamp: number }) => void;
	'ml:voxcpm:check': () => void;
	subscribe: (data: { topic: string; id?: string }) => void;
	unsubscribe: (data: { topic: string; id?: string }) => void;
	createTask: (
		url: string,
		callback: (res: Ret<{ id: string }>) => void,
	) => void;
	resumeTask: (
		id: string,
		callback: (res: Ret<{ id: string }>) => void,
	) => void;
	rerunStage: (
		input: { taskId: string; stageName: string; cascade?: boolean },
		callback: (res: Ret<{ id: string }>) => void,
	) => void;
	rerunTask: (id: string, callback: (res: Ret<{ id: string }>) => void) => void;
}

export interface ServerToClientEvents extends CollectServerToClientEvents {
	noArg: () => void;
	basicEmit: (a: number, b: string, c: Uint8Array) => void;
	withAck: (d: string, callback: (e: number) => void) => void;
	reply: (data: { received: boolean } | { from: string }) => void;
	msg: (data: string[]) => void;
	echo: (data: { hello: string }) => void;
	sync: (rows: Array<Record<string, unknown>>) => void;

	'test:event': (data: { message: string }) => void;
	'broadcast:event': (data: { message: string }) => void;
	'ml:voxcpm:status': (status: ModelStatus) => void;
	'ml:voxcpm:progress': (data: { message: string; percent: number }) => void;
	task_log: (data: { taskId: string; line: string }) => void;
}

export interface InterServerEvents {
	ping: () => void;
}

export interface SocketData {
	name: string;
	age: number;
}

// --- 业务数据模型 ---

export const TaskSummarySchema = z.object({
	id: z.string(),
	url: z.string(),
	title: z.string().nullable(),
	status: z.string(),
	current_stage: z.string().nullable(),
	created_at: z.string(),
});

export const TaskSchema = z.object({
	id: z.string(),
	url: z.string(),
	title: z.string().nullable(),
	status: z.string(),
	current_stage: z.string().nullable(),
	session_path: z.string().nullable(),
	final_video_path: z.string().nullable(),
	error_message: z.string().nullable(),
	created_at: z.string(),
	started_at: z.string().nullable(),
	completed_at: z.string().nullable(),
	stages: z.array(z.any()), // 简化处理
});

// --- 订阅请求数据 ---

export const SubscribeSchema = z.object({
	topic: z.enum(['tasks:list', 'tasks:detail', 'tasks:log']),
	id: z.string().optional(),
});

export type SubscribePayload = z.infer<typeof SubscribeSchema>;
