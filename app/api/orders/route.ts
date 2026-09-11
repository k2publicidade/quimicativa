import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "../../../db";
import { canWrite, getActor } from "../authz";

type OrderRow = {
  id: number;
  number: string;
  customer_id: number;
  order_date: number | null;
  delivery_date: number | null;
  payment_terms: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};
type ItemRow = {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  package_count: number;
  package_type: string;
  package_unit_weight_kg: number;
  weight_kg: number;
  lot_number: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};
type DocRow = {
  id: number;
  order_id: number;
  order_item_id: number | null;
  kind: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  metadata: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
};
type CustomerRow = { id: number; company_name: string; document: string };

const ORDER_STATUSES = [
  { value: "draft", label: "Rascunho" },
  { value: "active", label: "Em andamento" },
  { value: "completed", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];
const DOC_KINDS = [
  { key: "nf", label: "Nota fiscal" },
  { key: "boleto", label: "Boleto" },
  { key: "laudo", label: "Laudo" },
  { key: "ficha", label: "Ficha de risco" },
] as const;
export const kindLabel = (key: string) =>
  DOC_KINDS.find((k) => k.key === key)?.label ?? key;

const nowSec = () => Math.floor(Date.now() / 1000);
const dateOrNull = (value: unknown) =>
  value ? Math.floor(new Date(String(value)).getTime() / 1000) : null;
export const fmtDate = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "";

export const serializeDoc = (row: DocRow) => {
  let metadata: Record<string, string> = {};
  try {
    metadata = JSON.parse(row.metadata || "{}");
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    kind: row.kind,
    kindLabel: kindLabel(row.kind),
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    metadata,
    status: row.status,
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const serializeItem = (row: ItemRow) => ({
  id: row.id,
  orderId: row.order_id,
  productId: row.product_id,
  productName: row.product_name,
  quantity: row.quantity,
  unit: row.unit,
  unitPriceCents: row.unit_price_cents,
  packageCount: row.package_count,
  packageType: row.package_type,
  packageUnitWeightKg: row.package_unit_weight_kg,
  weightKg: row.weight_kg,
  lotNumber: row.lot_number ?? "",
  notes: row.notes ?? "",
  lineTotalCents: Math.round(row.quantity * row.unit_price_cents),
});

export const serializeOrder = (
  row: OrderRow,
  customerName = "",
  extra: Record<string, unknown> = {},
) => ({
  id: row.id,
  number: row.number || `PED-${String(row.id).padStart(4, "0")}`,
  customerId: row.customer_id,
  customerName,
  orderDate: fmtDate(row.order_date),
  deliveryDate: fmtDate(row.delivery_date),
  paymentTerms: row.payment_terms ?? "",
  status: row.status,
  notes: row.notes ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...extra,
});

// Etapas do fluxo: Nota fiscal → Boleto → Laudo → Ficha de risco
export function computeOrderProgress(
  itemsCount: number,
  docs: { kind: string; order_item_id: number | null; status?: string }[],
) {
  const active = docs.filter((d) => (d.status ?? "active") === "active");
  const has = (kind: string) => active.some((d) => d.kind === kind);
  const itemCovered = (kind: string) => {
    if (!itemsCount) return false;
    const covered = new Set(
      active
        .filter((d) => d.kind === kind && d.order_item_id !== null)
        .map((d) => d.order_item_id),
    );
    return covered.size > 0; // pelo menos um item coberto é "parcial"; completo exige todos
  };
  const itemComplete = (kind: string) => {
    if (!itemsCount) return false;
    const covered = new Set(
      active
        .filter((d) => d.kind === kind && d.order_item_id !== null)
        .map((d) => d.order_item_id),
    );
    const itemIds = new Set(
      active.map((d) => d.order_item_id).filter((v): v is number => v !== null),
    );
    // itens conhecidos vêm do caller; aqui usamos cobertura informada
    return covered.size >= itemsCount && itemIds.size > 0;
  };
  const steps = [
    { key: "nf", label: "Nota fiscal", state: has("nf") ? "ok" : "pending" },
    {
      key: "boleto",
      label: "Boleto",
      state: has("boleto") ? "ok" : "pending",
    },
    {
      key: "laudo",
      label: "Laudos dos itens",
      state: !itemsCount ? "pending" : itemComplete("laudo") ? "ok" : itemCovered("laudo") ? "partial" : "pending",
    },
    {
      key: "ficha",
      label: "Fichas de risco",
      state: !itemsCount ? "pending" : itemComplete("ficha") ? "ok" : itemCovered("ficha") ? "partial" : "pending",
    },
  ];
  const done = steps.filter((s) => s.state === "ok").length;
  return { steps, done, total: steps.length };
}

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  const db = getD1(),
    id = Number(request.nextUrl.searchParams.get("id")),
    q = String(request.nextUrl.searchParams.get("q") || "").trim(),
    status = String(request.nextUrl.searchParams.get("status") || "").trim();

  if (Number.isInteger(id) && id > 0) {
    const row = await db
      .prepare("SELECT * FROM orders WHERE id=?")
      .bind(id)
      .first<OrderRow>();
    if (!row)
      return NextResponse.json(
        { error: "Pedido não encontrado" },
        { status: 404 },
      );
    const [customer, items, docs] = await Promise.all([
      db
        .prepare("SELECT id,company_name,document FROM customers WHERE id=?")
        .bind(row.customer_id)
        .first<CustomerRow>(),
      db
        .prepare("SELECT * FROM order_items WHERE order_id=? ORDER BY id")
        .bind(id)
        .all<ItemRow>(),
      db
        .prepare(
          "SELECT * FROM order_documents WHERE order_id=? ORDER BY created_at",
        )
        .bind(id)
        .all<DocRow>(),
    ]);
    const docsSerialized = docs.results.map(serializeDoc);
    const progress = computeOrderProgress(
      items.results.length,
      docs.results.map((d) => ({
        kind: d.kind,
        order_item_id: d.order_item_id,
        status: d.status,
      })),
    );
    const totalCents = items.results.reduce(
      (sum, item) => sum + Math.round(item.quantity * item.unit_price_cents),
      0,
    );
    return NextResponse.json({
      order: serializeOrder(row, customer?.company_name ?? "", {
        totalCents,
        itemsCount: items.results.length,
        progress,
      }),
      customer: customer ?? null,
      items: items.results.map(serializeItem),
      documents: docsSerialized,
    });
  }

  const orders = await db
    .prepare("SELECT * FROM orders ORDER BY id DESC")
    .all<OrderRow>();
  const ids = orders.results.map((o) => o.id);
  let customers: { id: number; company_name: string }[] = [],
    itemsAgg: { order_id: number; count: number; total_cents: number; total_weight_kg: number }[] = [],
    docsAgg: { order_id: number; kind: string; order_item_id: number | null }[] = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    [customers, itemsAgg, docsAgg] = await Promise.all([
      db
        .prepare(
          `SELECT id,company_name FROM customers WHERE id IN (${placeholders})`,
        )
        .bind(...ids)
        .all<{ id: number; company_name: string }>()
        .then((r) => r.results),
      db
        .prepare(
          `SELECT order_id,COUNT(*) AS count,COALESCE(SUM(quantity*unit_price_cents),0) AS total_cents,
             COALESCE(SUM(CASE WHEN weight_kg>0 THEN weight_kg WHEN package_count>0 AND package_unit_weight_kg>0 THEN package_count*package_unit_weight_kg WHEN LOWER(unit) IN ('kg','quilo','quilos') THEN quantity ELSE 0 END),0) AS total_weight_kg
           FROM order_items WHERE order_id IN (${placeholders}) GROUP BY order_id`,
        )
        .bind(...ids)
        .all<{ order_id: number; count: number; total_cents: number; total_weight_kg: number }>()
        .then((r) => r.results),
      db
        .prepare(
          `SELECT order_id,kind,order_item_id FROM order_documents
           WHERE order_id IN (${placeholders}) AND status='active'`,
        )
        .bind(...ids)
        .all<{ order_id: number; kind: string; order_item_id: number | null }>()
        .then((r) => r.results),
    ]);
  }
  const byCustomer = new Map(customers.map((c) => [c.id, c.company_name])),
    byItems = new Map(itemsAgg.map((i) => [i.order_id, i])),
    byDocs = new Map<number, { kind: string; order_item_id: number | null }[]>();
  docsAgg.forEach((d) => {
    const list = byDocs.get(d.order_id) ?? [];
    list.push(d);
    byDocs.set(d.order_id, list);
  });
  let result = orders.results.map((row) => {
    const agg = byItems.get(row.id),
      itemCount = agg?.count ?? 0,
      docRows = byDocs.get(row.id) ?? [];
    return serializeOrder(row, byCustomer.get(row.customer_id) ?? "", {
      totalCents: Math.round(agg?.total_cents ?? 0),
      totalWeightKg: Number(agg?.total_weight_kg ?? 0),
      itemsCount: itemCount,
      progress: computeOrderProgress(itemCount, docRows),
    });
  });
  if (q) {
    const like = q.toLowerCase();
    result = result.filter(
      (o) =>
        o.number.toLowerCase().includes(like) ||
        o.customerName.toLowerCase().includes(like),
    );
  }
  if (status) result = result.filter((o) => o.status === status);
  return NextResponse.json({ orders: result });
}

type ItemInput = {
  id?: number;
  productId: number;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  packageCount?: number;
  packageType?: string;
  packageUnitWeightKg?: number;
  weightKg?: number;
  lotNumber?: string;
  notes?: string;
};

async function validateItems(db: ReturnType<typeof getD1>, items: ItemInput[]) {
  if (!Array.isArray(items) || !items.length)
    return { error: "Adicione ao menos um produto ao pedido." };
  const ids = [...new Set(items.map((i) => Number(i.productId)))];
  if (ids.some((v) => !Number.isInteger(v) || v <= 0))
    return { error: "Produto inválido em um dos itens." };
  const rows = await db
    .prepare(
      `SELECT id,name FROM products WHERE id IN (${ids.map(() => "?").join(",")}) AND status='active'`,
    )
    .bind(...ids)
    .all<{ id: number; name: string }>();
  const byId = new Map(rows.results.map((r) => [r.id, r.name]));
  for (const item of items) {
    if (!byId.has(Number(item.productId)))
      return {
        error: `Produto ${item.productId} não encontrado ou inativo. Cadastre-o em Produtos antes de incluí-lo no pedido.`,
      };
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      return { error: "Quantidade deve ser maior que zero em todos os itens." };
    if (quantity > 1000000)
      return { error: "Quantidade acima do limite permitido." };
    const price = Number(item.unitPriceCents);
    if (!Number.isFinite(price) || price < 0 || Math.round(price) !== price)
      return { error: "Preço unitário inválido em um dos itens." };
    for (const value of [item.packageCount, item.packageUnitWeightKg, item.weightKg]) {
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0))
        return { error: "Embalagens e peso devem usar valores numéricos não negativos." };
    }
  }
  return { error: null };
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    db = getD1(),
    customerId = Number(body.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0)
    return NextResponse.json(
      { error: "Selecione o cliente do pedido." },
      { status: 400 },
    );
  const customer = await db
    .prepare("SELECT id FROM customers WHERE id=?")
    .bind(customerId)
    .first<{ id: number }>();
  if (!customer)
    return NextResponse.json(
      { error: "Cliente não encontrado. Cadastre o cliente antes do pedido." },
      { status: 404 },
    );
  const itemCheck = await validateItems(db, body.items as ItemInput[]);
  if (itemCheck.error)
    return NextResponse.json({ error: itemCheck.error }, { status: 400 });
  const now = nowSec(),
    tmp = `TMP-${now}-${Math.floor(Math.random() * 1e6)}`,
    created = await db
      .prepare(
        `INSERT INTO orders (number,customer_id,order_date,delivery_date,payment_terms,status,notes,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      )
      .bind(
        tmp,
        customerId,
        dateOrNull(body.orderDate) ?? now,
        dateOrNull(body.deliveryDate),
        String(body.paymentTerms ?? "").trim(),
        String(body.status ?? "draft"),
        String(body.notes ?? "").trim(),
        actor.userId,
        now,
        now,
      )
      .first<OrderRow>();
  if (!created)
    return NextResponse.json(
      { error: "Não foi possível criar o pedido" },
      { status: 500 },
    );
  const finalNumber = `PED-${String(created.id).padStart(4, "0")}`;
  const statements = [
    db
      .prepare("UPDATE orders SET number=?,updated_at=? WHERE id=?")
      .bind(finalNumber, now, created.id),
  ];
  for (const item of body.items as ItemInput[]) {
    const product = await db
      .prepare("SELECT name FROM products WHERE id=?")
      .bind(Number(item.productId))
      .first<{ name: string }>();
    statements.push(
      db
        .prepare(
          `INSERT INTO order_items
           (order_id,product_id,product_name,quantity,unit,unit_price_cents,package_count,package_type,package_unit_weight_kg,weight_kg,lot_number,notes,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          created.id,
          Number(item.productId),
          product?.name ?? "Produto",
          Number(item.quantity),
          String(item.unit || "L"),
          Number(item.unitPriceCents ?? 0),
          Number(item.packageCount ?? 0),
          String(item.packageType ?? ""),
          Number(item.packageUnitWeightKg ?? 0),
          Number(item.weightKg ?? 0),
          String(item.lotNumber ?? ""),
          String(item.notes ?? ""),
          now,
          now,
        ),
    );
  }
  await db.batch(statements);
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'create','order',?,?,?)",
    )
    .bind(
      actor.userId,
      String(created.id),
      JSON.stringify({
        number: finalNumber,
        customerId,
        items: (body.items as ItemInput[]).length,
      }),
      now,
    )
    .run();
  return NextResponse.json(
    { order: serializeOrder({ ...created, number: finalNumber }) },
    { status: 201 },
  );
}

