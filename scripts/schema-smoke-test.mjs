import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(":memory:");
const migrations = fs.readdirSync("drizzle").filter(file => /^\d+.*\.sql$/.test(file)).sort();

for (const migration of migrations) {
  const sql = fs.readFileSync(`drizzle/${migration}`, "utf8").replaceAll("--> statement-breakpoint", ";");
  database.exec(sql);
}

const requiredColumns = {
  customers: ["receiving_window"],
  orders: ["payment_terms"],
  order_items: ["package_count", "package_type", "package_unit_weight_kg", "weight_kg", "volume_m3"],
  vehicles: ["capacity_kg", "capacity_m3"],
  drivers: ["name", "license_expiry", "mopp_expiry", "status"],
  routes: ["driver_id", "origin_address", "planned_km", "estimated_cost_cents"],
  route_stops: ["weight_kg", "volume_m3", "package_summary", "receiving_window"],
  erp_integrations: ["base_url", "orders_path", "last_sync_status"],
  profitability_entries: ["gross_profit_cents", "delivery_cost_cents", "source_key"],
  route_events: ["event_type", "odometer_km"],
};

for (const [table, columns] of Object.entries(requiredColumns)) {
  const actual = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
  for (const column of columns) {
    if (!actual.has(column)) throw new Error(`Coluna obrigatória ausente: ${table}.${column}`);
  }
}

database.exec(`
  INSERT INTO vehicles (plate,model,capacity_kg,capacity_m3,created_at,updated_at) VALUES ('TST1A23','Caminhão de teste',1000,10,1,1);
  INSERT INTO drivers (name,cpf,license_expiry,mopp_expiry,created_at,updated_at) VALUES ('Motorista Teste','12345678901',2000000000,2000000000,1,1);
  INSERT INTO routes (code,name,vehicle_id,driver_id,driver_name,route_date,origin_address,created_at,updated_at)
    VALUES ('ROT-TESTE','Rota de teste',1,1,'Motorista Teste',1900000000,'Depósito',1,1);
`);
const linkedDriver = database.prepare("SELECT d.name FROM routes r JOIN drivers d ON d.id=r.driver_id WHERE r.code='ROT-TESTE'").get();
if (linkedDriver?.name !== "Motorista Teste") throw new Error("Vínculo motorista-rota não foi preservado");
let duplicateCpfRejected = false;
try {
  database.prepare("INSERT INTO drivers (name,cpf,created_at,updated_at) VALUES (?,?,?,?)").run("Motorista Duplicado", "12345678901", 1, 1);
} catch {
  duplicateCpfRejected = true;
}
if (!duplicateCpfRejected) throw new Error("CPF duplicado de motorista não foi rejeitado");

