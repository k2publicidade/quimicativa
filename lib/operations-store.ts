import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { getD1 } from "../db";
import { InputError, type OpsKind, type OpsRecord } from "./operations";

export type StoredRow = { id: number; module: string; title: string; status: string; metadata: string; updated_at: number };
export const MODULES: Record<OpsKind, string> = { employee: "Funcionários", vacation: "ops:vacation", basket: "ops:basket", ppe: "ops:ppe", ppeReview: "ops:ppeReview", stock: "ops:stock", movement: "ops:movement", preparation: "ops:preparation", crew: "ops:crew", report: "ops:report", collection: "ops:collection" };
export const HR_KINDS: OpsKind[] = ["employee", "vacation", "basket", "ppe", "ppeReview"];
// exec_sql detects SQL keywords before executing DO blocks. Hex-encode free text
// in those blocks so notes cannot be confused with SQL or a dollar delimiter.
export const encodedText = (value: string) => Buffer.from(value, "utf8").toString("hex");
export const serializeOps = (row: StoredRow): OpsRecord => {
  let data: Record<string, string> = {}; try { const parsed = JSON.parse(row.metadata || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed; } catch { /* legacy records */ }
  const legacyPpe = ["EPI", "Uniformes"].includes(row.module);
  if (legacyPpe) data = { ...data, _legacyModule: row.module, employeeName: data.employeeName || row.title, equipment: data.equipment || data.item || "A conferir", signed: data.signed || (row.module === "EPI" && row.status === "completed" ? "yes" : "no") };
  return { id: row.id, kind: legacyPpe ? "ppe" : (Object.keys(MODULES) as OpsKind[]).find(key => MODULES[key] === row.module)!, title: row.title, status: row.status, data, version: data._version || String(row.updated_at), updatedAt: row.updated_at };
};
export async function allOperations(db = getD1()): Promise<OpsRecord[]> {
  const rows = await db.prepare("SELECT id,module,title,status,metadata,updated_at FROM records WHERE (department='operacao' AND module LIKE 'ops:%') OR (department='rh' AND module IN ('Funcionários','EPI','Uniformes')) ORDER BY id DESC").all<StoredRow>();
  return rows.results.map(serializeOps).filter(row => row.kind);
}
export function insertOperation(db: D1Database, actorId: string, kind: OpsKind, title: string, data: Record<string, string>, status = "active", key?: string): D1PreparedStatement {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare("INSERT INTO records (source_key,department,module,title,metadata,status,priority,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'medium',?,?,?) ON CONFLICT (source_key) DO NOTHING RETURNING *")
    .bind(key || `ops:${kind}:${crypto.randomUUID()}`, kind === "employee" ? "rh" : "operacao", MODULES[kind], title, JSON.stringify({ ...data, _version: crypto.randomUUID() }), status, actorId, now, now);
}
export async function saveOperation(actorId: string, kind: OpsKind, title: string, data: Record<string, string>, status = "active", current?: OpsRecord, version?: unknown, key?: string, guards: D1PreparedStatement[] = []) {
  const db = getD1(), timestamp = Math.floor(Date.now() / 1000), newMetadata = JSON.stringify({ ...data, _version: crypto.randomUUID() }), sourceKey = key || `ops:${kind}:${crypto.randomUUID()}`;
  if (current && current.version !== version) throw new InputError("Este registro foi alterado por outra pessoa. Atualize a tela antes de salvar.", 409);
  let target = db.prepare("INSERT INTO records (source_key,department,module,title,metadata,status,priority,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'medium',?,?,?) ON CONFLICT (source_key) DO NOTHING RETURNING *").bind(sourceKey, kind === "employee" ? "rh" : "operacao", MODULES[kind], title, newMetadata, status, actorId, timestamp, timestamp);
  if (current) {
    const raw = await db.prepare("SELECT metadata,updated_at FROM records WHERE id=?").bind(current.id).first<{ metadata: string; updated_at: number }>();
    if (!raw || (JSON.parse(raw.metadata)._version || String(raw.updated_at)) !== current.version) throw new InputError("Registro alterado. Atualize a tela.", 409);
    target = db.prepare("UPDATE records SET source_key=COALESCE(?,source_key),title=?,metadata=?,status=?,department=?,module=?,updated_at=? WHERE id=? AND module=? AND metadata=? RETURNING *").bind(key || null, title, newMetadata, status, kind === "employee" ? "rh" : "operacao", MODULES[kind], timestamp, current.id, current.data._legacyModule || MODULES[kind], raw.metadata);
  }
  let result;
  try { result = await db.batch([...guards, target, db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) SELECT ?,?,'operation',CAST(id AS text),?,? FROM records WHERE module=? AND metadata=?").bind(actorId, current ? "update" : "create", JSON.stringify({ kind, title }), timestamp, MODULES[kind], newMetadata)]); }
  catch (error) { if (error instanceof Error && error.message.includes("duplicate key value violates unique constraint")) throw new InputError("Já existe um registro com essa identificação ou competência para o funcionário.", 409); throw error; }
  const row = result[guards.length].results[0] as StoredRow | undefined;
  if (!row) throw new InputError("Registro já cadastrado ou alterado por outra pessoa. Atualize a tela.", 409);
  return serializeOps(row);
}