export async function PUT(request: NextRequest) {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Acesso não autorizado" },
      { status: 401 },
    );
  if (!canWrite(actor))
    return NextResponse.json(
      { error: "Seu perfil possui acesso somente para consulta" },
      { status: 403 },
    );
  const body = (await request.json()) as Record<string, unknown>,
    id = Number(body.id),
    db = getD1();
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  const current = await db
    .prepare("SELECT * FROM orders WHERE id=?")
    .bind(id)
    .first<OrderRow>();
  if (!current)
    return NextResponse.json(
      { error: "Pedido não encontrado" },
      { status: 404 },
    );
  if (current.status === "cancelled" && body.status !== "cancelled")
    return NextResponse.json(
      { error: "Pedido cancelado não pode ser reaberto. Crie um novo pedido." },
      { status: 400 },
    );

  const status = String(body.status ?? current.status);
  if (!ORDER_STATUSES.some((s) => s.value === status))
    return NextResponse.json(
      { error: "Situação do pedido inválida." },
      { status: 400 },
    );
  const now = nowSec();

  // Itens (quando enviados): id preservado = atualiza; sem id = insere; ausente da lista = remove (se sem documentos)
  let removedWithDocs: string[] = [];
  if (body.items !== undefined) {
    const itemCheck = await validateItems(db, body.items as ItemInput[]);
    if (itemCheck.error)
      return NextResponse.json({ error: itemCheck.error }, { status: 400 });
    const existing = await db
      .prepare("SELECT * FROM order_items WHERE order_id=?")
      .bind(id)
      .all<ItemRow>();
    const incomingIds = new Set(
      (body.items as ItemInput[])
        .map((i) => Number(i.id))
        .filter((v) => Number.isInteger(v) && v > 0),
    );
    const docs = await db
      .prepare(
        "SELECT order_item_id FROM order_documents WHERE order_id=? AND order_item_id IS NOT NULL",
      )
      .bind(id)
      .all<{ order_item_id: number }>();
    const docItemIds = new Set(docs.results.map((d) => d.order_item_id));
    const removed = existing.results.filter((r) => !incomingIds.has(r.id));
    removedWithDocs = removed
      .filter((r) => docItemIds.has(r.id))
      .map((r) => r.product_name);
    if (removedWithDocs.length)
      return NextResponse.json(
        {
          error: `Não é possível remover: ${removedWithDocs.join(", ")}. Remova antes o laudo/ficha anexado ao item.`,
        },
        { status: 409 },
      );
  }

  const statements: ReturnType<typeof db.prepare>[] = [];
  if (body.items !== undefined) {
    const existing = await db
      .prepare("SELECT * FROM order_items WHERE order_id=?")
      .bind(id)
      .all<ItemRow>();
    const byId = new Map(existing.results.map((r) => [r.id, r]));
    for (const item of body.items as ItemInput[]) {
      const itemId = Number(item.id);
      const known = Number.isInteger(itemId) && itemId > 0 && byId.has(itemId);
      const product = await db
        .prepare("SELECT name FROM products WHERE id=?")
        .bind(Number(item.productId))
        .first<{ name: string }>();
      if (known) {
        statements.push(
          db
            .prepare(
              `UPDATE order_items SET product_id=?,product_name=?,quantity=?,unit=?,unit_price_cents=?,package_count=?,package_type=?,package_unit_weight_kg=?,weight_kg=?,lot_number=?,notes=?,updated_at=? WHERE id=? AND order_id=?`,
            )
            .bind(
              Number(item.productId),
              product?.name ?? byId.get(itemId)?.product_name ?? "Produto",
              Number(item.quantity),
              String(item.unit || "L"),
              Number(item.unitPriceCents ?? 0),
              Number(item.packageCount ?? byId.get(itemId)?.package_count ?? 0),
              String(item.packageType ?? byId.get(itemId)?.package_type ?? ""),
              Number(item.packageUnitWeightKg ?? byId.get(itemId)?.package_unit_weight_kg ?? 0),
              Number(item.weightKg ?? byId.get(itemId)?.weight_kg ?? 0),
              String(item.lotNumber ?? byId.get(itemId)?.lot_number ?? ""),
              String(item.notes ?? byId.get(itemId)?.notes ?? ""),
              now,
              itemId,
              id,
            ),
        );
      } else {
        statements.push(
          db
            .prepare(
              `INSERT INTO order_items
               (order_id,product_id,product_name,quantity,unit,unit_price_cents,package_count,package_type,package_unit_weight_kg,weight_kg,lot_number,notes,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              Number(item.productId),
              product?.name ?? "Produto",
              Number(item.quantity),
              String(item.unit || "L"),
              Number(item.unitPriceCents ?? 0),
              Number(item.packageCount ?? 0),
              String(item.packageType ?? ""),
              Number(item.packageUnitWeightKg ?? 0),
              Number(item.weightKg ?? 0),
              String(item.lotNumber ?? ""),
              String(item.notes ?? ""),
              now,
              now,
            ),
        );
      }
    }
    // remove itens ausentes da lista (sem docs)
    for (const row of existing.results) {
      if (!(body.items as ItemInput[]).some((i) => Number(i.id) === row.id)) {
        statements.push(
          db
            .prepare("DELETE FROM order_items WHERE id=? AND order_id=?")
            .bind(row.id, id),
        );
      }
    }
  }
  statements.push(
    db
      .prepare(
        "UPDATE orders SET customer_id=?,order_date=?,delivery_date=?,payment_terms=?,status=?,notes=?,updated_at=? WHERE id=?",
      )
      .bind(
        Number(body.customerId ?? current.customer_id),
        dateOrNull(body.orderDate) ?? current.order_date ?? now,
        body.deliveryDate !== undefined
          ? dateOrNull(body.deliveryDate)
          : current.delivery_date,
        String(body.paymentTerms ?? current.payment_terms ?? "").trim(),
        status,
        String(body.notes ?? current.notes ?? "").trim(),
        now,
        id,
      ),
  );
  await db.batch(statements);
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'update','order',?,?,?)",
    )
    .bind(
      actor.userId,
      String(id),
      JSON.stringify({
        status,
        itemsReplaced: body.items !== undefined,
        removed: removedWithDocs,
      }),
      now,
    )
    .run();
  const fresh = await db
    .prepare("SELECT * FROM orders WHERE id=?")
    .bind(id)
    .first<OrderRow>();
  return NextResponse.json({ order: serializeOrder(fresh ?? current) });
}