const fixtureNow = 1900000000;
const fixtureDay = 86400;
const fixtureDate = new Date(fixtureNow * 1000);
const fixtureMonthStart = Math.floor(Date.UTC(fixtureDate.getUTCFullYear(), fixtureDate.getUTCMonth(), 1) / 1000);
database.prepare("INSERT INTO customers (company_name,document,city,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("Cliente Analítico", "00999999000100", "Rio de Janeiro", "active", 1, 1);
database.prepare("INSERT INTO customers (company_name,document,city,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("Cliente de Rota", "00888888000100", "Rio de Janeiro", "active", 1, 1);
database.prepare("INSERT INTO products (name,category,created_at,updated_at) VALUES (?,?,?,?)").run("Hipoclorito", "Químicos", 1, 1);
database.prepare("INSERT INTO products (name,category,created_at,updated_at) VALUES (?,?,?,?)").run("Barrilha", "Químicos", 1, 1);
const orderInsert = database.prepare("INSERT INTO orders (number,customer_id,order_date,delivery_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
orderInsert.run("PED-SEMANA", 1, fixtureNow - fixtureDay, fixtureNow, "confirmed", 1, 1);
orderInsert.run("PED-MES", 1, fixtureMonthStart + fixtureDay, fixtureMonthStart + 2 * fixtureDay, "confirmed", 1, 1);
orderInsert.run("PED-ROTA-A", 2, null, null, "cancelled", 1, 1);
orderInsert.run("PED-ROTA-B", 2, null, null, "cancelled", 1, 1);
const itemInsert = database.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit,unit_price_cents,weight_kg,volume_m3,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
itemInsert.run(1, 1, "Hipoclorito", 10, "kg", 1000, 300, 4, 1, 1);
itemInsert.run(1, 2, "Barrilha", 5, "kg", 2000, 300, 4, 1, 1);
itemInsert.run(2, 1, "Hipoclorito", 4, "kg", 1000, 100, 1, 1, 1);
itemInsert.run(2, 2, "Barrilha", 3, "kg", 2000, 100, 1, 1, 1);
database.prepare("INSERT INTO route_stops (route_id,order_id,sequence,address_snapshot,weight_kg,volume_m3,package_summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(1, 1, 1, "Rio de Janeiro", 600, 8, "10 bombonas", 1, 1);
database.prepare("UPDATE route_stops SET status='completed',delivered_at=? WHERE route_id=1").run(fixtureNow + 4 * 3600);
database.prepare("INSERT INTO routes (code,name,vehicle_id,driver_id,driver_name,route_date,origin_address,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("ROT-AFIN-1", "Afinidade 1", 1, 1, "Motorista Teste", fixtureNow - 2 * fixtureDay, "Depósito", "completed", 1, 1);
database.prepare("INSERT INTO routes (code,name,vehicle_id,driver_id,driver_name,route_date,origin_address,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("ROT-AFIN-2", "Afinidade 2", 1, 1, "Motorista Teste", fixtureNow - fixtureDay, "Depósito", "completed", 1, 1);
const affinityStopInsert = database.prepare("INSERT INTO route_stops (route_id,order_id,sequence,address_snapshot,weight_kg,volume_m3,package_summary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
affinityStopInsert.run(2, 1, 1, "Rio de Janeiro", 1, 0.1, "Carga teste", 1, 1);
affinityStopInsert.run(2, 3, 2, "Rio de Janeiro", 1, 0.1, "Carga teste", 1, 1);
affinityStopInsert.run(3, 2, 1, "Rio de Janeiro", 1, 0.1, "Carga teste", 1, 1);
affinityStopInsert.run(3, 4, 2, "Rio de Janeiro", 1, 0.1, "Carga teste", 1, 1);
database.prepare("INSERT INTO profitability_entries (route_id,vehicle_id,period,revenue_cents,gross_profit_cents,delivery_cost_cents,source,created_at) VALUES (?,?,?,?,?,?,?,?)").run(1, 1, fixtureNow, 200000, 50000, 20000, "test", 1);
database.prepare("INSERT INTO route_events (route_id,event_type,occurred_at,odometer_km,created_at) VALUES (?,?,?,?,?)").run(1, "departure", fixtureNow, 1000, 1);
database.prepare("INSERT INTO route_events (route_id,event_type,occurred_at,odometer_km,created_at) VALUES (?,?,?,?,?)").run(1, "return", fixtureNow + 8 * 3600, 1120, 1);

const utilization = database.prepare("SELECT v.capacity_kg,v.capacity_m3,SUM(s.weight_kg) AS loaded_kg,SUM(s.volume_m3) AS loaded_m3,MIN(CASE WHEN s.volume_m3>0 THEN 1 ELSE 0 END) AS volume_complete FROM routes r JOIN vehicles v ON v.id=r.vehicle_id JOIN route_stops s ON s.route_id=r.id WHERE r.id=1 GROUP BY r.id").get();
const weightOccupancy = utilization.loaded_kg * 100 / utilization.capacity_kg;
const volumeOccupancy = utilization.loaded_m3 * 100 / utilization.capacity_m3;
if (weightOccupancy !== 60 || volumeOccupancy !== 80 || utilization.volume_complete !== 1 || Math.max(weightOccupancy, volumeOccupancy) !== 80) throw new Error("Ocupação efetiva por peso/cubagem incorreta");

const salesWindows = database.prepare("SELECT SUM(CASE WHEN o.order_date>=? THEN oi.quantity*oi.unit_price_cents ELSE 0 END) AS week_revenue_cents,SUM(CASE WHEN o.order_date>=? THEN oi.quantity*oi.unit_price_cents ELSE 0 END) AS month_revenue_cents FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.status<>'cancelled'").get(fixtureNow - 7 * fixtureDay, fixtureMonthStart);
if (salesWindows.week_revenue_cents !== 20000 || salesWindows.month_revenue_cents !== 30000) throw new Error("Janelas de faturamento semanal/mensal incorretas");

const recurringPair = database.prepare("SELECT a.product_name AS product_a,b.product_name AS product_b,COUNT(DISTINCT a.order_id) AS orders_count FROM order_items a JOIN order_items b ON b.order_id=a.order_id AND b.product_id>a.product_id WHERE a.product_name='Hipoclorito' AND b.product_name='Barrilha' GROUP BY a.product_name,b.product_name").get();
if (recurringPair?.orders_count !== 2) throw new Error("Evidência de co-compra recorrente não foi preservada");
const recurringRoutePair = database.prepare("SELECT a.customer_id AS customer_a,b.customer_id AS customer_b,COUNT(DISTINCT a.route_id) AS routes_count FROM (SELECT DISTINCT s.route_id,o.customer_id FROM route_stops s JOIN orders o ON o.id=s.order_id) a JOIN (SELECT DISTINCT s.route_id,o.customer_id FROM route_stops s JOIN orders o ON o.id=s.order_id) b ON b.route_id=a.route_id AND b.customer_id>a.customer_id GROUP BY a.customer_id,b.customer_id HAVING COUNT(DISTINCT a.route_id)>1").get();
if (recurringRoutePair?.customer_a !== 1 || recurringRoutePair.customer_b !== 2 || recurringRoutePair.routes_count !== 2) throw new Error("Afinidade recorrente de clientes por rota não foi preservada");

database.prepare("UPDATE route_stops SET volume_m3=0 WHERE id=1").run();
const incompleteVolume = database.prepare("SELECT MIN(CASE WHEN volume_m3>0 THEN 1 ELSE 0 END) AS complete FROM route_stops WHERE route_id=1").get();
if (incompleteVolume?.complete !== 0) throw new Error("Cubagem incompleta não foi detectada");

const workday = database.prepare("SELECT p.gross_profit_cents AS profit_cents,(MAX(e.occurred_at)-MIN(e.occurred_at))/3600.0 AS hours,MAX(e.odometer_km)-MIN(e.odometer_km) AS km FROM profitability_entries p JOIN route_events e ON e.route_id=p.route_id WHERE p.route_id=1 AND e.event_type IN ('departure','return') GROUP BY p.route_id,p.gross_profit_cents").get();
if (workday?.profit_cents !== 50000 || workday.hours !== 8 || workday.km !== 120) throw new Error("Rentabilidade da jornada concluída não foi calculada corretamente");
const actualProfitPerKmCents = workday.km > 0 ? Math.round(workday.profit_cents / workday.km) : null;
if (actualProfitPerKmCents !== 417) throw new Error("Lucro real por quilômetro não foi calculado corretamente");
const actualCosts = database.prepare("SELECT SUM(delivery_cost_cents) AS cost_cents FROM profitability_entries WHERE route_id=1").get();
const completedDeliveries = database.prepare("SELECT COUNT(*) AS count FROM route_stops WHERE route_id=1 AND status='completed'").get().count;
const actualCostPerKmCents = workday.km > 0 ? Math.round(actualCosts.cost_cents / workday.km) : null;
const actualCostPerDeliveryCents = completedDeliveries > 0 ? Math.round(actualCosts.cost_cents / completedDeliveries) : null;
if (actualCostPerKmCents !== 167 || actualCostPerDeliveryCents !== 20000) throw new Error("Custos reais da jornada não foram calculados corretamente");

const tableCount = database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count;
console.log(JSON.stringify({ migrations: migrations.length, tables: tableCount, checked: Object.keys(requiredColumns), driverRouteLink: true, duplicateCpfRejected, effectiveOccupancy: 80, weeklyRevenueCents: salesWindows.week_revenue_cents, monthlyRevenueCents: salesWindows.month_revenue_cents, recurringProductPairOrders: recurringPair.orders_count, recurringCustomerRoutePairs: recurringRoutePair.routes_count, incompleteVolumeDetected: true, profitPerWorkdayCents: workday.profit_cents, actualProfitPerKmCents, actualCostPerKmCents, actualCostPerDeliveryCents, workdayHours: workday.hours, workdayKm: workday.km }));
