import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type ProductRow = {
  id: number;
  name: string;
  category: string;
  concentration: string | null;
  un_number: string | null;
  hazard_class: string | null;
  signal_word: string | null;
  h_phrases: string;
  p_phrases: string;
  controlled: number;
  control_agency: string | null;
  flammable: number;
  storage: string | null;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};
type LotsRow = {
  total_lots: number;
  total_quantity: number;
  next_expiry: number | null;
};
type FispqRow = {
  status: string;
  validity_date: number | null;
};

const parseJsonArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const serializeProduct = (row: ProductRow) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  concentration: row.concentration ?? "",
  unNumber: row.un_number ?? "",
  hazardClass: row.hazard_class ?? "",
  signalWord: row.signal_word ?? "",
  hPhrases: parseJsonArray(row.h_phrases),
  pPhrases: parseJsonArray(row.p_phrases),
  controlled: row.controlled === 1,
  controlAgency: row.control_agency ?? "",
  flammable: row.flammable === 1,
  storage: row.storage ?? "",
  status: row.status,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const computeProductAlert = (
  fispq: FispqRow | null,
  lots: LotsRow | null,
  controlled: boolean,
  now: number,
) => {
  const day = 86400;
  const today = Math.floor(now / day) * day;
  if (!fispq || fispq.status !== "active") return "FISPQ pendente";
  if (fispq.validity_date && fispq.validity_date < today)
    return "FISPQ vencida";
  if (fispq.validity_date && fispq.validity_date <= today + 30 * day)
    return "FISPQ vence em breve";
  if (lots?.next_expiry && lots.next_expiry <= today + 30 * day)
    return "Lote vence em breve";
  if (lots?.next_expiry && lots.next_expiry < today)
    return "Lote vencido em estoque";
  if (controlled && !lots) return "Controlado sem estoque registrado";
  return "";
};

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  const db = getD1(),
    productId = Number(request.nextUrl.searchParams.get("id")),
    now = Math.floor(Date.now() / 1000);
  if (Number.isInteger(productId) && productId > 0) {
    const row = await db
      .prepare("SELECT * FROM products WHERE id=?")
      .bind(productId)
      .first<ProductRow>();
    if (!row)
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 },
      );
    const [lots, fispq] = await Promise.all([
      db
        .prepare(
          "SELECT COUNT(*) total_lots,COALESCE(SUM(quantity),0) total_quantity,MIN(expiry_date) next_expiry FROM lots WHERE product_id=? AND quantity>0",
        )
        .bind(productId)
        .first<LotsRow>(),
      db
        .prepare(
          "SELECT status,validity_date FROM fispq WHERE product_id=? ORDER BY updated_at DESC LIMIT 1",
        )
        .bind(productId)
        .first<FispqRow>(),
    ]);
    const product = serializeProduct(row);
    return NextResponse.json({
      product,
      lots,
      fispq,
      alert: computeProductAlert(fispq, lots, product.controlled, now),
    });
  }
  const products = await db.prepare("SELECT * FROM products ORDER BY name").all<ProductRow>(),
    lotRows = await db
      .prepare(
        "SELECT product_id,COUNT(*) total_lots,COALESCE(SUM(quantity),0) total_quantity,MIN(expiry_date) next_expiry FROM lots WHERE quantity>0 GROUP BY product_id",
      )
      .all<LotsRow & { product_id: number }>(),
    fispqRows = await db
      .prepare(
        "SELECT f.* FROM fispq f JOIN (SELECT product_id,MAX(updated_at) max_updated FROM fispq GROUP BY product_id) m ON m.product_id=f.product_id AND m.max_updated=f.updated_at",
      )
      .all<FispqRow & { product_id: number }>(),
    byLots = new Map(lotRows.results.map((row) => [row.product_id, row])),
    byFispq = new Map(fispqRows.results.map((row) => [row.product_id, row]));
  const items = products.results.map((row) => {
    const product = serializeProduct(row),
      lots = byLots.get(row.id) ?? null,
      fispq = byFispq.get(row.id) ?? null;
    return {
      ...product,
      totalLots: lots?.total_lots ?? 0,
      totalQuantity: lots?.total_quantity ?? 0,
      nextExpiry: lots?.next_expiry ?? null,
      fispqStatus: fispq?.status ?? null,
      fispqValidity: fispq?.validity_date ?? null,
      alert: computeProductAlert(fispq, lots, product.controlled, now),
    };
  });
  const summary = {
    total: items.length,
    alerts: items.filter((item) => item.alert).length,
    controlled: items.filter((item) => item.controlled).length,
    flammable: items.filter((item) => item.flammable).length,
    noFispq: items.filter((item) => item.alert === "FISPQ pendente").length,
  };
  return NextResponse.json({ products: items, summary });
}

