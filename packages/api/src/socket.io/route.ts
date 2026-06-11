import { aq } from 'agnostic-query';
import { toDb0 } from 'agnostic-query/db0/sqlite.js';
// import { toDrizzle } from 'agnostic-query/drizzle/sqlite';
import { and, sql as drizzleSql, eq } from 'drizzle-orm';
import { db, sql } from '#/db/index';
import {
	get_youtube_cookie,
	save_youtube_cookie,
} from '#/feat/settings/cookie.ts';
import { createTask, findTaskByVideoId, nowISO } from '#/feat/tasks/fn.ts';
import { STAGE_NAMES, STAGES } from '#/feat/tasks/stages.ts';
import { taskStages, tasks } from '#/feat/tasks/table.ts';
import { extractVideoId } from '#/feat/tasks/validate.ts';
import { runPipeline } from '@repo/cli/src/feat/tasks/pipeline-runner.ts';
import { getMLDaemon } from '#/feat/daemon/ml-daemon.ts';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
} from '#/socket.io/types.ts';
import { applyTransaction, assertCollection } from '#/ws/collect.ts';
import { errorHandler } from '#/ws/errors.ts';
import { getTableInfo, tableRegistry } from '#/ws/registry.ts';
import { downloadVoxCPM, checkONNXReady } from '@repo/voxlab';
import { engine, io } from './io.ts';

// 全局任务状态追踪
const voxcpmPrepareTask: {
	status: 'idle' | 'processing' | 'success' | 'error';
	progress: { message: string; percent: number } | null;
} = {
	status: 'idle',
	progress: null,
};

