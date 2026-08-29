import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db";

type RecordRow = {
  id: number; department: string; module: string; title: string; description: string | null;
  status: string; priority: string; owner_id: string | null; due_date: number | null;
  amount_cents: number | null; created_at: number; updated_at: number;
};

function serialize(row: RecordRow) {
  return { id: row.id, department: row.department, module: row.module, title: row.title,
    description: row.description ?? "", status: row.status, priority: row.priority,
    ownerId: row.owner_id, dueDate: row.due_date ? new Date(row.due_date * 1000).toISOString().slice(0, 10) : "",
    amountCents: row.amount_cents ?? 0, createdAt: row.created_at, updatedAt: row.updated_at };
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
  if (!result.results.length) {
    const day = 86400;
    await db.batch([
      db.prepare("INSERT INTO records (department,module,title,description,status,priority,owner_id,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(department,module,`Revisão periódica — ${module}`,"Conferir documentação, responsáveis e próximos vencimentos.","pending","high",user.userId,now + 5 * day,now,now),
      db.prepare("INSERT INTO records (department,module,title,description,status,priority,owner_id,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(department,module,`Atualização cadastral — ${module}`,"Dados conferidos pela equipe responsável.","active","medium",user.userId,now + 15 * day,now,now),
      db.prepare("INSERT INTO records (department,module,title,description,status,priority,owner_id,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(department,module,`Controle mensal — ${module}`,"Acompanhamento concluído no período atual.","completed","low",user.userId,now - 2 * day,now,now),
    ]);
    result = await db.prepare("SELECT * FROM records WHERE department = ? AND module = ? ORDER BY updated_at DESC")
      .bind(department, module).all<RecordRow>();
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
  const inserted = await db.prepare("INSERT INTO records (department,module,title,description,status,priority,owner_id,due_date,amount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *")
    .bind(department,module,title,String(body.description ?? ""),String(body.status ?? "active"),String(body.priority ?? "medium"),user.userId,due,Number(body.amountCents ?? 0),now,now).first<RecordRow>();
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
  const updated = await db.prepare("UPDATE records SET title=?,description=?,status=?,priority=?,due_date=?,amount_cents=?,updated_at=? WHERE id=? RETURNING *")
    .bind(title,String(body.description ?? ""),String(body.status ?? "active"),String(body.priority ?? "medium"),due,Number(body.amountCents ?? 0),now,id).first<RecordRow>();
  if (!updated) return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 });
  await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','record',?,?,?)").bind(user.userId,String(id),title,now).run();
  return NextResponse.json({ record: serialize(updated) });
}
