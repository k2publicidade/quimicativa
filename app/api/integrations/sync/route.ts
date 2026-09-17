import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getD1 } from "../../../../db";
import { canWrite, getActor } from "../../authz";
import { externalErpUrl } from "../url-safety";
import { supabaseAdmin } from '../../../../lib/supabase/admin';
import { syncVhsysBatch } from '../../../../lib/vhsys-sync';
export const maxDuration = 300;

type Config = { id: number; provider: string; base_url: string; orders_path: string; customers_path: string; api_token: string | null; secret_api_token: string | null };
const now = () => Math.floor(Date.now() / 1000);
const value = (obj: Record<string, unknown>, ...keys: string[]) => keys.map(key => obj[key]).find(item => item !== undefined && item !== null && item !== "");
const stringValue = (obj: Record<string, unknown>, ...keys: string[]) => String(value(obj, ...keys) ?? "").trim();
const date = (input: unknown) => { const parsed = new Date(String(input || "")); return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000); };
const finite = (input: unknown, fallback = 0) => { const parsed = Number(input); return Number.isFinite(parsed) ? parsed : fallback; };
type NormalizedItem = { raw: Record<string, unknown>; productName: string; quantity: number };
const normalizedItems = (order: Record<string, unknown>): NormalizedItem[] => {
  const source = value(order, "items", "products", "itens", "itens_pedido", "produtos");
  if (!Array.isArray(source)) return [];
  return source.flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>, productName = stringValue(item, "productName", "name", "product", "produto", "descricao_produto", "nome_produto"), quantity = finite(value(item, "quantity", "qty", "quantidade", "quantidade_produto", "qtde"));
    return productName && quantity > 0 ? [{ raw: item, productName, quantity }] : [];
  });
};
export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const db = getD1(), config = await db.prepare("SELECT * FROM erp_integrations WHERE active=1 ORDER BY id DESC LIMIT 1").first<Config>();
  if (!config) return NextResponse.json({ error: "Configure e ative a integração com o ERP antes de sincronizar." }, { status: 400 });
  try {
    if (config.provider.toLowerCase() === 'vhsys' || new URL(config.base_url).hostname === 'api.vhsys.com') {
      const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
      const remoteId = request.nextUrl.searchParams.get('remoteId') || undefined;
      if (!Number.isSafeInteger(offset) || offset < 0 || (remoteId && !/^\d+$/.test(remoteId))) return NextResponse.json({error:'Identificador de sincronização inválido'},{status:400});
      const result = await syncVhsysBatch(supabaseAdmin(), config, {offset,remoteId,preview:request.nextUrl.searchParams.get('preview')==='1',force:request.nextUrl.searchParams.get('force')==='1'});
      return NextResponse.json(result);
    }
    const { endpoint } = externalErpUrl(config.base_url, config.orders_path);
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", ...(config.api_token ? { Authorization: `Bearer ${config.api_token}` } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ERP respondeu HTTP ${response?.status}`);
    const contentLength = Number(response?.headers.get("content-length") || 0);
    if (contentLength > 10_000_000) throw new Error("Resposta do ERP excede o limite de 10 MB.");
    const payload = await response.json() as unknown;
    const remoteOrders: unknown[] = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).orders)
        ? (payload as { orders: unknown[] }).orders
        : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data)
          ? (payload as { data: unknown[] }).data
          : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).results)
            ? (payload as { results: unknown[] }).results
      : [];
    if (!Array.isArray(payload) && !remoteOrders.length) throw new Error("O ERP não retornou uma lista de pedidos reconhecível.");
    if (remoteOrders.length > 5000) throw new Error("O ERP retornou mais de 5.000 pedidos em uma única sincronização.");
    const previewRows = remoteOrders.flatMap(raw => {
      if (!raw || typeof raw !== "object") return [];
      const order = raw as Record<string, unknown>, customerRaw = (value(order, "customer", "client", "cliente") as Record<string, unknown> | undefined) ?? order;
      return [{ number: stringValue(order, "number", "orderNumber", "id_pedido", "id", "codigo_pedido"), customerName: stringValue(customerRaw, "companyName", "name", "razaoSocial", "nome", "customerName", "nome_cliente", "razao_cliente"), deliveryDate: String(value(order, "deliveryDate", "expectedDelivery", "dataEntrega", "data_entrega_pedido") ?? ""), paymentTerms: stringValue(order, "paymentTerms", "paymentCondition", "condicaoPagamento", "prazoPagamento", "forma_pagamento"), items: normalizedItems(order).length }];
    });
    if (request.nextUrl.searchParams.get("preview") === "1") return NextResponse.json({ preview: true, totalRecords: remoteOrders.length, validRecords: previewRows.filter(item => item.number && item.customerName && item.items > 0).length, sample: previewRows.slice(0, 10) });
    const imported: number[] = [], timestamp = now(), issues: string[] = [];
    for (const raw of remoteOrders) {
      if (!raw || typeof raw !== "object") { issues.push("Registro ignorado: formato inválido."); continue; }
      const order = raw as Record<string, unknown>, number = stringValue(order, "number", "orderNumber", "id_pedido", "id", "codigo_pedido");
      const customerRaw = (value(order, "customer", "client", "cliente") as Record<string, unknown> | undefined) ?? order;
      const companyName = stringValue(customerRaw, "companyName", "name", "razaoSocial", "nome", "customerName", "nome_cliente", "razao_cliente");
      if (!number || !companyName) { issues.push(`Registro ignorado: ${!number ? "número do pedido" : "cliente"} ausente.`); continue; }
      const customerAddress = {
        document: stringValue(customerRaw, "document", "cnpj", "cpf"),
        street: stringValue(customerRaw, "street", "address", "logradouro", "endereco"),
        number: stringValue(customerRaw, "number", "addressNumber", "numero"),
        complement: stringValue(customerRaw, "complement", "complemento"),
        district: stringValue(customerRaw, "district", "neighborhood", "bairro"),
        city: stringValue(customerRaw, "city", "cidade", "municipio"),
        state: stringValue(customerRaw, "state", "uf", "estado"),
        zipCode: stringValue(customerRaw, "zipCode", "postalCode", "cep"),
        receivingWindow: stringValue(customerRaw, "receivingWindow", "deliveryWindow", "horarioRecebimento", "janelaRecebimento"),
      };
      let customer = customerAddress.document
        ? await db.prepare("SELECT id FROM customers WHERE document=? ORDER BY id LIMIT 1").bind(customerAddress.document).first<{ id: number }>()
        : null;
      if (!customer) customer = await db.prepare("SELECT id FROM customers WHERE company_name=? ORDER BY id LIMIT 1").bind(companyName).first<{ id: number }>();
      if (!customer) customer = await db.prepare("INSERT INTO customers (company_name,document,street,number,complement,district,city,state,zip_code,receiving_window,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?) RETURNING id").bind(companyName, customerAddress.document, customerAddress.street, customerAddress.number, customerAddress.complement, customerAddress.district, customerAddress.city, customerAddress.state, customerAddress.zipCode, customerAddress.receivingWindow, timestamp, timestamp).first<{ id: number }>();
      else await db.prepare("UPDATE customers SET document=COALESCE(NULLIF(?,''),document),street=COALESCE(NULLIF(?,''),street),number=COALESCE(NULLIF(?,''),number),complement=COALESCE(NULLIF(?,''),complement),district=COALESCE(NULLIF(?,''),district),city=COALESCE(NULLIF(?,''),city),state=COALESCE(NULLIF(?,''),state),zip_code=COALESCE(NULLIF(?,''),zip_code),receiving_window=COALESCE(NULLIF(?,''),receiving_window),updated_at=? WHERE id=?").bind(customerAddress.document, customerAddress.street, customerAddress.number, customerAddress.complement, customerAddress.district, customerAddress.city, customerAddress.state, customerAddress.zipCode, customerAddress.receivingWindow, timestamp, customer.id).run();
      if (!customer) continue;
      const existing = await db.prepare("SELECT id FROM orders WHERE number=?").bind(number).first<{ id: number }>();
      const deliveryDate = date(value(order, "deliveryDate", "expectedDelivery", "dataEntrega"));
      const orderDate = date(value(order, "orderDate", "date", "dataPedido", "data_pedido")) ?? timestamp;
      const paymentTerms = stringValue(order, "paymentTerms", "paymentCondition", "condicaoPagamento", "prazoPagamento", "condicao_pagamento");
      const notes = stringValue(order, "notes", "observations", "observacoes", "obs_pedido", "obs_interno_pedido");
      const sourcePayload = JSON.stringify(order);
      const orderRow = existing ? await db.prepare("UPDATE orders SET customer_id=?,order_date=?,delivery_date=?,payment_terms=?,notes=?,source_payload=?,updated_at=? WHERE id=? RETURNING id").bind(customer.id, orderDate, deliveryDate, paymentTerms, notes, sourcePayload, timestamp, existing.id).first<{ id: number }>() : await db.prepare("INSERT INTO orders (number,customer_id,order_date,delivery_date,payment_terms,status,notes,source_payload,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(number, customer.id, orderDate, deliveryDate, paymentTerms, "active", notes, sourcePayload, actor.userId, timestamp, timestamp).first<{ id: number }>();
      if (orderRow) {
        const validItems = normalizedItems(order);
        if (validItems.length) {
          const itemStatements: D1PreparedStatement[] = [db.prepare("DELETE FROM order_items WHERE order_id=?").bind(orderRow.id)];
          for (const normalized of validItems) {
            const item = normalized.raw, productName = normalized.productName;
            let product = await db.prepare("SELECT id FROM products WHERE name=? ORDER BY id LIMIT 1").bind(productName).first<{ id: number }>();
            if (!product) product = await db.prepare("INSERT INTO products (name,category,status,created_at,updated_at) VALUES (?,'ERP','active',?,?) RETURNING id").bind(productName, timestamp, timestamp).first<{ id: number }>();
            if (!product) continue;
            const quantity = normalized.quantity;
            const centsValue = value(item, "unitPriceCents", "precoCentavos", "valor_unitario_centavos"), currencyValue = value(item, "unitPrice", "price", "preco", "valor_unitario", "valor_unitario_produto", "valor_unit_produto", "preco_venda");
            const unitPriceCents = centsValue !== undefined ? Math.round(finite(centsValue)) : Math.round(finite(currencyValue) * 100);
            itemStatements.push(db.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit,unit_price_cents,package_count,package_type,package_unit_weight_kg,weight_kg,volume_m3,lot_number,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(orderRow.id, product.id, productName, quantity, stringValue(item, "unit", "unidade", "unidade_medida") || "un", unitPriceCents, Math.max(0, finite(value(item, "packageCount", "volumes", "quantidadeEmbalagens"))), stringValue(item, "packageType", "packaging", "embalagem"), Math.max(0, finite(value(item, "packageUnitWeightKg", "pesoEmbalagemKg"))), Math.max(0, finite(value(item, "weightKg", "totalWeightKg", "pesoKg", "pesoTotal", "peso_bruto", "peso_liquido"))), Math.max(0, finite(value(item, "volumeM3", "totalVolumeM3", "cubagemM3", "volumeTotalM3"))), stringValue(item, "lotNumber", "lot", "lote"), stringValue(item, "notes", "observations", "observacoes", "obs") || "Importado do ERP", timestamp, timestamp));
          }
          if (itemStatements.length > 1) await db.batch(itemStatements);
          else issues.push(`Pedido ${number}: nenhum produto pôde ser vinculado.`);
        } else {
          issues.push(`Pedido ${number}: sem itens válidos; itens existentes foram preservados.`);
        }
        imported.push(orderRow.id);
      }
    }
    const summary = `${imported.length} pedido(s) processado(s)${issues.length ? ` · ${issues.length} aviso(s)` : ""}`;
    await db.prepare("UPDATE erp_integrations SET last_sync_at=?,last_sync_status='success',last_sync_message=?,updated_at=? WHERE id=?").bind(timestamp, summary, timestamp, config.id).run();
    await db.prepare("INSERT INTO audit_log (actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,'sync','erp_integration',?,?,?)").bind(actor.userId, String(config.id), JSON.stringify({ imported: imported.length, issues: issues.slice(0, 50) }), timestamp).run();
    return NextResponse.json({ imported: imported.length, orderIds: imported, issues: issues.slice(0, 50), message: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na sincronização";
    await db.prepare("UPDATE erp_integrations SET last_sync_at=?,last_sync_status='error',last_sync_message=?,updated_at=? WHERE id=?").bind(now(), message.slice(0, 500), now(), config.id).run();
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