io.on('connection', async (socket) => {
	console.log('New client connected:', socket.id);

	socket.on(
		'get_youtube_cookie',
		errorHandler(async () => {
			return await get_youtube_cookie();
		}),
	);
	socket.on(
		'save_youtube_cookie',
		errorHandler(async (input) => {
			return await save_youtube_cookie(input);
		}),
	);

	// 发送欢迎消息
	socket.emit('echo', { hello: 'Welcome to YouDub WebSocket API' });

	socket.on('test:event', (data) => {
		console.log('Received test:event with data:', data);
		socket.emit('test:event', { message: 'Test event received!' });

		io.emit('broadcast:event', {
			message: `Client ${socket.id} says hello to everyone!`,
		});
	});

	// 1. 立即检测并同步模型状态
	const status = await checkONNXReady();
	socket.emit('ml:voxcpm:status', status);

	// 2. 如果当前有正在进行的任务，立即同步进度给新连接的客户端
	if (voxcpmPrepareTask.status === 'processing' && voxcpmPrepareTask.progress) {
		socket.emit('ml:voxcpm:progress', voxcpmPrepareTask.progress);
	}

	// 响应式检测请求
	socket.on('ml:voxcpm:check', async () => {
		const status = await checkONNXReady();
		socket.emit('ml:voxcpm:status', status);
	});

	// 处理模型准备请求 (请求-响应模式)
	socket.on('ml:voxcpm:prepare', async (data, callback) => {
		console.log('Received ml:voxcpm:prepare request from client:', socket.id);
		if (voxcpmPrepareTask.status === 'processing') {
			return callback({
				status: 'error',
				message: 'A preparation task is already running.',
			});
		}

		const currentStatus = await checkONNXReady();
		if (currentStatus.isReady) {
			return callback({
				status: 'success',
				message: 'Model is already ready.',
			});
		}

		if (currentStatus.exists) {
			voxcpmPrepareTask.status = 'processing';
			voxcpmPrepareTask.progress = {
				message: 'Starting download...',
				percent: 0,
			};

			// 全局推送开始消息
			io.emit('ml:voxcpm:progress', voxcpmPrepareTask.progress);

			// 直接在 TS 中执行下载
			(async () => {
				try {
					await downloadVoxCPM((percent, message) => {
						const newProgress = { message, percent };
						voxcpmPrepareTask.progress = newProgress;
						io.emit('ml:voxcpm:progress', newProgress);
					});

					voxcpmPrepareTask.status = 'success';
					voxcpmPrepareTask.progress = {
						message: 'All models downloaded!',
						percent: 100,
					};
					io.emit('ml:voxcpm:progress', voxcpmPrepareTask.progress);

					// 更新状态给所有客户端
					const finalStatus = await checkONNXReady();
					io.emit('ml:voxcpm:status', finalStatus);
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : 'Unknown download error';
					console.error('[WS] Download failed:', error);
					voxcpmPrepareTask.status = 'error';
					voxcpmPrepareTask.progress = {
						message: `Download failed: ${message}`,
						percent: 0,
					};
					io.emit('ml:voxcpm:progress', voxcpmPrepareTask.progress);
				}
			})();

			return callback({ status: 'processing', message: 'Download started.' });
		} else {
			callback({
				status: 'error',
				message: 'Model weights not found. Please run Python backend first.',
			});
		}
	});

	socket.on(
		'createTask',
		errorHandler(async (url: string) => {
			const videoId = extractVideoId(url);

			const existingId = await findTaskByVideoId(videoId);
			if (existingId) {
				return { id: existingId };
			}

			const [ret] = await createTask(url.trim(), videoId);
			const id = ret.id;

			const mlDaemon = getMLDaemon();
			if (mlDaemon) {
				runPipeline(id, mlDaemon).catch((err) => {
					console.error(`[Pipeline] Task ${id} failed:`, err);
				});
			} else {
				console.warn(`[Pipeline] Task ${id} created but ML daemon not ready`);
			}

			return { id };
		}),
	);

	// ── Task lifecycle: rerun/resume/rerunStage ──

	socket.on(
		'rerunTask',
		errorHandler(async (taskId: string) => {
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
			if (!task) throw new Error(`Task ${taskId} not found`);

			for (const stage of STAGES) {
				await db
					.update(taskStages)
					.set({
						status: 'pending',
						started_at: null,
						completed_at: null,
						error_message: null,
						last_message: null,
						progress: null,
					})
					.where(
						and(
							eq(taskStages.task_id, taskId),
							eq(taskStages.name, stage.name),
						),
					);
			}
			await db
				.update(tasks)
				.set({
					status: 'queued',
					current_stage: STAGES[0].name,
					error_message: null,
					started_at: null,
					completed_at: null,
				})
				.where(eq(tasks.id, taskId));

			io.emit('transaction', {
				id: 'tasks',
				transactionId: crypto.randomUUID(),
				mutations: [
					{
						type: 'update',
						id: taskId,
						data: {
							status: 'queued',
							current_stage: STAGES[0].name,
							error_message: null,
							started_at: null,
							completed_at: null,
						},
					},
				],
			});
			return { id: taskId };
		}),
	);

	socket.on(
		'resumeTask',
		errorHandler(async (taskId: string) => {
			const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
			if (!task) throw new Error(`Task ${taskId} not found`);

			const stages = await db
				.select()
				.from(taskStages)
				.where(eq(taskStages.task_id, taskId));
			stages.sort(
				(a, b) => STAGE_NAMES.indexOf(a.name) - STAGE_NAMES.indexOf(b.name),
			);
			const resumeFrom = stages.findIndex((s) => s.status !== 'succeeded');
			if (resumeFrom === -1) return { id: taskId }; // already completed

			const resumeStage = stages[resumeFrom];
			for (let i = resumeFrom; i < stages.length; i++) {
				await db
					.update(taskStages)
					.set({
						status: 'pending',
						started_at: null,
						completed_at: null,
						error_message: null,
						last_message: null,
						progress: null,
					})
					.where(
						and(
							eq(taskStages.task_id, taskId),
							eq(taskStages.name, stages[i].name),
						),
					);
			}
			await db
				.update(tasks)
				.set({
					status: 'queued',
					current_stage: resumeStage.name,
					error_message: null,
				})
				.where(eq(tasks.id, taskId));

			io.emit('transaction', {
				id: 'tasks',
				transactionId: crypto.randomUUID(),
				mutations: [
					{
						type: 'update',
						id: taskId,
						data: {
							status: 'queued',
							current_stage: resumeStage.name,
							error_message: null,
						},
					},
				],
			});
			return { id: taskId };
		}),
	);

	socket.on(
		'rerunStage',
		errorHandler(
			async (input: {
				taskId: string;
				stageName: string;
				cascade?: boolean;
			}) => {
				const [task] = await db
					.select()
					.from(tasks)
					.where(eq(tasks.id, input.taskId));
				if (!task) throw new Error(`Task ${input.taskId} not found`);

				const stageIdx = STAGES.findIndex((s) => s.name === input.stageName);
				if (stageIdx === -1)
					throw new Error(`Stage ${input.stageName} not found`);

				const stagesToReset = input.cascade
					? STAGES.slice(stageIdx)
					: [STAGES[stageIdx]];

				for (const stage of stagesToReset) {
					await db
						.update(taskStages)
						.set({
							status: 'pending',
							started_at: null,
							completed_at: null,
							error_message: null,
							last_message: null,
							progress: null,
						})
						.where(
							and(
								eq(taskStages.task_id, input.taskId),
								eq(taskStages.name, stage.name),
							),
						);
				}
				await db
					.update(tasks)
					.set({
						status: 'queued',
						current_stage: STAGES[stageIdx].name,
						error_message: null,
					})
					.where(eq(tasks.id, input.taskId));

				io.emit('transaction', {
					id: 'tasks',
					transactionId: crypto.randomUUID(),
					mutations: [
						{
							type: 'update',
							id: input.taskId,
							data: {
								status: 'queued',
								current_stage: STAGES[stageIdx].name,
								error_message: null,
							},
						},
					],
				});
				return { id: input.taskId };
			},
		),
	);

	socket.on('sync', async ({ id }) => {
		try {
			assertCollection(id);
			socket.emit(
				'sync',
				await toDb0(
					sql,
					aq({
						table: id,
					}).toJSON(),
				),
			);
		} catch (error) {
			console.error('[WS] Sync failed:', error);
			socket.emit('sync', []);
		}
	});
	socket.on(
		'loadSubset',
		errorHandler(async (payload) => {
			const entry = getTableInfo(payload.table);
			const parsed = entry.validate.parse(payload);
			console.log('[loadSubset] Parsed payload:', parsed);
			return await toDb0(sql, parsed);
		}),
	);

	socket.on('transaction', (payload, callback) => {
		try {
			applyTransaction(payload);
			io.emit('transaction', payload);
			callback({ ok: true });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown transaction error';
			console.error('[WS] Transaction failed:', error);
			callback({ ok: false, error: message });
		}
	});
	socket.on('unloadSubset', (payload) => {
		console.log('[unloadSubset]', payload.table, payload);
	});

	socket.on('subscribe', (payload: { topic: string; id?: string }) => {
		if (payload.topic === 'tasks:log' && payload.id) {
			socket.join(payload.id);
		}
	});

	socket.on('unsubscribe', (payload: { topic: string; id?: string }) => {
		if (payload.topic === 'tasks:log' && payload.id) {
			socket.leave(payload.id);
		}
	});

	socket.on('disconnect', (reason) => {
		console.log('Client disconnected:', socket.id, 'Reason:', reason);
	});
});

export { engine, io };