const parseLines = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : Array.isArray(value)
      ? value.map(String)
      : [];

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
    name = String(body.name || "").trim(),
    category = String(body.category || "Outros").trim(),
    controlled = body.controlled === true || body.controlled === 1,
    flammable = body.flammable === true || body.flammable === 1,
    controlAgency = String(body.controlAgency || "").trim(),
    now = Math.floor(Date.now() / 1000);
  if (!name || !category)
    return NextResponse.json(
      { error: "Informe o nome e a categoria do produto" },
      { status: 400 },
    );
  if (controlled && !controlAgency)
    return NextResponse.json(
      { error: "Produto controlado exige o órgão fiscalizador" },
      { status: 400 },
    );
  const db = getD1(),
    created = await db
      .prepare(
        "INSERT INTO products (name,category,concentration,un_number,hazard_class,signal_word,h_phrases,p_phrases,controlled,control_agency,flammable,storage,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *",
      )
      .bind(
        name,
        category,
        String(body.concentration || ""),
        String(body.unNumber || ""),
        String(body.hazardClass || ""),
        String(body.signalWord || ""),
        JSON.stringify(parseLines(body.hPhrases)),
        JSON.stringify(parseLines(body.pPhrases)),
        controlled ? 1 : 0,
        controlAgency,
        flammable ? 1 : 0,
        String(body.storage || ""),
        String(body.status || "active"),
        String(body.notes || ""),
        actor.userId,
        now,
        now,
      )
      .first<ProductRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível cadastrar o produto" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','product',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({ name, category, controlled, flammable }),
      now,
    )
    .run();
  return NextResponse.json({ product: serializeProduct(created) }, { status: 201 });
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
    return NextResponse.json({ error: "Produto inválido" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM products WHERE id=?")
    .bind(id)
    .first<ProductRow>();
  if (!current)
    return NextResponse.json(
      { error: "Produto não encontrado" },
      { status: 404 },
    );
  const name = String(body.name || current.name).trim(),
    category = String(body.category || current.category).trim(),
    controlled =
      body.controlled === true || body.controlled === 1 || current.controlled === 1,
    flammable =
      body.flammable === true || body.flammable === 1 || current.flammable === 1,
    controlAgency = String(body.controlAgency || current.control_agency || "").trim();
  if (!name || !category)
    return NextResponse.json(
      { error: "Informe o nome e a categoria do produto" },
      { status: 400 },
    );
  if (controlled && !controlAgency)
    return NextResponse.json(
      { error: "Produto controlado exige o órgão fiscalizador" },
      { status: 400 },
    );
  const now = Math.floor(Date.now() / 1000),
    updated = await db
      .prepare(
        "UPDATE products SET name=?,category=?,concentration=?,un_number=?,hazard_class=?,signal_word=?,h_phrases=?,p_phrases=?,controlled=?,control_agency=?,flammable=?,storage=?,status=?,notes=?,updated_at=? WHERE id=? RETURNING *",
      )
      .bind(
        name,
        category,
        String(body.concentration ?? current.concentration ?? ""),
        String(body.unNumber ?? current.un_number ?? ""),
        String(body.hazardClass ?? current.hazard_class ?? ""),
        String(body.signalWord ?? current.signal_word ?? ""),
        JSON.stringify(parseLines(body.hPhrases ?? current.h_phrases)),
        JSON.stringify(parseLines(body.pPhrases ?? current.p_phrases)),
        controlled ? 1 : 0,
        controlAgency,
        flammable ? 1 : 0,
        String(body.storage ?? current.storage ?? ""),
        String(body.status || current.status),
        String(body.notes ?? current.notes ?? ""),
        now,
        id,
      )
      .first<ProductRow>();
  if (!updated)
    return NextResponse.json(
      { error: "Não foi possível atualizar o produto" },
      { status: 500 },
    );
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','product',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        before: { name: current.name, status: current.status },
        after: { name: updated.name, status: updated.status },
      }),
      now,
    )
    .run();
  return NextResponse.json({ product: serializeProduct(updated) });
}
