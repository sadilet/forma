import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  color: text("color").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  roomId: text("room_id").notNull().unique(),
  template: text("template").notNull(),
  goal: text("goal").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const specifications = sqliteTable(
  "specifications",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    content: text("content").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectBlock: uniqueIndex("specifications_project_block").on(
      table.projectId,
      table.blockId,
    ),
  }),
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull().default(""),
    messages: text("messages").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    projectBlock: uniqueIndex("conversations_project_block").on(
      table.projectId,
      table.blockId,
    ),
  }),
);
