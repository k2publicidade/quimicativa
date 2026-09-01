import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type LotRow = {
  id: number;
  product_id: number;
  lot_number: string;
  manufacture_date: number | null;
  expiry_date: number | null;
  quantity: number;
  unit: string;
  location: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  product_name?: string;
};

const serialize = (row: LotRow) => ({
  id: row.id,
  productId: row.product_id,
  productName: row.product_name ?? "",
  lotNumber: row.lot_number,
  manufactureDate: row.manufacture_date
    ? new Date(row.manufacture_date * 1000).toISOString().slice(0, 10)
    : "",
  expiryDate: row.expiry_date
    ? new Date(row.expiry_date * 1000).toISOString().slice(0, 10)
    : "",
  quantity: row.quantity,
  unit: row.unit,
  location: row.location ?? "",
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const dateToEpoch = (value: unknown): number | null => {
  if (!value) return null;
  const epoch = Math.floor(new Date(String(value)).getTime() / 1000);
  return Number.isFinite(epoch) ? epoch : null;
};

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(),
    productId = Number(request.nextUrl.searchParams.get("productId")),
    suggestId = Number(request.nextUrl.searchParams.get("suggest"));
  if (Number.isInteger(suggestId) && suggestId > 0) {
    const now = Math.floor(Date.now() / 1000);
    const rows = await db
      .prepare(
        "SELECT * FROM lots WHERE product_id=? AND quantity>0 AND expiry_date>=? ORDER BY expiry_date ASC, lot_number ASC",
      )
      .bind(suggestId, now)
      .all<LotRow>();
    return NextResponse.json({ suggestion: rows.results.map(serialize) });
  }
  const base =
    Number.isInteger(productId) && productId > 0
      ? " WHERE l.product_id=?"
      : "";
  const result = await db
    .prepare(
      `SELECT l.*,p.name AS product_name FROM lots l JOIN products p ON p.id=l.product_id${base} ORDER BY l.expiry_date ASC,l.lot_number ASC`,
    )
    .bind(...(base ? [productId] : []))
    .all<LotRow>();
  const now = Math.floor(Date.now() / 1000),
    day = 86400,
    today = Math.floor(now / day) * day;
  const lots = result.results.map(serialize),
    expired = lots.filter((lot) => lot.expiryDate && lot.expiryDate < new Date(today * 1000).toISOString().slice(0, 10)).length,
    expiringSoon = lots.filter(
      (lot) =>
        lot.expiryDate &&
        !lot.expiryDate.startsWith("19") &&
        new Date(lot.expiryDate).getTime() / 1000 >= today &&
        new Date(lot.expiryDate).getTime() / 1000 <= today + 30 * day,
    ).length;
  return NextResponse.json({
    lots,
    summary: {
      total: lots.length,
      expired,
      expiringSoon,
      totalQuantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
    },
  });
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    productId = Number(body.productId),
    lotNumber = String(body.lotNumber || "").trim(),
    quantity = Math.max(0, Number(body.quantity) || 0),
    unit = String(body.unit || "un").trim(),
    expiryDate = dateToEpoch(body.expiryDate),
    now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(productId) || productId <= 0 || !lotNumber)
    return NextResponse.json(
      { error: "Informe o produto e o número do lote" },
      { status: 400 },
    );
  if (expiryDate && expiryDate < now - 2 * 86400)
    return NextResponse.json(
      { error: "A validade informada já passou. Confira a data." },
      { status: 400 },
    );
  const db = getD1(),
    product = await db
      .prepare("SELECT id FROM products WHERE id=?")
      .bind(productId)
      .first();
  if (!product)
    return NextResponse.json(
      { error: "Produto não encontrado" },
      { status: 404 },
    );
  const duplicate = await db
    .prepare("SELECT id FROM lots WHERE product_id=? AND lot_number=?")
    .bind(productId, lotNumber)
    .first();
  if (duplicate)
    return NextResponse.json(
      { error: "Já existe um lote com esse número para este produto" },
      { status: 409 },
    );
  const created = await db
    .prepare(
      "INSERT INTO lots (product_id,lot_number,manufacture_date,expiry_date,quantity,unit,location,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *",
    )
    .bind(
      productId,
      lotNumber,
      dateToEpoch(body.manufactureDate),
      expiryDate,
      quantity,
      unit,
      String(body.location || ""),
      String(body.notes || ""),
      actor.userId,
      now,
      now,
    )
    .first<LotRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível cadastrar o lote" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','lot',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ productId, lotNumber, quantity, unit }),
      now,
    )
    .run();
  return NextResponse.json({ lot: serialize(created) }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    id = Number(body.id),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Lote inválido" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM lots WHERE id=?")
    .bind(id)
    .first<LotRow>();
  if (!current)
    return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
  const quantity = Math.max(0, Number(body.quantity) ?? current.quantity),
    expiryDate = dateToEpoch(body.expiryDate) ?? current.expiry_date,
    now = Math.floor(Date.now() / 1000);
  if (expiryDate && expiryDate < now - 2 * 86400)
    return NextResponse.json(
      { error: "A validade informada já passou. Confira a data." },
      { status: 400 },
    );
  const updated = await db
    .prepare(
      "UPDATE lots SET manufacture_date=?,expiry_date=?,quantity=?,unit=?,location=?,notes=?,updated_at=? WHERE id=? RETURNING *",
    )
    .bind(
      dateToEpoch(body.manufactureDate) ?? current.manufacture_date,
      expiryDate,
      quantity,
      String(body.unit || current.unit),
      String(body.location ?? current.location ?? ""),
      String(body.notes ?? current.notes ?? ""),
      now,
      id,
    )
    .first<LotRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o lote" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','lot',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        before: { quantity: current.quantity, expiryDate: current.expiry_date },
        after: { quantity: updated.quantity, expiryDate: updated.expiry_date },
      }),
      now,
    )
    .run();
  return NextResponse.json({ lot: serialize(updated) });
}
