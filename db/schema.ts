import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["ceo", "manager", "operator", "viewer"] }).notNull().default("viewer"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  department: text("department").notNull(),
  module: text("module").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  ownerId: text("owner_id").references(() => users.id),
  dueDate: integer("due_date", { mode: "timestamp" }),
  amountCents: integer("amount_cents"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, table => [index("idx_records_department_module").on(table.department, table.module), index("idx_records_status_due_date").on(table.status, table.dueDate)]);

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordId: integer("record_id").notNull().references(() => records.id),
  storageKey: text("storage_key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: text("uploaded_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, table => [index("idx_files_record_id").on(table.recordId)]);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: text("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: text("details"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, table => [index("idx_audit_entity").on(table.entityType, table.entityId), index("idx_audit_created_at").on(table.createdAt)]);
