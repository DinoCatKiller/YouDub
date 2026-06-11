import { createQuerySchema } from 'agnostic-query/zod.js';
import type { TaskStages, Tasks } from '#/feat/tasks/schema.ts';
import { taskStages, tasks } from '#/feat/tasks/table.ts';
import { AppError } from '#/ws/errors.ts';

export const tableRegistry = {
	tasks: {
		dbTable: tasks,
		validate: createQuerySchema(),
	},
	task_stages: {
		dbTable: taskStages,
		validate: createQuerySchema(),
	},
};
export const validate = createQuerySchema();

export type TableName = keyof typeof tableRegistry;

export const getTableInfo = <T extends TableName>(table: T) => {
	const info = tableRegistry[table];
	if (!info) {
		throw new AppError('TABLE_NOT_FOUND', `Unknown table: ${table}`);
	}
	return info;
};
