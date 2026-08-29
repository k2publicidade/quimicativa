import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db";
import { getModuleConfig } from "../../module-config";

type RecordRow = {
  id: number; department: string; module: string; title: string; description: string | null;
  metadata: string;
  status: string; priority: string; owner_id: string | null; due_date: number | null;
  amount_cents: number | null; created_at: number; updated_at: number;
};

function serialize(row: RecordRow) {
  return { id: row.id, department: row.department, module: row.module, title: row.title,
    description: row.description ?? "", status: row.status, priority: row.priority,
    ownerId: row.owner_id, dueDate: row.due_date ? new Date(row.due_date * 1000).toISOString().slice(0, 10) : "",
    amountCents: row.amount_cents ?? 0, metadata: safeMetadata(row.metadata), createdAt: row.created_at, updatedAt: row.updated_at };
}

function safeMetadata(value:string|null):Record<string,string>{
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

async function viewer() {
  const user = await getChatGPTUser();
  return user;
}

export async function GET(request: NextRequest) {
  const user = await viewer();
  if (!user) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const department = request.nextUrl.searchParams.get("department")?.trim();
  const module = request.nextUrl.searchParams.get("module")?.trim();
  if (!department || !module) return NextResponse.json({ error: "Setor e módulo são obrigatórios" }, { status: 400 });
  const db = getD1();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, 'ceo', ?)")
    .bind(user.userId, user.email, user.displayName, now).run();
  let result = await db.prepare("SELECT * FROM records WHERE department = ? AND module = ? ORDER BY updated_at DESC")
    .bind(department, module).all<RecordRow>();
  const config = getModuleConfig(module);
  if (!result.results.length) {
    const day = 86400;
    await db.batch([
      ...config.samples.slice(0,3).map((title,index)=>db.prepare("INSERT INTO records (department,module,title,description,metadata,status,priority,owner_id,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(department,module,title,config.guidance,JSON.stringify(Object.fromEntries(config.fields.map(field=>[field.key,field.samples[index]??""]))),config.statuses[index]?.value??"active",index===0?"high":index===1?"medium":"low",user.userId,index===2?now-2*day:now+(5+index*10)*day,now,now)),
    ]);
    result = await db.prepare("SELECT * FROM records WHERE department = ? AND module = ? ORDER BY updated_at DESC")
      .bind(department, module).all<RecordRow>();
  }
  const unenriched = result.results.filter(row=>Object.keys(safeMetadata(row.metadata)).length===0);
  if (unenriched.length) {
    await db.batch(unenriched.map((row,index)=>db.prepare("UPDATE records SET title=?, description=?, metadata=?, updated_at=? WHERE id=?").bind(config.samples[index%config.samples.length],config.guidance,JSON.stringify(Object.fromEntries(config.fields.map(field=>[field.key,field.samples[index%field.samples.length]??""]))),now,row.id)));
    result = await db.prepare("SELECT * FROM records WHERE department = ? AND module = ? ORDER BY updated_at DESC").bind(department,module).all<RecordRow>();
  }
  return NextResponse.json({ records: result.results.map(serialize) });
}

export async function POST(request: NextRequest) {
  const user = await viewer();
  if (!user) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const department = String(body.department ?? "").trim(), module = String(body.module ?? "").trim(), title = String(body.title ?? "").trim();
  if (!department || !module || !title) return NextResponse.json({ error: "Preencha setor, módulo e título" }, { status: 400 });
  const now = Math.floor(Date.now() / 1000), due = body.dueDate ? Math.floor(new Date(String(body.dueDate)).getTime() / 1000) : null;
  const db = getD1();
  await db.prepare("INSERT OR IGNORE INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, 'ceo', ?)").bind(user.userId,user.email,user.displayName,now).run();
  const inserted = await db.prepare("INSERT INTO records (department,module,title,description,metadata,status,priority,owner_id,due_date,amount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *")
    .bind(department,module,title,String(body.description ?? ""),JSON.stringify(body.metadata??{}),String(body.status ?? "active"),String(body.priority ?? "medium"),user.userId,due,Number(body.amountCents ?? 0),now,now).first<RecordRow>();
  if (!inserted) return NextResponse.json({ error: "Não foi possível salvar" }, { status: 500 });
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','record',?,?,?)").bind(user.userId,String(inserted.id),title,now).run();
  return NextResponse.json({ record: serialize(inserted) }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const user = await viewer();
  if (!user) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>, id = Number(body.id), title = String(body.title ?? "").trim();
  if (!Number.isInteger(id) || !title) return NextResponse.json({ error: "Registro inválido" }, { status: 400 });
  const due = body.dueDate ? Math.floor(new Date(String(body.dueDate)).getTime() / 1000) : null, now = Math.floor(Date.now() / 1000), db = getD1();
  const updated = await db.prepare("UPDATE records SET title=?,description=?,metadata=?,status=?,priority=?,due_date=?,amount_cents=?,updated_at=? WHERE id=? RETURNING *")
    .bind(title,String(body.description ?? ""),JSON.stringify(body.metadata??{}),String(body.status ?? "active"),String(body.priority ?? "medium"),due,Number(body.amountCents ?? 0),now,id).first<RecordRow>();
  if (!updated) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','record',?,?,?)").bind(user.userId,String(id),title,now).run();
  return NextResponse.json({ record: serialize(updated) });
}
