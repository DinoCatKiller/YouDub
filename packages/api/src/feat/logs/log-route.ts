import { Hono } from 'hono';
import { readFileSync, existsSync, statSync, watch, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '@repo/config';
import { db } from '#/db/index.ts';
import { eq, sql } from 'drizzle-orm';
import { io } from '#/socket.io/io.ts';
import { taskStages } from '#/feat/tasks/table.ts';

const logRoute = new Hono();

logRoute.get('/tasks/:id/log', (c) => {
  const taskId = c.req.param('id');
  const logPath = join(LOG_DIR, `${taskId}.log`);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('retry: 2000\n\n'));

      let fileSize = 0;
      const sendLine = (line: string) => {
        const safe = JSON.stringify(line);
        controller.enqueue(new TextEncoder().encode(`event: log\ndata: ${safe}\n\n`));

        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress' && msg.task_id && msg.stage && msg.status) {
            const fields: Record<string, unknown> = { status: msg.status };
            if (msg.progress != null) fields.progress = msg.progress;
            if (msg.status === 'running') fields.started_at = new Date().toISOString().replace(/\.\d{3}Z$/, '');
            if (msg.status === 'succeeded' || msg.status === 'failed') fields.completed_at = new Date().toISOString().replace(/\.\d{3}Z$/, '');
            if (msg.status === 'failed') fields.error_message = msg.message || 'Unknown error';

            db.update(taskStages)
              .set(fields)
              .where(sql`${taskStages.task_id} = ${msg.task_id} AND ${taskStages.name} = ${msg.stage}`)
              .then(() => {
                io.emit('transaction', {
                  id: 'task_stages',
                  transactionId: crypto.randomUUID(),
                  mutations: [
                    { type: 'update', id: `${msg.task_id}_${msg.stage}`, data: { task_id: msg.task_id, name: msg.stage, ...fields } },
                  ],
                });
              })
              .catch(() => {});
          }
        } catch {}
      };

      const readNewLines = () => {
        if (!existsSync(logPath)) return;
        const newSize = statSync(logPath).size;
        if (newSize <= fileSize) return;
        const buf = Buffer.alloc(newSize - fileSize);
        const fd = openSync(logPath, 'r');
        readSync(fd, buf, 0, buf.length, fileSize);
        closeSync(fd);
        fileSize = newSize;
        for (const line of buf.toString().split('\n').filter(Boolean)) {
          sendLine(line);
        }
      };

      if (existsSync(logPath)) {
        fileSize = statSync(logPath).size;
        const content = readFileSync(logPath, 'utf-8');
        for (const line of content.split('\n').filter(Boolean)) {
          sendLine(line);
        }
      }

      const watcher = watch(logPath, (event) => {
        if (event === 'change') readNewLines();
      });

      const signal = c.req.raw.signal;
      signal?.addEventListener('abort', () => {
        watcher.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

export default logRoute;
