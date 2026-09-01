import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canValidate, getActor } from "../authz";

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canValidate(actor))
    return NextResponse.json(
      { error: "Somente direção ou gestores podem encerrar lotes" },
      { status: 403 },
    );
  const body = (await request.json()) as {
      id?: number;
      action?: string;
      expectedDocuments?: number;
      expectedPages?: number;
      reason?: string;
    },
    id = Number(body.id),
    db = getD1(),
    batch = await db
      .prepare("SELECT * FROM intake_batches WHERE id=?")
      .bind(id)
      .first<{
        id: number;
        code: string;
        expected_documents: number;
        expected_pages: number;
        received_documents: number;
        received_pages: number;
        divergences: string;
        status: string;
      }>();
  if (!batch)
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  if (batch.status !== "open")
    return NextResponse.json(
      { error: "O lote já foi encerrado" },
      { status: 409 },
    );
  const now = Math.floor(Date.now() / 1000);
  if (body.action === "reconcile") {
    const expectedDocuments = Number(body.expectedDocuments),
      expectedPages = Number(body.expectedPages),
      reason = String(body.reason || "").trim();
    if (
      !reason ||
      expectedDocuments < batch.received_documents ||
      expectedPages < batch.received_pages
    )
      return NextResponse.json(
        {
          error:
            "Informe a justificativa e quantidades compatíveis com o recebido",
        },
        { status: 400 },
      );
    await db
      .prepare(
        "UPDATE intake_batches SET expected_documents=?,expected_pages=?,divergences='',updated_at=? WHERE id=?",
      )
      .bind(expectedDocuments, expectedPages, now, id)
      .run();
    await db
      .prepare(
        "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'reconcile','intake_batch',?,?,?)",
      )
      .bind(
        actor.userId,
        String(id),
        JSON.stringify({ reason, expectedDocuments, expectedPages }),
        now,
      )
      .run();
    return NextResponse.json({ ok: true });
  }
  if (
    batch.received_documents < batch.expected_documents ||
    batch.received_pages < batch.expected_pages ||
    batch.divergences
  )
    return NextResponse.json(
      { error: "Confira quantidades e resolva divergências antes de encerrar" },
      { status: 409 },
    );
  const pending = await db
    .prepare(
      "SELECT COUNT(*) total FROM files WHERE batch_code=? AND status NOT IN ('validated','archived')",
    )
    .bind(batch.code)
    .first<{ total: number }>();
  if ((pending?.total ?? 0) > 0)
    return NextResponse.json(
      {
        error:
          "Todos os documentos do lote precisam estar validados antes do encerramento",
      },
      { status: 409 },
    );
  await db
    .prepare(
      "UPDATE intake_batches SET status='closed',updated_at=? WHERE id=?",
    )
    .bind(now, id)
    .run();
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'close','intake_batch',?,'Lote conferido e encerrado',?)",
    )
    .bind(actor.userId, String(id), now)
    .run();
  return NextResponse.json({ ok: true });
}
