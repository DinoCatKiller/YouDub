import { sqliteTable, AnySQLiteColumn, foreignKey, primaryKey, text, integer } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const taskStages = sqliteTable("task_stages", {
	taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" } ),
	name: text().notNull(),
	label: text().notNull(),
	status: text().notNull(),
	startedAt: text("started_at"),
	completedAt: text("completed_at"),
	lastMessage: text("last_message"),
	errorMessage: text("error_message"),
	progress: integer(),
	id: text(),
},
(table) => [
	primaryKey({ columns: [table.taskId, table.name], name: "task_stages_task_id_name_pk"})
]);

export const tasks = sqliteTable("tasks", {
	id: text().primaryKey().notNull(),
	url: text().notNull(),
	title: text(),
	status: text().notNull(),
	currentStage: text("current_stage"),
	sessionPath: text("session_path"),
	finalVideoPath: text("final_video_path"),
	errorMessage: text("error_message"),
	createdAt: text("created_at").notNull(),
	startedAt: text("started_at"),
	completedAt: text("completed_at"),
});

export const settings = sqliteTable("settings", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	updatedAt: text("updated_at").notNull(),
});

