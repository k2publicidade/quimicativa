"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Customer = {
  id: number;
  companyName: string;
  tradingName: string;
  document: string;
  stateRegistration: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zipCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  segment: string;
  lgpdBasis: string;
  status: string;
  notes: string;
};
type Step = { key: string; label: string; state: "ok" | "partial" | "pending" };
type OrderSummary = {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  orderDate: string;
  deliveryDate: string;
  status: string;
  notes: string;
  totalCents: number;
  itemsCount: number;
  progress: { steps: Step[]; done: number; total: number };
};
type Item = {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  lotNumber: string;
  notes: string;
  lineTotalCents: number;
};
type Doc = {
  id: number;
  orderItemId: number | null;
  kind: string;
  kindLabel: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  metadata: Record<string, string>;
  status: string;
  notes: string;
};
type OrderFull = OrderSummary & { items: Item[]; documents: Doc[] };
type ProductLight = { id: number; name: string; category: string };

const flowKeys = ["nf", "boleto", "laudo", "ficha"];
const flowShort: Record<string, string> = {
  nf: "NF",
  boleto: "Boleto",
  laudo: "Laudo",
  ficha: "Ficha",
};
const orderStatuses = [
  { value: "draft", label: "Rascunho" },
  { value: "active", label: "Em andamento" },
  { value: "completed", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];
const customerSegments = [
  "Indústria",
  "Distribuidor",
  "Varejo",
  "Agronegócio",
  "Serviços",
  "Outro",
];
const lgpdBasis = [
  "Consentimento",
  "Execução de contrato",
  "Obrigação legal",
  "Legítimo interesse",
];
const units = ["L", "kg", "g", "mL", "un", "cx", "fardo", "bombona", "tambor"];
const orderStatusLabel = (value: string) =>
  orderStatuses.find((s) => s.value === value)?.label ?? value;

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const centsFromBRL = (text: string) => {
  const cleaned = String(text)
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};
const BRLFromCents = (cents: number) => (cents / 100).toFixed(2);
const fmtBytes = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const fmtDateBR = (iso: string) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const todayIso = () => new Date().toISOString().slice(0, 10);

function Modal({
  title,
  eyebrow,
  onClose,
  wide,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="doc-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
    >
      <div
        className={`product-modal-card ord-modal-card ${wide ? "" : "narrow"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{eyebrow}</span>
            <h3>{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}

export default function PedidosCenter({
  notify,
  canWrite = true,
}: {
  notify: (message: string) => void;
  canWrite?: boolean;
}) {
  const [tab, setTab] = useState<"orders" | "customers">("orders");
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductLight[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const r = await fetch("/api/orders");
      if (!r.ok) throw new Error();
      setOrders((await r.json()).orders ?? []);
    } catch {
      notify("Não foi possível carregar os pedidos");
    }
  }, [notify]);
  const loadCustomers = useCallback(async () => {
    try {
      const r = await fetch("/api/customers");
      if (!r.ok) throw new Error();
      setCustomers((await r.json()).customers ?? []);
    } catch {
      notify("Não foi possível carregar os clientes");
    }
  }, [notify]);

  useEffect(() => {
    Promise.all([loadOrders(), loadCustomers()])
      .then(() => fetch("/api/products"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.products)
          setProducts(
            data.products.map((p: { id: number; name: string; category: string }) => ({
              id: p.id,
              name: p.name,
              category: p.category,
            })),
          );
      })
      .finally(() => setLoading(false));
  }, [loadOrders, loadCustomers]);

  const activeCustomers = customers.filter((c) => c.status === "active");
  const stats = useMemo(() => {
    const open = orders.filter(
      (o) => o.status === "draft" || o.status === "active",
    );
    const completed = orders.filter((o) => o.status === "completed");
    const stepsOk = orders.reduce(
      (sum, o) => sum + o.progress.done,
      0,
    );
    const stepsTotal = orders.reduce(
      (sum, o) => sum + o.progress.total,
      0,
    );
    return { open: open.length, completed: completed.length, stepsOk, stepsTotal };
  }, [orders]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadOrders(), loadCustomers()]);
  }, [loadOrders, loadCustomers]);

  const tabs = [
    ["orders", "Pedidos", `${orders.length}`],
    ["customers", "Clientes", `${activeCustomers.length}`],
  ] as const;

  return (
    <>
      <section className="migration-hero">
        <div>
          <p className="eyebrow">FLUXO DE PEDIDOS E DOCUMENTAÇÃO</p>
          <h2>Do pedido ao dossiê completo do cliente</h2>
          <p>
            Cadastre o pedido e anexe a Nota fiscal, o Boleto, os Laudos e as
            Fichas de risco — o sistema monta o PDF final com tudo na ordem
            certa.
          </p>
        </div>
      </section>
      <section className="ord-kpis">
        <article>
          <span>Pedidos abertos</span>
          <strong>{stats.open}</strong>
        </article>
        <article>
          <span>Concluídos</span>
          <strong>{stats.completed}</strong>
        </article>
        <article>
          <span>Etapas de docs concluídas</span>
          <strong>
            {stats.stepsTotal ? `${stats.stepsOk}/${stats.stepsTotal}` : "—"}
          </strong>
        </article>
        <article>
          <span>Clientes cadastrados</span>
          <strong>{activeCustomers.length}</strong>
        </article>
      </section>
      <div className="product-tabs" role="tablist" aria-label="Pedidos e clientes">
        {tabs.map(([key, label, badge]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`product-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
            {badge ? <span>{badge}</span> : null}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="records-loading" aria-label="Carregando">
          <i />
          <i />
          <i />
        </div>
      ) : tab === "orders" ? (
        <OrdersTab
          orders={orders}
          products={products}
          customers={activeCustomers}
          canWrite={canWrite}
          notify={notify}
          onChanged={loadOrders}
          onOpen={(id) => setOpenId(id)}
        />
      ) : (
        <CustomersTab
          customers={customers}
          canWrite={canWrite}
          notify={notify}
          onChanged={loadCustomers}
        />
      )}
      {openId !== null && (
        <OrderDetailModal
          orderId={openId}
          customers={customers}
          canWrite={canWrite}
          notify={notify}
          onClose={() => setOpenId(null)}
          onChanged={reloadAll}
        />
      )}
    </>
  );
}

