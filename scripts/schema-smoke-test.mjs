import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
const migrations = fs.readdirSync("drizzle").filter(file => /^\d+.*\.sql$/.test(file)).sort();

for (const migration of migrations) {
  const sql = fs.readFileSync(`drizzle/${migration}`, "utf8").replaceAll("--> statement-breakpoint", ";");
  database.exec(sql);
}

const requiredColumns = {
  orders: ["payment_terms"],
  order_items: ["package_count", "package_type", "package_unit_weight_kg", "weight_kg"],
  routes: ["origin_address", "planned_km", "estimated_cost_cents"],
  route_stops: ["weight_kg", "package_summary"],
  erp_integrations: ["base_url", "orders_path", "last_sync_status"],
  profitability_entries: ["gross_profit_cents", "delivery_cost_cents"],
  route_events: ["event_type", "odometer_km"],
};

for (const [table, columns] of Object.entries(requiredColumns)) {
  const actual = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
  for (const column of columns) {
    if (!actual.has(column)) throw new Error(`Coluna obrigatória ausente: ${table}.${column}`);
  }
}

const tableCount = database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count;
console.log(JSON.stringify({ migrations: migrations.length, tables: tableCount, checked: Object.keys(requiredColumns) }));
