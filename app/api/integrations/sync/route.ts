import { NextResponse } from "next/server";
import { getD1 } from "../../../../db";
import { canWrite, getActor } from "../../authz";
import { externalErpUrl } from "../url-safety";

type Config = { id: number; provider: string; base_url: string; orders_path: string; api_token: string | null };
const now = () => Math.floor(Date.now() / 1000);
const value = (obj: Record<string, unknown>, ...keys: string[]) => keys.map(key => obj[key]).find(item => item !== undefined && item !== null && item !== "");
const stringValue = (obj: Record<string, unknown>, ...keys: string[]) => String(value(obj, ...keys) ?? "").trim();
const date = (input: unknown) => { const parsed = new Date(String(input || "")); return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000); };

export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Acesso não autorizado" }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: "Seu perfil possui acesso somente para consulta" }, { status: 403 });
  const db = getD1(), config = await db.prepare("SELECT * FROM erp_integrations WHERE active=1 ORDER BY id DESC LIMIT 1").first<Config>();
  if (!config) return NextResponse.json({ error: "Configure e ative a integração com o ERP antes de sincronizar." }, { status: 400 });
  try {
    const { endpoint } = externalErpUrl(config.base_url, config.orders_path);
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", ...(config.api_token ? { Authorization: `Bearer ${config.api_token}` } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ERP respondeu HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 10_000_000) throw new Error("Resposta do ERP excede o limite de 10 MB.");
    const payload = await response.json() as unknown;
    const remoteOrders: unknown[] = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).orders)
        ? (payload as { orders: unknown[] }).orders
        : [];
    if (!Array.isArray(payload) && !remoteOrders.length) throw new Error("O ERP não retornou uma lista de pedidos reconhecível.");
    const imported: number[] = [], timestamp = now();
    for (const raw of remoteOrders) {
      if (!raw || typeof raw !== "object") continue;
      const order = raw as Record<string, unknown>, number = stringValue(order, "number", "orderNumber", "id", "codigo");
      const customerRaw = (value(order, "customer", "client", "cliente") as Record<string, unknown> | undefined) ?? order;
      const companyName = stringValue(customerRaw, "companyName", "name", "razaoSocial", "nome", "customerName");
      if (!number || !companyName) continue;
      let customer = await db.prepare("SELECT id FROM customers WHERE company_name=? ORDER BY id LIMIT 1").bind(companyName).first<{ id: number }>();
      const customerAddress = {
        document: stringValue(customerRaw, "document", "cnpj", "cpf"),
        street: stringValue(customerRaw, "street", "address", "logradouro", "endereco"),
        number: stringValue(customerRaw, "number", "addressNumber", "numero"),
        complement: stringValue(customerRaw, "complement", "complemento"),
        district: stringValue(customerRaw, "district", "neighborhood", "bairro"),
        city: stringValue(customerRaw, "city", "cidade", "municipio"),
        state: stringValue(customerRaw, "state", "uf", "estado"),
        zipCode: stringValue(customerRaw, "zipCode", "postalCode", "cep"),
      };
      if (!customer) customer = await db.prepare("INSERT INTO customers (company_name,document,street,number,complement,district,city,state,zip_code,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?) RETURNING id").bind(companyName, customerAddress.document, customerAddress.street, customerAddress.number, customerAddress.complement, customerAddress.district, customerAddress.city, customerAddress.state, customerAddress.zipCode, timestamp, timestamp).first<{ id: number }>();
      else await db.prepare("UPDATE customers SET document=COALESCE(NULLIF(?,''),document),street=COALESCE(NULLIF(?,''),street),number=COALESCE(NULLIF(?,''),number),complement=COALESCE(NULLIF(?,''),complement),district=COALESCE(NULLIF(?,''),district),city=COALESCE(NULLIF(?,''),city),state=COALESCE(NULLIF(?,''),state),zip_code=COALESCE(NULLIF(?,''),zip_code),updated_at=? WHERE id=?").bind(customerAddress.document, customerAddress.street, customerAddress.number, customerAddress.complement, customerAddress.district, customerAddress.city, customerAddress.state, customerAddress.zipCode, timestamp, customer.id).run();
      if (!customer) continue;
      const existing = await db.prepare("SELECT id FROM orders WHERE number=?").bind(number).first<{ id: number }>();
      const deliveryDate = date(value(order, "deliveryDate", "expectedDelivery", "dataEntrega"));
      const orderDate = date(value(order, "orderDate", "date", "dataPedido")) ?? timestamp;
      const paymentTerms = stringValue(order, "paymentTerms", "paymentCondition", "condicaoPagamento", "prazoPagamento");
      const orderRow = existing ? await db.prepare("UPDATE orders SET customer_id=?,order_date=?,delivery_date=?,payment_terms=?,notes=?,updated_at=? WHERE id=? RETURNING id").bind(customer.id, orderDate, deliveryDate, paymentTerms, stringValue(order, "notes", "observations", "observacoes"), timestamp, existing.id).first<{ id: number }>() : await db.prepare("INSERT INTO orders (number,customer_id,order_date,delivery_date,payment_terms,status,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(number, customer.id, orderDate, deliveryDate, paymentTerms, "active", stringValue(order, "notes", "observations", "observacoes"), actor.userId, timestamp, timestamp).first<{ id: number }>();
      if (orderRow) {
        const remoteItems = Array.isArray(value(order, "items", "products", "itens")) ? value(order, "items", "products", "itens") as unknown[] : [];
        if (remoteItems.length) {
          await db.prepare("DELETE FROM order_items WHERE order_id=?").bind(orderRow.id).run();
          for (const rawItem of remoteItems) {
            if (!rawItem || typeof rawItem !== "object") continue;
            const item = rawItem as Record<string, unknown>, productName = stringValue(item, "productName", "name", "product", "produto");
            if (!productName) continue;
            let product = await db.prepare("SELECT id FROM products WHERE name=? ORDER BY id LIMIT 1").bind(productName).first<{ id: number }>();
            if (!product) product = await db.prepare("INSERT INTO products (name,category,status,created_at,updated_at) VALUES (?,'ERP','active',?,?) RETURNING id").bind(productName, timestamp, timestamp).first<{ id: number }>();
            if (!product) continue;
            const quantity = Number(value(item, "quantity", "qty", "quantidade") ?? 0);
            const centsValue = value(item, "unitPriceCents", "precoCentavos"), currencyValue = value(item, "unitPrice", "price", "preco");
            const unitPriceCents = centsValue !== undefined ? Math.round(Number(centsValue)) : Math.round(Number(currencyValue ?? 0) * 100);
            if (!Number.isFinite(quantity) || quantity <= 0) continue;
            await db.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit,unit_price_cents,package_count,package_type,package_unit_weight_kg,weight_kg,lot_number,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(orderRow.id, product.id, productName, quantity, stringValue(item, "unit", "unidade") || "un", Number.isFinite(unitPriceCents) ? unitPriceCents : 0, Number(value(item, "packageCount", "volumes", "quantidadeEmbalagens") ?? 0), stringValue(item, "packageType", "packaging", "embalagem"), Number(value(item, "packageUnitWeightKg", "pesoEmbalagemKg") ?? 0), Number(value(item, "weightKg", "totalWeightKg", "pesoKg", "pesoTotal") ?? 0), stringValue(item, "lotNumber", "lot", "lote"), "Importado do ERP", timestamp, timestamp).run();
          }
        }
        imported.push(orderRow.id);
      }
    }
    await db.prepare("UPDATE erp_integrations SET last_sync_at=?,last_sync_status='success',last_sync_message=?,updated_at=? WHERE id=?").bind(timestamp, `${imported.length} pedido(s) processado(s)`, timestamp, config.id).run();
    return NextResponse.json({ imported: imported.length, orderIds: imported, message: `${imported.length} pedido(s) sincronizado(s) com o ERP.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na sincronização";
    await db.prepare("UPDATE erp_integrations SET last_sync_at=?,last_sync_status='error',last_sync_message=?,updated_at=? WHERE id=?").bind(now(), message.slice(0, 500), now(), config.id).run();
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
