import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const analyses = sqliteTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    findingsJson: text("findings_json").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    projectCreated: index("analyses_project_created").on(table.projectId, table.createdAt),
  }),
);

export const researchArtifacts = sqliteTable(
  "research_artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    inputHash: text("input_hash").notNull(),
    queryMetaJson: text("query_meta_json").notNull(),
    contentJson: text("content_json").notNull(),
    citationsJson: text("citations_json").notNull(),
    pinned: integer("pinned").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    projectKindCreated: index("research_artifacts_project_kind_created").on(
      table.projectId,
      table.kind,
      table.createdAt,
    ),
  }),
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    roleTitle: text("role_title").notNull(),
    seniority: text("seniority").notNull(),
    companyName: text("company_name").notNull(),
    companyDomain: text("company_domain").notNull(),
    location: text("location").notNull(),
    profileUrlsJson: text("profile_urls_json").notNull(),
    skillsJson: text("skills_json").notNull(),
    matchConfidence: real("match_confidence"),
    warmTrigger: text("warm_trigger").notNull(),
    outreachAngle: text("outreach_angle").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    projectStatus: index("leads_project_status").on(table.projectId, table.status),
  }),
);
