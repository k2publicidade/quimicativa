import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canValidate, getActor } from "../authz";

type RecordRow = {
  id: number;
  department: string;
  module: string;
  title: string;
  description: string | null;
  metadata: string;
  status: string;
  priority: string;
  owner_id: string | null;
  due_date: number | null;
  amount_cents: number | null;
  created_at: number;
  updated_at: number;
};

// Chaves de metadados que identificam pessoa natural ou contato (LGPD art. 5).
const PERSONAL_KEYS = new Set([
  "nome",
  "name",
  "cliente",
  "colaborador",
  "funcionario",
  "empregado",
  "contratado",
  "contact",
  "contato",
  "contactName",
  "contactEmail",
  "contactPhone",
  "email",
  "telefone",
  "whatsapp",
  "cpf",
  "cnpj",
  "rg",
  "document",
  "endereco",
  "address",
  "cidade",
  "city",
  "cep",
  "responsavel",
  "candidato",
]);

const ANONYMIZED = "[anonimizado]";

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canValidate(actor))
    return NextResponse.json(
      { error: "Somente direção ou gestores podem anonimizar registros" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    id = Number(body.recordId),
    reason = String(body.reason || "").trim();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Registro inválido" }, { status: 400 });
  if (!reason)
    return NextResponse.json(
      {
        error:
          "Informe o motivo da anonimização (ex.: solicitação do titular, art. 18 da LGPD)",
      },
      { status: 400 },
    );
  const db = getD1(),
    current = await db
      .prepare("SELECT * FROM records WHERE id=?")
      .bind(id)
      .first<RecordRow>();
  if (!current)
    return NextResponse.json(
      { error: "Registro não encontrado" },
      { status: 404 },
    );
  if (current.title.startsWith("Registro anonimizado"))
    return NextResponse.json(
      { error: "Este registro já foi anonimizado" },
      { status: 409 },
    );
  const metadata: Record<string, string> = {};
  try {
    const parsed = JSON.parse(current.metadata || "{}");
    if (parsed && typeof parsed === "object")
      for (const [key, value] of Object.entries(parsed))
        if (!PERSONAL_KEYS.has(key)) metadata[key] = String(value);
  } catch {
    // metadados ilegíveis são descartados na anonimização
  }
  if (metadata.lgpdBasis) metadata.anonymizadoEm = "solicitação do titular";
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        "UPDATE records SET title=?,description=?,metadata=?,status='archived',updated_at=? WHERE id=? RETURNING *",
      )
      .bind(
        `Registro anonimizado (ID ${id})`,
        "Dados pessoais removidos por solicitação (LGPD, art. 18).",
        JSON.stringify(metadata),
        now,
        id,
      )
      .first<RecordRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível anonimizar o registro" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'anonymize','record',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        reason,
        department: current.department,
        module: current.module,
        previousTitle: current.title,
      }),
      now,
    )
    .run();
  return NextResponse.json({
    ok: true,
    message:
      "Registro anonimizado. O histórico de negócio foi preservado sem os dados pessoais.",
  });
}
