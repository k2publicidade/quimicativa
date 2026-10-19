import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canValidate, canWrite, getActor } from "../authz";
import { addMonths, bombonaDebt, count, InputError, localDay, normalizeName, overlaps, positiveId, PPE_TYPES, STOCK_TYPES, TEAM, textValue, validDate, validatePreparation, validateVacation, type OpsKind, type OpsRecord } from "../../../lib/operations";
import { allOperations, encodedText, HR_KINDS, insertOperation, MODULES, saveOperation, serializeOps, type StoredRow } from "../../../lib/operations-store";

const fail = (error: unknown) => {
  if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message.includes("OPS_CONFLICT")) return NextResponse.json({ error: "A rota foi alterada. Atualize a tela e tente novamente." }, { status: 409 });
  if (error instanceof Error && error.message.includes("OPS_VACATION")) return NextResponse.json({ error: "Este funcionário já possui férias nesse período." }, { status: 409 });
  if (error instanceof Error && error.message.includes("OPS_CREW")) return NextResponse.json({ error: "Um dos ajudantes já está escalado em outra rota nesta data." }, { status: 409 });
  console.error("operations", error instanceof Error ? error.message : "Erro inesperado");
  return NextResponse.json({ error: "Não foi possível concluir a operação. Atualize a tela e tente novamente." }, { status: 500 });
};
function find(rows: OpsRecord[], id: unknown, kind: OpsKind) {
  const row = rows.find(row => row.id === positiveId(id) && row.kind === kind);
  if (!row) throw new InputError("Registro não encontrado.", 404); return row;
}
function activeEmployee(rows: OpsRecord[], id: unknown) {
  const row = find(rows, id, "employee");
  if (["archived", "leave"].includes(row.status)) throw new InputError("Funcionário desligado ou afastado."); return row;
}
function guardRoute(routeId: number, version: number) {
  return getD1().prepare(`DO $route_guard$ DECLARE current_version bigint; BEGIN
    SELECT updated_at INTO current_version FROM routes WHERE id=? FOR UPDATE;
    IF current_version IS DISTINCT FROM ? THEN RAISE EXCEPTION 'OPS_CONFLICT'; END IF;
    UPDATE routes SET updated_at=? WHERE id=?;
  END $route_guard$`).bind(routeId, version, Math.max(Math.floor(Date.now() / 1000), version + 1), routeId);
}