function FlowSteps({ progress }: { progress: OrderSummary["progress"] }) {
  return (
    <div className="ord-flow" aria-label="Etapas do fluxo do pedido">
      {flowKeys.map((key, index) => {
        const step = progress.steps.find((s) => s.key === key) ?? {
          key,
          label: flowShort[key],
          state: "pending",
        } as Step;
        return (
          <div className={`step ${step.state}`} key={key}>
            <span className="dot">
              {step.state === "ok" ? "✓" : index + 1}
            </span>
            <strong>{step.label}</strong>
            <span>
              {step.state === "ok"
                ? "anexado"
                : step.state === "partial"
                  ? "parcial"
                  : "pendente"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OrdersTab({
  orders,
  products,
  customers,
  canWrite,
  notify,
  onChanged,
  onOpen,
}: {
  orders: OrderSummary[];
  products: ProductLight[];
  customers: Customer[];
  canWrite: boolean;
  notify: (message: string) => void;
  onChanged: () => void;
  onOpen: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const visible = orders.filter(
    (o) =>
      (!statusFilter || o.status === statusFilter) &&
      (!query ||
        `${o.number} ${o.customerName}`.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <section className="panel archive-panel">
      <div className="section-title">
        <div>
          <h2>Pedidos de venda</h2>
          <p>
            O pedido só vira dossiê quando as 4 etapas do fluxo estão anexadas.
          </p>
        </div>
        {canWrite && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Novo pedido
          </button>
        )}
      </div>
      <div className="ord-toolbar">
        <div className="archive-search">
          <span>⌕</span>
          <input
            aria-label="Buscar pedidos"
            placeholder="Buscar por número ou cliente..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="Filtrar por situação"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          style={{
            border: "1px solid #d7dde4",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: 13,
            color: "#1c2434",
            background: "#fff",
          }}
        >
          <option value="">Todas as situações</option>
          {orderStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {visible.length ? (
        <div className="ord-list">
          {visible.map((order) => (
            <article className="ord-card" key={order.id}>
              <div className="num">
                <strong>{order.number}</strong>
                <small>{fmtDateBR(order.orderDate)}</small>
              </div>
              <div className="who">
                <strong>{order.customerName || "—"}</strong>
                <small>
                  {order.itemsCount} produto(s) ·{" "}
                  <b>{fmtBRL(order.totalCents)}</b>
                </small>
                <div className="ord-mini" aria-label="Etapas do fluxo">
                  {order.progress.steps.map((step) => (
                    <i key={step.key} className={step.state} title={step.label}>
                      {flowShort[step.key] ?? step.label}
                    </i>
                  ))}
                </div>
              </div>
              <div className="actions">
                <span className={`ord-status ${order.status}`}>
                  <span className="k" />
                  {orderStatusLabel(order.status)}
                </span>
                <button
                  className="ghost-button"
                  onClick={() =>
                    window.open(
                      `/api/orders/dossier?orderId=${order.id}`,
                      "_blank",
                      "noopener",
                    )
                  }
                  title="Baixar PDF do pedido"
                  aria-label={`Baixar PDF do ${order.number}`}
                >
                  PDF
                </button>
                <button className="primary-button" onClick={() => onOpen(order.id)}>
                  Abrir
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="ord-empty">
          {orders.length
            ? "Nenhum pedido corresponde à busca."
            : "Nenhum pedido ainda. Crie o primeiro pedido para iniciar o fluxo."}
        </div>
      )}
      {creating && (
        <NewOrderModal
          products={products}
          customers={customers}
          notify={notify}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function NewOrderModal({
  products,
  customers,
  notify,
  onClose,
  onCreated,
}: {
  products: ProductLight[];
  customers: Customer[];
  notify: (message: string) => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  type DraftItem = {
    key: number;
    productId: string;
    quantity: string;
    unit: string;
    priceText: string;
    lotNumber: string;
  };
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { key: 1, productId: "", quantity: "1", unit: "L", priceText: "", lotNumber: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const patchItem = (key: number, field: Partial<DraftItem>) =>
    setItems((list) =>
      list.map((item) => (item.key === key ? { ...item, ...field } : item)),
    );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!customerId) return notify("Selecione o cliente do pedido.");
    const payloadItems = items
      .filter((item) => item.productId)
      .map((item) => ({
        productId: Number(item.productId),
        quantity: Number(item.quantity.replace(",", ".")),
        unit: item.unit,
        unitPriceCents: centsFromBRL(item.priceText),
        lotNumber: item.lotNumber,
      }));
    if (!payloadItems.length)
      return notify("Adicione ao menos um produto com preço ao pedido.");
    setSaving(true);
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: Number(customerId),
          orderDate,
          deliveryDate,
          notes,
          items: payloadItems,
        }),
      });
      const data = await r.json();
      if (r.ok) {
        notify(`Pedido ${data.order.number} criado`);
        onCreated();
      } else notify(data.error || "Não foi possível criar o pedido");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Novo pedido" eyebrow="FLUXO DE VENDAS" onClose={onClose}>
      <form onSubmit={submit} className="ord-detail">
        <div className="ord-section">
          <header>
            <div>
              <h4>Dados do pedido</h4>
              <p>Cliente e datas do pedido.</p>
            </div>
          </header>
          <div className="ord-form-grid">
            <div className="ord-field span2">
              <label htmlFor="nc-customer">Cliente *</label>
              <select
                id="nc-customer"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Escolha o cliente</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                    {customer.document ? ` — ${customer.document}` : ""}
                  </option>
                ))}
              </select>
              {!customers.length && (
                <span className="hint">
                  Nenhum cliente ativo. Cadastre o cliente na aba Clientes.
                </span>
              )}
            </div>
            <div className="ord-field">
              <label htmlFor="nc-date">Data do pedido</label>
              <input
                id="nc-date"
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />
            </div>
            <div className="ord-field">
              <label htmlFor="nc-delivery">Entrega prevista</label>
              <input
                id="nc-delivery"
                type="date"
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="ord-section">
          <header>
            <div>
              <h4>Produtos do pedido</h4>
              <p>Escolha o produto do catálogo e informe quantidade e valor.</p>
            </div>
          </header>
          {items.map((item) => (
            <div
              className="ord-form-grid"
              style={{ marginBottom: 10 }}
              key={item.key}
            >
              <div className="ord-field span2">
                <label>Produto *</label>
                <select
                  value={item.productId}
                  onChange={(event) =>
                    patchItem(item.key, { productId: event.target.value })
                  }
                >
                  <option value="">Escolha o produto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.category})
                    </option>
                  ))}
                </select>
              </div>
              <div className="ord-field">
                <label>Qtd.</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(event) =>
                    patchItem(item.key, { quantity: event.target.value })
                  }
                />
              </div>
              <div className="ord-field">
                <label>Unid.</label>
                <select
                  value={item.unit}
                  onChange={(event) =>
                    patchItem(item.key, { unit: event.target.value })
                  }
                >
                  {units.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ord-field span2">
                <label>Preço unitário (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={item.priceText}
                  onChange={(event) =>
                    patchItem(item.key, { priceText: event.target.value })
                  }
                />
              </div>
              <div className="ord-field span2">
                <label>Lote (opcional)</label>
                <input
                  type="text"
                  placeholder="Número do lote"
                  value={item.lotNumber}
                  onChange={(event) =>
                    patchItem(item.key, { lotNumber: event.target.value })
                  }
                />
              </div>
              {items.length > 1 && (
                <div className="ord-field">
                  <button
                    type="button"
                    style={{
                      alignSelf: "end",
                      background: "none",
                      border: 0,
                      color: "#b32727",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                    onClick={() =>
                      setItems((list) =>
                        list.filter((row) => row.key !== item.key),
                      )
                    }
                  >
                    Remover produto
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              setItems((list) => [
                ...list,
                {
                  key: Date.now(),
                  productId: "",
                  quantity: "1",
                  unit: "L",
                  priceText: "",
                  lotNumber: "",
                },
              ])
            }
          >
            + Adicionar produto
          </button>
        </div>
        <div className="ord-section">
          <header>
            <div>
              <h4>Observações</h4>
              <p>Condições comerciais e instruções do pedido.</p>
            </div>
          </header>
          <div className="ord-field">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Frete, prazo de pagamento, instruções de entrega..."
            />
          </div>
        </div>
        <button
          type="submit"
          className="primary-button"
          disabled={saving}
          style={{ justifySelf: "start" }}
        >
          {saving ? "Criando..." : "Criar pedido"}
        </button>
      </form>
    </Modal>
  );
}

function OrderDetailModal({
  orderId,
  customers,
  canWrite,
  notify,
  onClose,
  onChanged,
}: {
  orderId: number;
  customers: Customer[];
  canWrite: boolean;
  notify: (message: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [full, setFull] = useState<OrderFull | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders?id=${orderId}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setFull(data);
    } catch {
      setError("Não foi possível carregar o pedido.");
    }
  }, [orderId]);
  useEffect(() => {
    load();
  }, [load]);
  const order = full?.order ?? null;
  const docs = full?.documents ?? [];
  const items = full?.items ?? [];
  const customer = customers.find((c) => c.id === order?.customerId);

  const [header, setHeader] = useState<{
    customerId: string;
    orderDate: string;
    deliveryDate: string;
    status: string;
    notes: string;
  } | null>(null);
  useEffect(() => {
    if (order && !header)
      setHeader({
        customerId: String(order.customerId),
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        status: order.status,
        notes: order.notes,
      });
  }, [order, header]);

  const saveHeader = async () => {
    if (!header) return;
    setBusy(true);
    try {
      const r = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, ...header, customerId: Number(header.customerId) }),
      });
      const data = await r.json();
      if (r.ok) {
        notify("Pedido atualizado");
        await load();
        onChanged();
      } else notify(data.error || "Não foi possível atualizar");
    } finally {
      setBusy(false);
    }
  };

  const download = (id: number, name: string) => {
    const win = window.open(`/api/order-docs?download=${id}`, "_blank", "noopener");
    if (!win) notify(name);
  };

  return (
    <Modal
      title={order ? `Pedido ${order.number}` : "Carregando pedido..."}
      eyebrow="FLUXO DE PEDIDO"
      onClose={onClose}
      wide
    >
      {!full ? (
        <div className="ord-empty">{error || "Carregando..."}</div>
      ) : (
        <div className="ord-detail">
          {order?.progress && <FlowSteps progress={order.progress} />}
          <div className="ord-section">
            <header>
              <div>
                <h4>Dados do pedido</h4>
                <p>
                  {customer
                    ? `${customer.companyName} — ${customer.document || "sem documento"}`
                    : "Cliente não encontrado"}
                </p>
              </div>
              <span className={`ord-status ${order?.status}`}>
                <span className="k" />
                {orderStatusLabel(order?.status ?? "")}
              </span>
            </header>
            {header && (
              <>
                <div className="ord-form-grid">
                  <div className="ord-field span2">
                    <label htmlFor="od-customer">Cliente</label>
                    <select
                      id="od-customer"
                      disabled={!canWrite}
                      value={header.customerId}
                      onChange={(event) =>
                        setHeader({ ...header, customerId: event.target.value })
                      }
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.companyName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ord-field">
                    <label htmlFor="od-date">Data do pedido</label>
                    <input
                      id="od-date"
                      type="date"
                      disabled={!canWrite}
                      value={header.orderDate}
                      onChange={(event) =>
                        setHeader({ ...header, orderDate: event.target.value })
                      }
                    />
                  </div>
                  <div className="ord-field">
                    <label htmlFor="od-delivery">Entrega prevista</label>
                    <input
                      id="od-delivery"
                      type="date"
                      disabled={!canWrite}
                      value={header.deliveryDate}
                      onChange={(event) =>
                        setHeader({ ...header, deliveryDate: event.target.value })
                      }
                    />
                  </div>
                  <div className="ord-field">
                    <label htmlFor="od-status">Situação</label>
                    <select
                      id="od-status"
                      disabled={!canWrite}
                      value={header.status}
                      onChange={(event) =>
                        setHeader({ ...header, status: event.target.value })
                      }
                    >
                      {orderStatuses.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ord-field span3">
                    <label htmlFor="od-notes">Observações</label>
                    <input
                      id="od-notes"
                      disabled={!canWrite}
                      value={header.notes}
                      onChange={(event) =>
                        setHeader({ ...header, notes: event.target.value })
                      }
                      placeholder="Condições comerciais, frete..."
                    />
                  </div>
                </div>
                {canWrite && (
                  <button
                    className="ghost-button"
                    style={{ marginTop: 12 }}
                    onClick={saveHeader}
                    disabled={busy}
                  >
                    Salvar dados do pedido
                  </button>
                )}
              </>
            )}
          </div>

          <div className="ord-section">
            <header>
              <div>
                <h4>Produtos do pedido</h4>
                <p>
                  {items.length} produto(s) · Total:{" "}
                  <b>{fmtBRL(order?.totalCents ?? 0)}</b>
                </p>
              </div>
              <button
                className="primary-button"
                onClick={() =>
                  window.open(
                    `/api/orders/dossier?orderId=${orderId}`,
                    "_blank",
                    "noopener",
                  )
                }
              >
                Gerar PDF do pedido
              </button>
            </header>
            <ItemsEditor
              orderId={orderId}
              initialItems={items}
              canWrite={canWrite}
              notify={notify}
              onSaved={() => {
                load();
                onChanged();
              }}
            />
          </div>

          <DocumentPipeline
            orderId={orderId}
            orderNumber={order?.number ?? ""}
            items={items}
            docs={docs}
            canWrite={canWrite}
            notify={notify}
            download={download}
            onChanged={() => {
              load();
              onChanged();
            }}
          />
        </div>
      )}
    </Modal>
  );
}

function ItemsEditor({
  orderId,
  initialItems,
  canWrite,
  notify,
  onSaved,
}: {
  orderId: number;
  initialItems: Item[];
  canWrite: boolean;
  notify: (message: string) => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [products, setProducts] = useState<ProductLight[]>([]);
  const [draft, setDraft] = useState<{
    productId: string;
    quantity: string;
    unit: string;
    priceText: string;
    lotNumber: string;
  }>({ productId: "", quantity: "1", unit: "L", priceText: "", lotNumber: "" });
  useEffect(() => setItems(initialItems), [initialItems]);
  useEffect(() => {
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.products)
          setProducts(
            data.products.map(
              (p: { id: number; name: string; category: string }) => ({
                id: p.id,
                name: p.name,
                category: p.category,
              }),
            ),
          );
      });
  }, []);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const payload = items.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
        lotNumber: item.lotNumber,
        notes: item.notes,
      }));
      if (draft.productId) {
        payload.push({
          productId: Number(draft.productId),
          quantity: Number(draft.quantity.replace(",", ".")),
          unit: draft.unit,
          unitPriceCents: centsFromBRL(draft.priceText),
          lotNumber: draft.lotNumber,
        });
      }
      const r = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, items: payload }),
      });
      const data = await r.json();
      if (r.ok) {
        notify("Produtos do pedido atualizados");
        setDraft({ productId: "", quantity: "1", unit: "L", priceText: "", lotNumber: "" });
        onSaved();
      } else notify(data.error || "Não foi possível salvar os produtos");
    } finally {
      setSaving(false);
    }
  };
  if (!canWrite)
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Lote</th>
              <th>Qtd.</th>
              <th>Valor unit.</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.productName}</strong>
                </td>
                <td>{item.lotNumber || "—"}</td>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>{fmtBRL(item.unitPriceCents)}</td>
                <td>{fmtBRL(item.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Qtd.</th>
              <th>Unid.</th>
              <th>Preço unit. (R$)</th>
              <th>Lote</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.productName}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    style={{ width: 80 }}
                    value={item.quantity}
                    onChange={(event) =>
                      setItems((list) =>
                        list.map((row) =>
                          row.id === item.id
                            ? { ...row, quantity: Number(event.target.value) }
                            : row,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    value={item.unit}
                    onChange={(event) =>
                      setItems((list) =>
                        list.map((row) =>
                          row.id === item.id
                            ? { ...row, unit: event.target.value }
                            : row,
                        ),
                      )
                    }
                  >
                    {units.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: 100 }}
                    value={BRLFromCents(item.unitPriceCents)}
                    onChange={(event) =>
                      setItems((list) =>
                        list.map((row) =>
                          row.id === item.id
                            ? {
                                ...row,
                                unitPriceCents: centsFromBRL(event.target.value),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    style={{ width: 110 }}
                    value={item.lotNumber}
                    onChange={(event) =>
                      setItems((list) =>
                        list.map((row) =>
                          row.id === item.id
                            ? { ...row, lotNumber: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </td>
                <td>{fmtBRL(item.lineTotalCents)}</td>
                <td>
                  <button
                    className="del"
                    title="Remover produto do pedido"
                    onClick={() =>
                      setItems((list) =>
                        list.filter((row) => row.id !== item.id),
                      )
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ord-form-grid" style={{ marginTop: 12 }}>
        <div className="ord-field span2">
          <label>Adicionar produto</label>
          <select
            value={draft.productId}
            onChange={(event) =>
              setDraft({ ...draft, productId: event.target.value })
            }
          >
            <option value="">Escolha o produto do catálogo</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.category})
              </option>
            ))}
          </select>
        </div>
        <div className="ord-field">
          <label>Qtd.</label>
          <input
            type="text"
            inputMode="decimal"
            value={draft.quantity}
            onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
          />
        </div>
        <div className="ord-field">
          <label>Preço (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={draft.priceText}
            onChange={(event) => setDraft({ ...draft, priceText: event.target.value })}
          />
        </div>
        <div className="ord-field">
          <label>Lote</label>
          <input
            type="text"
            value={draft.lotNumber}
            onChange={(event) => setDraft({ ...draft, lotNumber: event.target.value })}
          />
        </div>
        <div className="ord-field">
          <label>Unid.</label>
          <select
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        className="ghost-button"
        style={{ marginTop: 12 }}
        onClick={save}
        disabled={saving}
      >
        {saving ? "Salvando..." : "Salvar produtos do pedido"}
      </button>
    </>
  );
}

function DocumentPipeline({
  orderId,
  orderNumber,
  items,
  docs,
  canWrite,
  notify,
  download,
  onChanged,
}: {
  orderId: number;
  orderNumber: string;
  items: Item[];
  docs: Doc[];
  canWrite: boolean;
  notify: (message: string) => void;
  download: (id: number, name: string) => void;
  onChanged: () => void;
}) {
  const active = docs.filter((d) => d.status === "active");
  const itemName = (itemId: number | null) =>
    items.find((i) => i.id === itemId)?.productName ?? null;
  const groups: Record<string, Doc[]> = {
    nf: active.filter((d) => d.kind === "nf"),
    boleto: active.filter((d) => d.kind === "boleto"),
    laudo: active.filter((d) => d.kind === "laudo"),
    ficha: active.filter((d) => d.kind === "ficha"),
  };

  const [kind, setKind] = useState("nf");
  const [orderItemId, setOrderItemId] = useState("");
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const metaFields: Record<string, { key: string; label: string; placeholder: string }[]> = {
    nf: [
      { key: "numero", label: "Nº da NF", placeholder: "Ex.: 008741" },
      { key: "serie", label: "Série", placeholder: "Ex.: 1" },
      {
        key: "chaveAcesso",
        label: "Chave de acesso (44 dígitos)",
        placeholder: "Digite ou cole a chave",
      },
      { key: "dataEmissao", label: "Data de emissão", placeholder: "DD/MM/AAAA" },
      { key: "valor", label: "Valor (R$)", placeholder: "0,00" },
    ],
    boleto: [
      { key: "numero", label: "Nº do título", placeholder: "Ex.: BOL-98411" },
      { key: "vencimento", label: "Vencimento", placeholder: "DD/MM/AAAA" },
      { key: "valor", label: "Valor (R$)", placeholder: "0,00" },
      {
        key: "linhaDigitavel",
        label: "Linha digitável",
        placeholder: "Código de barras do boleto",
      },
    ],
    laudo: [
      { key: "numero", label: "Nº do laudo", placeholder: "Ex.: LA-2026-088" },
      { key: "data", label: "Data do laudo", placeholder: "DD/MM/AAAA" },
      { key: "lote", label: "Lote do produto", placeholder: "Número do lote" },
    ],
    ficha: [
      {
        key: "numeroOnu",
        label: "Nº ONU",
        placeholder: "Ex.: 1791",
      },
      { key: "data", label: "Data da ficha", placeholder: "DD/MM/AAAA" },
    ],
  };

  const reset = () => {
    setKind("nf");
    setOrderItemId("");
    setMeta({});
    setFile(null);
  };
  const upload = async () => {
    if (!file) return notify("Selecione o arquivo do documento.");
    if ((kind === "laudo" || kind === "ficha") && !orderItemId)
      return notify("Escolha o produto do pedido ao qual o documento pertence.");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("orderId", String(orderId));
      form.append("kind", kind);
      if (orderItemId) form.append("orderItemId", orderItemId);
      form.append("metadata", JSON.stringify(meta));
      form.append("notes", "");
      form.append("file", file);
      const r = await fetch("/api/order-docs", { method: "POST", body: form });
      const data = await r.json();
      if (r.ok) {
        notify(`${data.document.kindLabel} anexada ao pedido`);
        reset();
        onChanged();
      } else notify(data.error || "Não foi possível anexar o documento");
    } finally {
      setUploading(false);
    }
  };
  const archive = async (id: number, name: string) => {
    const r = await fetch("/api/order-docs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "archived" }),
    });
    const data = await r.json();
    if (r.ok) {
      notify(`"${name}" arquivado (fora do dossiê)`);
      onChanged();
    } else notify(data.error || "Não foi possível arquivar o documento");
  };

  return (
    <div className="ord-section">
      <header>
        <div>
          <h4>Documentos do fluxo</h4>
          <p>
            Ordem do dossiê: Nota fiscal → Boleto → Laudos → Fichas de risco.
            Arquivos XML e imagens não entram no PDF montado (ficam no pedido).
          </p>
        </div>
      </header>
      <div className="ord-docs">
        {flowKeys.map((key) => {
          const group = groups[key];
          const label =
            key === "nf"
              ? "Nota fiscal"
              : key === "boleto"
                ? "Boleto"
                : key === "laudo"
                  ? "Laudos (por produto)"
                  : "Fichas de risco (por produto)";
          return (
            <div key={key}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "14px 0 6px",
                }}
              >
                <strong style={{ fontSize: 13, color: "#1c2434" }}>{label}</strong>
                <span style={{ fontSize: 12, color: "#7b8494" }}>
                  {group.length
                    ? group.length === 1
                      ? "1 arquivo"
                      : `${group.length} arquivos`
                    : "sem arquivo"}
                </span>
              </div>
              {group.length ? (
                group.map((doc) => (
                  <div className="ord-doc" key={doc.id}>
                    <span className={`badge ${doc.kind}`}>
                      {flowShort[doc.kind] ?? doc.kindLabel}
                    </span>
                    <div className="name">
                      {doc.fileName}
                      <small>
                        {itemName(doc.orderItemId) ??
                          (doc.kind === "nf" || doc.kind === "boleto"
                            ? "Pedido inteiro"
                            : "Produto removido")}
                        {doc.metadata.numero ? ` · Nº ${doc.metadata.numero}` : ""}
                        {doc.metadata.vencimento
                          ? ` · vence ${doc.metadata.vencimento}`
                          : ""}
                        {doc.metadata.numeroOnu
                          ? ` · ONU ${doc.metadata.numeroOnu}`
                          : ""}
                        {doc.metadata.chaveAcesso
                          ? ` · chave ${doc.metadata.chaveAcesso}`
                          : ""}
                        {" · "}
                        {fmtBytes(doc.sizeBytes)}
                      </small>
                    </div>
                    <button onClick={() => download(doc.id, doc.fileName)}>
                      Baixar
                    </button>
                    {canWrite && (
                      <button
                        className="danger"
                        title="Arquivar (remove do dossiê)"
                        onClick={() => archive(doc.id, doc.fileName)}
                      >
                        Arquivar
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 12.5, color: "#9aa1ad", margin: "2px 0 0" }}>
                  Nenhum arquivo anexado ainda.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {canWrite && (
        <>
          <div
            style={{
              borderTop: "1px dashed #d7dde4",
              margin: "18px 0 12px",
              paddingTop: 12,
            }}
          >
            <strong style={{ fontSize: 13, color: "#1c2434" }}>
              Anexar novo documento
            </strong>
            <p style={{ fontSize: 12, color: "#7b8494", margin: "2px 0 10px" }}>
              Anexar documento de {orderNumber}
            </p>
            <div className="ord-form-grid">
              <div className="ord-field">
                <label htmlFor="doc-kind">Tipo de documento</label>
                <select
                  id="doc-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  <option value="nf">Nota fiscal</option>
                  <option value="boleto">Boleto</option>
                  <option value="laudo">Laudo</option>
                  <option value="ficha">Ficha de risco</option>
                </select>
              </div>
              {(kind === "laudo" || kind === "ficha") && (
                <div className="ord-field span2">
                  <label htmlFor="doc-item">Produto do pedido *</label>
                  <select
                    id="doc-item"
                    value={orderItemId}
                    onChange={(event) => setOrderItemId(event.target.value)}
                  >
                    <option value="">Escolha o produto</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.productName}
                        {item.lotNumber ? ` — lote ${item.lotNumber}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!items.length && (kind === "laudo" || kind === "ficha") && (
                <p className="span4" style={{ fontSize: 12, color: "#b0562e" }}>
                  Adicione produtos ao pedido para anexar laudos e fichas de
                  risco por produto.
                </p>
              )}
              {(metaFields[kind] ?? []).map((field) => (
                <div className="ord-field" key={field.key}>
                  <label htmlFor={`doc-${field.key}`}>{field.label}</label>
                  <input
                    id={`doc-${field.key}`}
                    placeholder={field.placeholder}
                    value={meta[field.key] ?? ""}
                    onChange={(event) =>
                      setMeta({ ...meta, [field.key]: event.target.value })
                    }
                  />
                </div>
              ))}
              <div className="ord-field span2">
                <label htmlFor="doc-file">Arquivo (PDF, imagem ou XML)</label>
                <input
                  id="doc-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/tiff,application/xml,text/xml"
                  onChange={(event) =>
                    setFile(event.target.files?.[0] ?? null)
                  }
                />
                <span className="hint">Máximo 20 MB.</span>
              </div>
            </div>
            <button
              type="button"
              className="primary-button"
              style={{ marginTop: 12 }}
              onClick={upload}
              disabled={uploading}
            >
              {uploading ? "Enviando..." : "Anexar documento"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CustomersTab({
  customers,
  canWrite,
  notify,
  onChanged,
}: {
  customers: Customer[];
  canWrite: boolean;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);
  const visible = customers.filter((c) =>
    `${c.companyName} ${c.tradingName} ${c.document} ${c.city} ${c.state}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="panel archive-panel">
      <div className="section-title">
        <div>
          <h2>Cadastro de clientes</h2>
          <p>
            Dados fiscais e de contato completos — usados no pedido e no PDF
            final.
          </p>
        </div>
        {canWrite && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Novo cliente
          </button>
        )}
      </div>
      <div className="archive-search">
        <span>⌕</span>
        <input
          aria-label="Buscar clientes"
          placeholder="Buscar por nome, CNPJ/CPF ou cidade..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {visible.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Documento</th>
                <th>Contato</th>
                <th>Cidade / UF</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.companyName}</strong>
                    {customer.tradingName && (
                      <small> {customer.tradingName}</small>
                    )}
                  </td>
                  <td>{customer.document || "—"}</td>
                  <td>
                    {customer.contactName || "—"}
                    {customer.contactPhone && (
                      <small> · {customer.contactPhone}</small>
                    )}
                  </td>
                  <td>
                    {customer.city
                      ? `${customer.city}${customer.state ? ` / ${customer.state}` : ""}`
                      : "—"}
                  </td>
                  <td>
                    <span className={`ord-status ${customer.status}`}>
                      <span className="k" />
                      {customer.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td>
                    <button className="ghost-button" onClick={() => setEditing(customer)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ord-empty">
          {customers.length
            ? "Nenhum cliente corresponde à busca."
            : "Nenhum cliente cadastrado ainda."}
        </div>
      )}
      {(creating || editing) && (
        <CustomerModal
          customer={editing}
          notify={notify}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function CustomerModal({
  customer,
  notify,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const empty = {
    companyName: "",
    tradingName: "",
    document: "",
    stateRegistration: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    zipCode: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    segment: "",
    lgpdBasis: "Execução de contrato",
    status: "active",
    notes: "",
  };
  const [form, setForm] = useState<typeof empty>(
    customer
      ? {
          companyName: customer.companyName,
          tradingName: customer.tradingName,
          document: customer.document,
          stateRegistration: customer.stateRegistration,
          street: customer.street,
          number: customer.number,
          complement: customer.complement,
          district: customer.district,
          city: customer.city,
          state: customer.state,
          zipCode: customer.zipCode,
          contactName: customer.contactName,
          contactEmail: customer.contactEmail,
          contactPhone: customer.contactPhone,
          segment: customer.segment,
          lgpdBasis: customer.lgpdBasis,
          status: customer.status,
          notes: customer.notes,
        }
      : empty,
  );
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof empty) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm({ ...form, [key]: event.target.value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.companyName.trim())
      return notify("Informe o nome / razão social do cliente.");
    setSaving(true);
    try {
      const r = await fetch("/api/customers", {
        method: customer ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(customer ? { id: customer.id } : {}) }),
      });
      const data = await r.json();
      if (r.ok) {
        notify(customer ? "Cliente atualizado" : "Cliente cadastrado");
        onSaved();
      } else notify(data.error || "Não foi possível salvar o cliente");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={customer ? "Editar cliente" : "Novo cliente"}
      eyebrow="CADASTRO DE CLIENTES"
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="ord-detail">
        <div className="ord-section">
          <header>
            <div>
              <h4>Identificação</h4>
              <p>Dados principais usados no pedido e nos documentos.</p>
            </div>
          </header>
          <div className="ord-form-grid">
            <div className="ord-field span3">
              <label htmlFor="c-name">Nome / razão social *</label>
              <input id="c-name" value={form.companyName} onChange={set("companyName")} />
            </div>
            <div className="ord-field">
              <label htmlFor="c-status">Situação</label>
              <select id="c-status" value={form.status} onChange={set("status")}>
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            </div>
            <div className="ord-field">
              <label htmlFor="c-trading">Nome fantasia</label>
              <input id="c-trading" value={form.tradingName} onChange={set("tradingName")} />
            </div>
            <div className="ord-field">
              <label htmlFor="c-doc">CNPJ / CPF</label>
              <input
                id="c-doc"
                placeholder="00.000.000/0000-00"
                value={form.document}
                onChange={set("document")}
              />
            </div>
            <div className="ord-field">
              <label htmlFor="c-ie">Inscrição estadual</label>
              <input id="c-ie" value={form.stateRegistration} onChange={set("stateRegistration")} />
            </div>
            <div className="ord-field">
              <label htmlFor="c-segment">Segmento</label>
              <select id="c-segment" value={form.segment} onChange={set("segment")}>
                <option value="">Selecione</option>
                {customerSegments.map((segment) => (
                  <option key={segment} value={segment}>
                    {segment}
                  </option>
                ))}
              </select>
            </div>
            <div className="ord-field">
              <label htmlFor="c-lgpd">Base legal dos dados (LGPD)</label>
              <select id="c-lgpd" value={form.lgpdBasis} onChange={set("lgpdBasis")}>
                {lgpdBasis.map((basis) => (
                  <option key={basis} value={basis}>
                    {basis}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="ord-section">
          <header>
            <div>
              <h4>Endereço</h4>
              <p>Usado no cabeçalho dos documentos do pedido.</p>
            </div>
          </header>
          <div className="ord-form-grid">
            <div className="ord-field span3">
              <label htmlFor="c-street">Logradouro</label>
              <input id="c-street" value={form.street} onChange={set("street")} />
            </div>
            <div className="ord-field">
              <label htmlFor="c-num">Número</label>
              <input id="c-num" value={form.number} onChange={set("number")} />
            </div>
            <div className="ord-field span2">
              <label htmlFor="c-comp">Complemento</label>
              <input id="c-comp" value={form.complement} onChange={set("complement")} />
            </div>
            <div className="ord-field span2">
              <label htmlFor="c-district">Bairro</label>
              <input id="c-district" value={form.district} onChange={set("district")} />
            </div>
            <div className="ord-field span2">
              <label htmlFor="c-city">Cidade</label>
              <input id="c-city" value={form.city} onChange={set("city")} />
            </div>
            <div className="ord-field">
              <label htmlFor="c-state">UF</label>
              <input
                id="c-state"
                maxLength={2}
                value={form.state}
                onChange={set("state")}
                placeholder="SP"
              />
            </div>
            <div className="ord-field">
              <label htmlFor="c-zip">CEP</label>
              <input id="c-zip" value={form.zipCode} onChange={set("zipCode")} />
            </div>
          </div>
        </div>
        <div className="ord-section">
          <header>
            <div>
              <h4>Contato</h4>
              <p>Pessoa de referência na compra e no recebimento.</p>
            </div>
          </header>
          <div className="ord-form-grid">
            <div className="ord-field">
              <label htmlFor="c-contact">Contato principal</label>
              <input id="c-contact" value={form.contactName} onChange={set("contactName")} />
            </div>
            <div className="ord-field">
              <label htmlFor="c-phone">Telefone / WhatsApp</label>
              <input id="c-phone" value={form.contactPhone} onChange={set("contactPhone")} />
            </div>
            <div className="ord-field span2">
              <label htmlFor="c-email">E-mail</label>
              <input id="c-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} />
            </div>
            <div className="ord-field span4">
              <label htmlFor="c-notes">Observações</label>
              <textarea id="c-notes" value={form.notes} onChange={set("notes")} />
            </div>
          </div>
        </div>
        <button
          type="submit"
          className="primary-button"
          disabled={saving}
          style={{ justifySelf: "start" }}
        >
          {saving ? "Salvando..." : customer ? "Salvar alterações" : "Cadastrar cliente"}
        </button>
      </form>
    </Modal>
  );
}
