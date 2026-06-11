// file: validator-wrapper.ts

import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';

export const zv = <
	T extends z.ZodSchema,
	Target extends keyof ValidationTargets,
>(
	target: Target,
	schema: T,
) =>
	zValidator(target, schema, (result, c) => {
		if (!result.success) {
			// throw new HTTPException(400, { cause: result.error });
			return c.json({ ok: false, msg: result.error.message } as const, 400);
		}
	});
