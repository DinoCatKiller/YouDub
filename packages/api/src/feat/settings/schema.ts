import type { InferSelectModel } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { settings } from './table.ts';

export type Settings = InferSelectModel<typeof settings>;
export const settingsSchema: z.ZodType<Settings> = createSelectSchema(settings);

export const saveOpenAISettingsSchema = z.object({
	base_url: z.string().optional(),
	api_key: z.string().optional(),
	model: z.string().optional(),
	translate_concurrency: z.number().optional(),
});
export type SaveOpenAISettingsInput = z.input<typeof saveOpenAISettingsSchema>;

export const getOpenaiModelsSchema = z.object({
	base_url: z.string().optional(),
	api_key: z.string().optional(),
});
export type GetOpenAIModelsInput = z.input<typeof getOpenaiModelsSchema>;