// The existing RPC wraps row-returning queries in a CTE. Use a DO block for
// multiple writes so locking, balance and history commit in one transaction.
async function appendWithParent(actorId: string, parent: OpsRecord, next: Record<string, string>, kind: OpsKind, title: string, data: Record<string, string>, status = "active", key?: string) {
  const db = getD1(), now = Math.floor(Date.now() / 1000), sourceKey = key || `ops:${kind}:${crypto.randomUUID()}`, blockTag = `$ops_${crypto.randomUUID().replaceAll("-", "")}$`;
  const original = await db.prepare("SELECT metadata FROM records WHERE id=?").bind(parent.id).first<{ metadata: string }>();
  if (!original || serializeOps({ id: parent.id, module: MODULES[parent.kind], title: parent.title, status: parent.status, metadata: original.metadata, updated_at: parent.updatedAt }).version !== parent.version) throw new InputError("Registro alterado. Atualize a tela.", 409);
  try {
    await db.prepare(`DO ${blockTag} DECLARE previous text; BEGIN
      SELECT metadata INTO previous FROM records WHERE id=? FOR UPDATE;
      IF previous IS DISTINCT FROM convert_from(decode(?,'hex'),'UTF8') THEN RAISE EXCEPTION 'OPS_CONFLICT'; END IF;
      UPDATE records SET metadata=convert_from(decode(?,'hex'),'UTF8'),updated_at=? WHERE id=?;
      INSERT INTO records (source_key,department,module,title,metadata,status,priority,owner_id,created_at,updated_at) VALUES (?,?,?,convert_from(decode(?,'hex'),'UTF8'),convert_from(decode(?,'hex'),'UTF8'),?,'medium',?,?,?);
      INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) SELECT ?,'create','operation',CAST(id AS text),convert_from(decode(?,'hex'),'UTF8'),? FROM records WHERE source_key=?;
    END ${blockTag}`).bind(parent.id, encodedText(original.metadata), encodedText(JSON.stringify({ ...next, _version: crypto.randomUUID() })), now, parent.id,
      sourceKey, "operacao", MODULES[kind], encodedText(title), encodedText(JSON.stringify({ ...data, _version: crypto.randomUUID() })), status, actorId, now, now, actorId, encodedText(JSON.stringify({ kind, title })), now, sourceKey).run();
  } catch (error) { if (error instanceof Error && error.message.includes("OPS_CONFLICT")) throw new InputError("O saldo ou o cadastro mudou. Atualize a tela e tente novamente.", 409); throw error; }
  const result = await db.prepare("SELECT * FROM records WHERE source_key=?").bind(sourceKey).first<StoredRow>();
  if (!result) throw new InputError("Não foi possível confirmar a operação.", 500);
  return serializeOps(result);
}

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const hr = request.nextUrl.searchParams.get("scope") === "rh";
  if (hr && !canValidate(actor)) return NextResponse.json({ error: "A gestão de RH exige perfil de gerente ou direção." }, { status: 403 });
  try {
    const rows = await allOperations();
    const records = hr ? rows.filter(row => HR_KINDS.includes(row.kind)) : rows.filter(row => !HR_KINDS.includes(row.kind) || row.kind === "employee").map(row => row.kind === "employee" ? { ...row, data: Object.fromEntries(Object.entries(row.data).filter(([key]) => ["role", "department", "nickname"].includes(key))) } : row);
    return NextResponse.json({ records, debts: hr ? [] : bombonaDebt(rows) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = textValue(body.action, "Operação"), db = getD1();
    const hrActions = ["bootstrap", "employee", "vacation", "basket", "ppe", "ppeReview"];
    if (hrActions.includes(action) && !canValidate(actor)) return NextResponse.json({ error: "Somente gerentes e direção podem alterar o RH." }, { status: 403 });
    const rows = await allOperations();
    const data = (body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {}) as Record<string, unknown>;
    const current = body.id ? find(rows, body.id, action as OpsKind) : undefined;
    let saved: OpsRecord | undefined;

    if (action === "bootstrap") {
      const drivers = await db.prepare("SELECT id,name FROM drivers").all<{ id: number; name: string }>();
      const statements = [db.prepare("SELECT pg_advisory_xact_lock(1801019)")];
      for (const person of TEAM) {
        const matches = (name: string) => { const normalized = normalizeName(name); return normalized === normalizeName(person.name) || normalized.startsWith(`${normalizeName(person.name)} `) || Boolean(person.nickname && normalized.includes(normalizeName(person.nickname))); };
        const existing = rows.find(row => row.kind === "employee" && matches(row.title));
        if (!existing) statements.push(insertOperation(db, actor.userId, "employee", person.name, { role: person.role, department: person.department, nickname: person.nickname }, "active", `ops:employee:${normalizeName(person.name)}`));
        else if (person.name === "Francisco" && !existing.data.role?.includes("Gerente geral")) {
          statements.push(db.prepare("UPDATE records SET metadata=?,updated_at=? WHERE id=? AND CAST(metadata AS jsonb)=CAST(? AS jsonb) RETURNING *").bind(JSON.stringify({ ...existing.data, role: person.role, department: person.department, _version: crypto.randomUUID() }), Math.floor(Date.now() / 1000), existing.id, JSON.stringify(existing.data)));
        }
        if (person.role === "Motorista" && !drivers.results.some(driver => matches(driver.name))) statements.push(db.prepare("INSERT INTO drivers (name,status,notes,created_by,created_at,updated_at) SELECT ?,'active',?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM drivers WHERE name=?)").bind(`${person.name} (${person.nickname})`, "Conferir CNH e MOPP antes da escala.", actor.userId, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), `${person.name} (${person.nickname})`));
      }
      if (statements.length) await db.batch(statements);
      return NextResponse.json({ message: "Equipe cadastrada. Confira dados contratuais, CNH e MOPP nos cadastros." });
    }
    if (action === "employee") {
      const title = textValue(data.name, "Nome", true, 150), status = textValue(data.status, "Situação");
      if (rows.some(row => row.kind === "employee" && row.id !== current?.id && normalizeName(row.title) === normalizeName(title))) throw new InputError("Já existe um funcionário com esse nome.", 409);
      if (!["active", "vacation", "leave", "archived"].includes(status)) throw new InputError("Situação inválida.");
      const metadata = { ...(current?.data || {}), nickname: textValue(data.nickname, "Apelido", false, 100), role: textValue(data.role, "Cargo", true, 150), department: textValue(data.department, "Setor", true, 150), admissionDate: data.admissionDate ? validDate(data.admissionDate, "Admissão") : "", contractType: textValue(data.contractType, "Vínculo", false, 100), notes: textValue(data.notes, "Observações", false) };
      saved = await saveOperation(actor.userId, "employee", title, metadata, status, current, body.version, `ops:employee:${normalizeName(title)}`);
    } else if (action === "vacation") {
      const clean = validateVacation(data), employee = activeEmployee(rows, clean.employeeId);
      if (clean.status !== "cancelled" && rows.some(row => row.kind === "vacation" && row.id !== current?.id && row.data.employeeId === clean.employeeId && row.status !== "cancelled" && overlaps(clean.start, clean.end, row.data.start, row.data.end))) throw new InputError("Este funcionário já possui férias nesse período.", 409);
      const detail = { ...clean, employeeName: employee.title };
      const overlapGuard = db.prepare(`DO $vacation_guard$ BEGIN
        PERFORM id FROM records WHERE id=? FOR UPDATE;
        IF ?<>'cancelled' AND EXISTS (SELECT 1 FROM records WHERE module='ops:vacation' AND status<>'cancelled' AND id<>? AND CAST(metadata AS jsonb)->>'employeeId'=? AND CAST(metadata AS jsonb)->>'start'<=? AND CAST(metadata AS jsonb)->>'end'>=?)
        THEN RAISE EXCEPTION 'OPS_VACATION'; END IF;
      END $vacation_guard$`).bind(employee.id, clean.status, current?.id || 0, clean.employeeId, clean.end, clean.start);
      saved = await saveOperation(actor.userId, "vacation", employee.title, detail, clean.status, current, body.version, undefined, [overlapGuard]);
    } else if (action === "basket") {
      const employee = activeEmployee(rows, data.employeeId), month = textValue(data.month, "Competência", true, 7);
      validDate(`${month}-01`, "Competência");
      const status = textValue(data.status, "Situação"); if (!["pending", "delivered"].includes(status)) throw new InputError("Situação inválida.");
      const deliveredDate = status === "delivered" ? validDate(data.deliveredDate, "Entrega") : "";
      if (deliveredDate > localDay()) throw new InputError("A entrega não pode estar no futuro.");
      saved = await saveOperation(actor.userId, "basket", employee.title, { employeeId: String(employee.id), employeeName: employee.title, month, deliveredDate, receivedBy: textValue(data.receivedBy, "Recebedor", status === "delivered", 150), notes: textValue(data.notes, "Observações", false) }, status, current, body.version, `ops:basket:${employee.id}:${month}`);
    } else if (action === "ppe") {
      const employee = activeEmployee(rows, data.employeeId), equipment = textValue(data.equipment, "Equipamento"), deliveryDate = validDate(data.deliveryDate, "Entrega"), quantity = count(data.quantity, "Quantidade"), signed = data.signed === "yes";
      if (!PPE_TYPES.includes(equipment as typeof PPE_TYPES[number]) || !quantity) throw new InputError("Selecione o equipamento e informe uma quantidade positiva.");
      if (deliveryDate > localDay()) throw new InputError("A entrega não pode estar no futuro.");
      saved = await saveOperation(actor.userId, "ppe", `${employee.title} — ${equipment}`, { employeeId: String(employee.id), employeeName: employee.title, equipment, quantity: String(quantity), ca: textValue(data.ca, "CA", false, 100), size: textValue(data.size, "Tamanho", false, 50), deliveryDate, nextReview: addMonths(deliveryDate, 3), signed: signed ? "yes" : "no", receivedBy: textValue(data.receivedBy, "Responsável pelo aceite", signed, 150), notes: textValue(data.notes, "Observações", false) }, signed ? "signed" : "pending", current, body.version);
    } else if (action === "ppeReview") {
      const employee = activeEmployee(rows, data.employeeId), reviewDate = validDate(data.reviewDate, "Revisão");
      if (reviewDate > localDay()) throw new InputError("A revisão não pode estar no futuro.");
      const condition = textValue(data.condition, "Condição"); if (!["ok", "replace"].includes(condition)) throw new InputError("Condição inválida.");
      const detail: Record<string, string> = { employeeId: String(employee.id), employeeName: employee.title, reviewDate, nextReview: addMonths(reviewDate, 3), condition, reviewer: textValue(data.reviewer, "Responsável", true, 150), notes: textValue(data.notes, "Observações", condition === "replace") };
      for (const item of PPE_TYPES) { const condition = textValue(data[item], item); if (!["ok", "replace", "na"].includes(condition)) throw new InputError(`Confira ${item}.`); detail[item] = condition; }
      if (PPE_TYPES.some(item => detail[item] === "replace") && detail.condition !== "replace") throw new InputError("Há item para reposição. Marque a revisão como reposição necessária.");
      saved = await saveOperation(actor.userId, "ppeReview", employee.title, detail, condition);
    } else if (action === "stock") {
      const category = textValue(data.category, "Categoria"), variant = textValue(data.variant, "Tipo / tamanho", ["Bomba", "Mangote"].includes(category), 150);
      if (!STOCK_TYPES.includes(category as typeof STOCK_TYPES[number])) throw new InputError("Categoria inválida.");
      saved = await saveOperation(actor.userId, "stock", `${category}${variant ? ` — ${variant}` : ""}`, { category, variant, quantity: "0", counted: "no", minimum: String(count(data.minimum ?? 0, "Estoque mínimo")) }, "active", undefined, undefined, `ops:stock:${normalizeName(category)}:${normalizeName(variant)}`);
    } else if (action === "movement") {
      const stock = find(rows, data.stockId, "stock"), quantity = count(data.quantity, "Quantidade"), movementType = textValue(data.type, "Movimentação"), reason = textValue(data.reason, "Motivo");
      if (!["in", "out", "count"].includes(movementType) || (!quantity && movementType !== "count")) throw new InputError("Movimentação inválida.");
      if (body.version !== stock.version) throw new InputError("O saldo mudou. Atualize a tela.", 409);
      if (stock.data.counted !== "yes" && movementType !== "count") throw new InputError("Registre a contagem inicial antes de movimentar.");
      const before = Number(stock.data.quantity || 0), after = movementType === "count" ? quantity : before + (movementType === "in" ? quantity : -quantity);
      if (after < 0) throw new InputError("Saldo insuficiente no galpão.", 409);
      saved = await appendWithParent(actor.userId, stock, { ...stock.data, quantity: String(after), counted: "yes" }, "movement", stock.title, { stockId: String(stock.id), type: movementType, quantity: String(quantity), before: String(before), after: String(after), reason, date: localDay(), responsible: actor.displayName });
    } else if (action === "preparation") {
      const clean = validatePreparation(data), order = await db.prepare("SELECT id,status FROM orders WHERE id=?").bind(Number(clean.orderId)).first<{ id: number; status: string }>();
      if (!order || order.status === "cancelled") throw new InputError("Pedido não encontrado ou cancelado.");
      const previous = rows.find(row => row.kind === "preparation" && row.data.orderId === clean.orderId);
      saved = await saveOperation(actor.userId, "preparation", `Preparação do pedido ${clean.orderId}`, { ...clean, responsible: actor.displayName }, clean.status, previous, body.version, `ops:preparation:${clean.orderId}`);
    } else if (action === "crew") {
      const routeId = positiveId(data.routeId), route = await db.prepare("SELECT id,status,driver_name,route_date,updated_at FROM routes WHERE id=?").bind(routeId).first<{ id: number; status: string; driver_name: string; route_date: number; updated_at: number }>();
      if (!route || route.status !== "draft") throw new InputError("A equipe só pode ser escalada antes da saída.", 409);
      const helpers = textValue(data.helperIds, "Ajudantes", false, 200).split(",").filter(Boolean).map(Number);
      if (new Set(helpers).size !== helpers.length) throw new InputError("Ajudante duplicado.");
      const routeDay = new Date(route.route_date * 1000).toISOString().slice(0, 10);
      const names = helpers.map(id => { const employee = activeEmployee(rows, id); if (!/ajudante/i.test(employee.data.role) || employee.status !== "active") throw new InputError("Selecione ajudantes ativos."); if (rows.some(row => row.kind === "vacation" && row.status === "approved" && row.data.employeeId === String(id) && overlaps(routeDay, routeDay, row.data.start, row.data.end))) throw new InputError(`${employee.title} está em férias na data da rota.`); return employee.title; });
      const previous = rows.find(row => row.kind === "crew" && row.data.routeId === String(routeId));
      const dayStart = Math.floor(Date.parse(`${routeDay}T00:00:00Z`) / 1000);
      const assignmentGuard = db.prepare(`DO $crew_guard$ BEGIN
        IF EXISTS (SELECT 1 FROM records c JOIN routes r ON r.id=CAST(CAST(c.metadata AS jsonb)->>'routeId' AS bigint)
          WHERE c.module='ops:crew' AND r.id<>? AND r.status IN ('draft','active') AND r.route_date>=? AND r.route_date<?
          AND string_to_array(CAST(c.metadata AS jsonb)->>'helperIds',',') && string_to_array(?,','))
        THEN RAISE EXCEPTION 'OPS_CREW'; END IF;
      END $crew_guard$`).bind(routeId, dayStart, dayStart + 86400, helpers.join(","));
      saved = await saveOperation(actor.userId, "crew", `Equipe — ${route.driver_name}`, { routeId: String(routeId), routeDate: routeDay, helperIds: helpers.join(","), helpers: names.join(", "), driverName: route.driver_name }, "active", previous, body.version, `ops:crew:${routeId}`, [db.prepare("SELECT pg_advisory_xact_lock(1801020)"), guardRoute(routeId, route.updated_at), assignmentGuard]);
    } else if (action === "report") {
      const stopId = positiveId(data.stopId), stop = await db.prepare("SELECT s.*,s.status AS stop_status,o.customer_id,o.number AS order_number,c.company_name,r.status AS route_status,r.updated_at AS route_version FROM route_stops s JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id JOIN routes r ON r.id=s.route_id WHERE s.id=?").bind(stopId).first<{ id: number; order_id: number; route_id: number; customer_id: number; order_number: string; company_name: string; route_status: string; route_version: number; stop_status: string }>();
      const previous = rows.find(row => row.kind === "report" && row.data.stopId === String(stopId));
      if (!stop || (stop.route_status !== "active" && !(stop.route_status === "completed" && previous))) throw new InputError("Registre o retorno dos pedidos durante a jornada ativa.", 409);
      const outcome = textValue(data.outcome, "Resultado"); if (!["completed", "partial", "failed"].includes(outcome)) throw new InputError("Resultado inválido.");
      const bombonasSent = count(data.bombonasSent, "Bombonas que deveriam retornar"), bombonasReturned = count(data.bombonasReturned, "Bombonas devolvidas");
      if (bombonasReturned > bombonasSent) throw new InputError("Para recolher dívidas anteriores, use a baixa de bombonas por pedido.");
      if (previous && ["completed", "failed"].includes(stop.stop_status) && (outcome !== previous.data.outcome || bombonasSent !== Number(previous.data.bombonasSent) || bombonasReturned !== Number(previous.data.bombonasReturned))) throw new InputError("A parada já foi encerrada. Mantenha resultado e quantidades; registre novos recolhimentos na baixa de bombonas.", 409);
      if (bombonasSent - bombonasReturned < Number(previous?.data.collected || 0)) throw new InputError("Já existem recolhimentos registrados para esta dívida.", 409);
      const signed = data.signed === "yes", receiptId = data.receiptId ? positiveId(data.receiptId) : 0;
      if (signed) { const receipt = await db.prepare("SELECT id FROM order_documents WHERE id=? AND order_id=? AND kind='canhoto' AND status='active'").bind(receiptId, stop.order_id).first(); if (!receipt) throw new InputError("Anexe o canhoto assinado deste pedido."); }
      saved = await saveOperation(actor.userId, "report", `${stop.order_number} — ${stop.company_name}`, { stopId: String(stopId), routeId: String(stop.route_id), orderId: String(stop.order_id), orderNumber: stop.order_number, customerId: String(stop.customer_id), customerName: stop.company_name, orderDescription: textValue(data.orderDescription, "Descrição do pedido"), returnDescription: textValue(data.returnDescription, "Relatório do motorista"), deliveryNotes: textValue(data.deliveryNotes, "Observações da entrega", false), outcome, bombonasSent: String(bombonasSent), bombonasReturned: String(bombonasReturned), collected: previous?.data.collected || "0", signed: signed ? "yes" : "no", receiptId: receiptId ? String(receiptId) : "", receiver: textValue(data.receiver, "Recebedor", signed, 150), unsignedReason: textValue(data.unsignedReason, "Motivo do canhoto pendente", !signed), reportedBy: actor.displayName, reportedAt: new Date().toISOString() }, outcome, previous, body.version, `ops:report:${stopId}`, [guardRoute(stop.route_id, stop.route_version)]);
    } else if (action === "collection") {
      const report = find(rows, data.reportId, "report"), quantity = count(data.quantity, "Bombonas recolhidas"), debt = bombonaDebt(rows).find(row => row.reportId === report.id);
      if (!quantity || !debt || quantity > debt.balance) throw new InputError("Quantidade maior que a dívida pendente ou dívida já quitada.", 409);
      if (body.version !== report.version) throw new InputError("A dívida mudou. Atualize a tela.", 409);
      const date = validDate(data.date, "Recolhimento"); if (date > localDay()) throw new InputError("O recolhimento não pode estar no futuro.");
      saved = await appendWithParent(actor.userId, report, { ...report.data, collected: String(Number(report.data.collected || 0) + quantity) }, "collection", report.title, { reportId: String(report.id), quantity: String(quantity), date, responsible: actor.displayName, notes: textValue(data.notes, "Comprovante / observações") });
    } else { throw new InputError("Operação desconhecida."); }
    return NextResponse.json({ record: saved }, { status: current ? 200 : 201 });
  } catch (error) { return fail(error); }
}
