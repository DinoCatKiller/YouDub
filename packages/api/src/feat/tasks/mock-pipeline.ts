import { nowISO, updateStage, updateTask } from '#/feat/tasks/fn.ts';
import { STAGES } from '#/feat/tasks/stages.ts';



////假流水线，用于测试
async function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export async function mockPipeline(taskId: string) {
	console.log(`[MockPipeline] Starting task ${taskId}`);

	const startedAt = nowISO();
	await updateTask(taskId, { status: 'running', started_at: startedAt });

	for (const stage of STAGES) {
		console.log(`[MockPipeline] Stage: ${stage.name}`);

		await updateStage(taskId, stage.name, {
			status: 'running',
			started_at: nowISO(),
			progress: 0,
		});
		await updateTask(taskId, { current_stage: stage.name });

		// 每秒涨一点进度，每个阶段跑 2~4 秒
		const duration = 2000 + Math.random() * 2000;
		const steps = Math.ceil(duration / 1000);
		for (let i = 1; i <= steps; i++) {
			await sleep(1000);
			const pct = Math.round((i / steps) * 100);
			await updateStage(taskId, stage.name, { progress: pct });
		}

		await updateStage(taskId, stage.name, {
			status: 'completed',
			progress: 100,
			completed_at: nowISO(),
		});
	}

	await updateTask(taskId, {
		status: 'completed',
		current_stage: STAGES[STAGES.length - 1].name,
		completed_at: nowISO(),
		final_video_path: `/mock/${taskId}/final.mp4`,
	});

	console.log(`[MockPipeline] Task ${taskId} completed`);
}
