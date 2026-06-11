import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { REPO_ROOT, LOG_DIR } from '@repo/config';

const app = new Hono()
	.get(
		'/finalVideoUrl',
		zValidator(
			'query',
			z.object({
				final_video_path: z.string(),
				download: z.boolean().optional(),
			}),
		),
		async (c) => {
			const final_video_path = c.req.valid('query').final_video_path;
			const videoBuffer = readFileSync(join(REPO_ROOT, final_video_path));
			return c.body(videoBuffer, 200, {
				'Content-Type': 'video/mp4',
			});
		},
	)
	.get('/tasks/:taskId/log', async (c) => {
		const taskId = c.req.param('taskId');
		const logPath = join(LOG_DIR, `${taskId}.log`);
		if (!existsSync(logPath)) return c.body('', 200, { 'Content-Type': 'text/plain' });
		const content = readFileSync(logPath, 'utf-8');
		return c.body(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
	})
	.post('/uploadLocalFile');

export default app;
