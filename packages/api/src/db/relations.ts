import { relations } from 'drizzle-orm/relations';
import { taskStages, tasks } from './schema';

export const taskStagesRelations = relations(taskStages, ({ one }) => ({
	task: one(tasks, {
		fields: [taskStages.task_id],
		references: [tasks.id],
	}),
}));

export const tasksRelations = relations(tasks, ({ many }) => ({
	taskStages: many(taskStages),
}));
