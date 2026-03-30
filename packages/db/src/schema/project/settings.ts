import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { projects } from './project';

/** Shape stored in the database for MCP server configs. */
export type McpServerConfigDb = {
    id: string;
    name: string;
    enabled: boolean;
    transport: 'http' | 'sse' | 'stdio';
    url?: string;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
};

export const projectSettings = pgTable('project_settings', {
    projectId: uuid('project_id')
        .notNull()
        .references(() => projects.id, { onDelete: 'cascade', onUpdate: 'cascade' })
        .unique(),
    runCommand: text('run_command').notNull().default(''),
    buildCommand: text('build_command').notNull().default(''),
    installCommand: text('install_command').notNull().default(''),
    mcpServers: jsonb('mcp_servers').$type<McpServerConfigDb[]>().default([]).notNull(),
}).enableRLS();

export const projectSettingsInsertSchema = createInsertSchema(projectSettings);
export const projectSettingsUpdateSchema = createUpdateSchema(projectSettings);

export const projectSettingsRelations = relations(projectSettings, ({ one }) => ({
    project: one(projects, {
        fields: [projectSettings.projectId],
        references: [projects.id],
    }),
}));

export type ProjectSettings = typeof projectSettings.$inferSelect;
export type NewProjectSettings = typeof projectSettings.$inferInsert;