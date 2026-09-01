"use client";
import { useCallback, useEffect, useState } from "react";

type Product = {
  id: number;
  name: string;
  category: string;
  concentration: string;
  unNumber: string;
  hazardClass: string;
  signalWord: string;
  hPhrases: string[];
  pPhrases: string[];
  controlled: boolean;
  controlAgency: string;
  flammable: boolean;
  storage: string;
  status: string;
  notes: string;
  totalLots: number;
  totalQuantity: number;
  nextExpiry: number | null;
  fispqStatus: string | null;
  fispqValidity: number | null;
  alert: string;
};
type Lot = {
  id: number;
  productId: number;
  productName: string;
  lotNumber: string;
  manufactureDate: string;
  expiryDate: string;
  quantity: number;
  unit: string;
  location: string;
  notes: string;
};
type Fispq = {
  id: number;
  productId: number;
  productName: string;
  version: string;
  issueDate: string;
  validityDate: string;
  fileName: string;
  fileSize: number;
  status: string;
  notes: string;
};
type License = {
  id: number;
  licenseType: string;
  issuingAgency: string;
  number: string;
  validityDate: string;
  scope: string;
  status: string;
  effectiveStatus: string;
  notes: string;
};
type Supplier = {
  id: number;
  companyName: string;
  cnpj: string;
  stateRegistration: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  certificates: { type: string; expiry: string }[];
  status: string;
  notes: string;
};

const categories = [
  "Saneantes",
  "Tratamento de água",
  "Limpeza e higiene",
  "Matéria-prima",
  "Embalagem",
  "Outros",
];
const hazardClasses = [
  "Corrosivo",
  "Inflamável",
  "Tóxico",
  "Irritante",
  "Perigoso ao meio ambiente",
  "Oxidante",
  "Gás sob pressão",
  "Perigoso à saúde",
  "Explosivo",
];
const agencies = [
  "Polícia Federal",
  "Exército",
  "Anvisa",
  "IBAMA",
  "Corpo de Bombeiros",
  "Outro",
];
const licenseTypes = [
  "Alvará de funcionamento",
  "Licença ambiental",
  "SIPROQUIM",
  "Licença do Corpo de Bombeiros",
  "Licença sanitária",
  "Outra",
];
const units = ["un", "kg", "g", "L", "mL", "cx", "fardo", "bombona", "tambor"];
const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  review: "A revisar",
  indexed: "Classificado",
  validated: "Validado",
  archived: "Arquivado",
  expired: "Vencido",
  rejected: "Rejeitado",
};

const alertClass = (alert: string) =>
  alert === ""
    ? "ok"
    : /vencida|pendente|vencido|urgente/.test(alert)
      ? "danger"
      : "warn";
const fmtDate = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "";
const daysUntil = (date: string) =>
  date
    ? Math.ceil(
        (new Date(date).getTime() - Date.now()) / (1000 * 86400),
      )
    : null;

function Modal({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
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
        className="product-modal-card"
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
        {children}
      </div>
    </div>
  );
}

export default function ProductCenter({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [productSummary, setProductSummary] = useState({
    total: 0,
    alerts: 0,
    controlled: 0,
    flammable: 0,
    noFispq: 0,
  });
  const [loading, setLoading] = useState(true);

  const loadProducts = useCallback(async () => {
    try {
      const r = await fetch("/api/products");
      if (!r.ok) throw new Error();
      const data = await r.json();
      setProducts(data.products);
      setProductSummary(data.summary);
    } catch {
      notify("Não foi possível carregar os produtos");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const tabs = [
    ["products", "Produtos", `${productSummary.total}`],
    ["lots", "Lotes e validade", ""],
    ["fispq", "FISPQ", `${productSummary.alerts}`],
    ["licenses", "Licenças", ""],
    ["suppliers", "Fornecedores", ""],
    ["reports", "Relatórios", ""],
  ] as const;

  return (
    <>
      <section className="migration-hero">
        <div>
          <p className="eyebrow">PRODUTOS E CONFORMIDADE REGULATÓRIA</p>
          <h2>Cadastro estruturado, validade e FISPQ em dia</h2>
          <p>
            Produtos controlados, lotes com vencimento, fichas de segurança e
            licenças — tudo com alerta antes do prazo.
          </p>
        </div>
      </section>
      <section className="migration-stats product-stats">
        <article>
          <span>Produtos ativos</span>
          <strong>{productSummary.total}</strong>
        </article>
        <article className={productSummary.alerts ? "alert" : ""}>
          <span>Precisam de atenção</span>
          <strong>{productSummary.alerts}</strong>
        </article>
        <article>
          <span>Controlados</span>
          <strong>{productSummary.controlled}</strong>
        </article>
        <article>
          <span>Inflamáveis (NR-20)</span>
          <strong>{productSummary.flammable}</strong>
        </article>
      </section>
      <div className="product-tabs" role="tablist" aria-label="Módulos de produtos">
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
      ) : (
        <>
          {tab === "products" && (
            <ProductsTab products={products} onChanged={loadProducts} notify={notify} />
          )}
          {tab === "lots" && (
            <LotsTab products={products} notify={notify} />
          )}
          {tab === "fispq" && (
            <FispqTab products={products} onFispqChanged={loadProducts} notify={notify} />
          )}
          {tab === "licenses" && <LicensesTab notify={notify} />}
          {tab === "suppliers" && <SuppliersTab notify={notify} />}
          {tab === "reports" && <ReportsTab notify={notify} />}
        </>
      )}
    </>
  );
}

function ReportsTab({ notify }: { notify: (message: string) => void }) {
  const open = (url: string) => {
    window.open(url, "_blank", "noopener");
  };
  const reports = [
    {
      title: "Estoque — vencimento em 60 dias",
      description:
        "Lotes com validade vencida ou próxima, ordenados pelo vencimento mais próximo.",
      url: "/api/reports?type=estoque",
      tone: "amber",
      restricted: false,
    },
    {
      title: "Produtos controlados — prestação de contas",
      description:
        "Estoque e lotes de produtos sujeitos a órgão fiscalizador, para apresentação à Polícia Federal, Exército ou órgão competente.",
      url: "/api/reports?type=controlados",
      tone: "red",
      restricted: true,
    },
    {
      title: "Ficha consolidada do produto",
      description:
        "Selecione um produto na aba Produtos e use o botão “Ficha PDF” na linha para gerar a ficha completa (dados + FISPQ + lotes).",
      url: "",
      tone: "green",
      restricted: false,
    },
  ];
  return (
    <section className="panel archive-panel">
      <div className="section-title">
        <div>
          <h2>Relatórios e exportação</h2>
          <p>PDFs gerados a partir dos dados estruturados — sempre sincronizados com o sistema.</p>
        </div>
      </div>
      <div className="report-grid">
        {reports.map((report) => (
          <article className="report-card" key={report.title}>
            <span className={`report-icon ${report.tone}`}>PDF</span>
            <div>
              <strong>{report.title}</strong>
              <small>{report.description}</small>
            </div>
            {report.url && (
              <button className="primary-button" onClick={() => open(report.url)}>
                Baixar PDF
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ProductsTab({
  products,
  onChanged,
  notify,
}: {
  products: Product[];
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const visible = products.filter((product) =>
    `${product.name} ${product.category} ${product.unNumber} ${product.hazardClass}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      hPhrases = String(form.get("hPhrases") || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      pPhrases = String(form.get("pPhrases") || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      controlled = form.get("controlled") === "on",
      flammable = form.get("flammable") === "on",
      payload = {
        ...(editing ? { id: editing.id } : {}),
        name: String(form.get("name") || ""),
        category: String(form.get("category") || ""),
        concentration: String(form.get("concentration") || ""),
        unNumber: String(form.get("unNumber") || ""),
        hazardClass: String(form.get("hazardClass") || ""),
        signalWord: String(form.get("signalWord") || ""),
        hPhrases,
        pPhrases,
        controlled,
        controlAgency: String(form.get("controlAgency") || ""),
        flammable,
        storage: String(form.get("storage") || ""),
        status: String(form.get("status") || "active"),
        notes: String(form.get("notes") || ""),
      };
    const r = await fetch("/api/products", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (r.ok) {
      setEditing(null);
      setCreating(false);
      notify(editing ? "Produto atualizado" : "Produto cadastrado");
      await onChanged();
    } else notify(data.error || "Não foi possível salvar o produto");
  };
  return (
    <>
      <section className="panel archive-panel">
        <div className="section-title">
          <div>
            <h2>Catálogo de produtos</h2>
            <p>Dados regulatórios estruturados — não texto livre.</p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Novo produto
          </button>
        </div>
        <div className="archive-search">
          <span>⌕</span>
          <input
            aria-label="Buscar produtos"
            placeholder="Buscar por nome, categoria, nº ONU..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Controle</th>
                  <th>FISPQ</th>
                  <th>Estoque</th>
                  <th>Próx. validade</th>
                  <th>Alerta</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <small>
                        {[product.concentration, product.unNumber]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </small>
                    </td>
                    <td>{product.category}</td>
                    <td>
                      {product.controlled ? (
                        <span className="compliance-tag controlled">
                          Controlado · {product.controlAgency}
                        </span>
                      ) : (
                        "—"
                      )}
                      {product.flammable ? (
                        <span className="compliance-tag flammable">NR-20</span>
                      ) : null}
                    </td>
                    <td>
                      {product.fispqStatus === "active" ? (
                        <span
                          className={`record-status ${
                            product.fispqValidity &&
                            product.fispqValidity * 1000 < Date.now()
                              ? "pending"
                              : "active"
                          }`}
                        >
                          {product.fispqValidity
                            ? `Vigente até ${fmtDate(product.fispqValidity)}`
                            : "Vigente"}
                        </span>
                      ) : (
                        <span className="record-status archived">
                          {product.fispqStatus ?? "Sem FISPQ"}
                        </span>
                      )}
                    </td>
                    <td>
                      {product.totalLots ? (
                        <strong>{product.totalQuantity}</strong>
                      ) : (
                        "—"
                      )}
                      <small>{product.totalLots} lote(s)</small>
                    </td>
                    <td>{product.nextExpiry ? fmtDate(product.nextExpiry) : "—"}</td>
                    <td>
                      {product.alert ? (
                        <span className={`alert-badge ${alertClass(product.alert)}`}>
                          {product.alert}
                        </span>
                      ) : (
                        <span className="alert-badge ok">Em dia</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="edit"
                          onClick={() =>
                            window.open(
                              `/api/reports?type=ficha&productId=${product.id}`,
                              "_blank",
                              "noopener",
                            )
                          }
                        >
                          Ficha PDF
                        </button>
                        <button className="edit" onClick={() => setEditing(product)}>
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>▤</span>
            <h3>Cadastre o primeiro produto</h3>
            <p>Comece pelo catálogo e depois registre lotes e FISPQ.</p>
          </div>
        )}
      </section>
      {(creating || editing) && (
        <Modal
          eyebrow={editing ? "FICHA DO PRODUTO" : "NOVO PRODUTO"}
          title={editing ? `Editar ${editing.name}` : "Cadastrar produto"}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <div className="scan-fields">
              <label className="full">
                Nome do produto
                <input name="name" required defaultValue={editing?.name} />
              </label>
              <label>
                Categoria
                <select name="category" defaultValue={editing?.category ?? "Outros"}>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Concentração / apresentação
                <input
                  name="concentration"
                  placeholder="Ex.: 50%, 1L"
                  defaultValue={editing?.concentration}
                />
              </label>
              <label>
                Nº ONU
                <input
                  name="unNumber"
                  placeholder="Ex.: 1823"
                  defaultValue={editing?.unNumber}
                />
              </label>
              <label>
                Classe de perigo (GHS)
                <select name="hazardClass" defaultValue={editing?.hazardClass ?? ""}>
                  <option value="">Selecione</option>
                  {hazardClasses.map((hazard) => (
                    <option key={hazard}>{hazard}</option>
                  ))}
                </select>
              </label>
              <label>
                Palavra de advertência
                <select name="signalWord" defaultValue={editing?.signalWord ?? ""}>
                  <option value="">Selecione</option>
                  <option>Perigo</option>
                  <option>Atenção</option>
                </select>
              </label>
              <label className="check-field">
                <input
                  name="controlled"
                  type="checkbox"
                  defaultChecked={editing?.controlled}
                />
                Produto controlado
              </label>
              <label>
                Órgão fiscalizador
                <select name="controlAgency" defaultValue={editing?.controlAgency ?? ""}>
                  <option value="">Selecione</option>
                  {agencies.map((agency) => (
                    <option key={agency}>{agency}</option>
                  ))}
                </select>
              </label>
              <label className="check-field">
                <input
                  name="flammable"
                  type="checkbox"
                  defaultChecked={editing?.flammable}
                />
                Inflamável (NR-20)
              </label>
              <label>
                Armazenamento
                <input
                  name="storage"
                  placeholder="Ex.: Área de inflamáveis"
                  defaultValue={editing?.storage}
                />
              </label>
              <label>
                Situação
                <select name="status" defaultValue={editing?.status ?? "active"}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
              <label className="full">
                Frases H (uma por linha)
                <textarea
                  name="hPhrases"
                  rows={3}
                  placeholder="Ex.: H314 – Provoca queimaduras..."
                  defaultValue={editing?.hPhrases.join("\n")}
                />
              </label>
              <label className="full">
                Frases P (uma por linha)
                <textarea
                  name="pPhrases"
                  rows={3}
                  placeholder="Ex.: P280 – Use luvas de proteção..."
                  defaultValue={editing?.pPhrases.join("\n")}
                />
              </label>
              <label className="full">
                Observações
                <textarea name="notes" rows={2} defaultValue={editing?.notes} />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button">Salvar produto</button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

function LotsTab({
  products,
  notify,
}: {
  products: Product[];
  notify: (message: string) => void;
}) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    expired: 0,
    expiringSoon: 0,
    totalQuantity: 0,
  });
  const [productFilter, setProductFilter] = useState("");
  const [editing, setEditing] = useState<Lot | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestion, setSuggestion] = useState<Lot[] | null>(null);
  const load = async () => {
    const r = await fetch("/api/lots");
    if (!r.ok) return notify("Não foi possível carregar os lotes");
    const data = await r.json();
    setLots(data.lots);
    setSummary(data.summary);
  };
  useEffect(() => {
    load();
  }, []);
  const askSuggestion = async (productId: number) => {
    const r = await fetch(`/api/lots?suggest=${productId}`);
    if (!r.ok) return notify("Não foi possível calcular a sugestão");
    const data = await r.json();
    setSuggestion(data.suggestion);
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      payload = {
        ...(editing ? { id: editing.id } : {}),
        productId: Number(form.get("productId")),
        lotNumber: String(form.get("lotNumber") || ""),
        manufactureDate: String(form.get("manufactureDate") || ""),
        expiryDate: String(form.get("expiryDate") || ""),
        quantity: Number(form.get("quantity")) || 0,
        unit: String(form.get("unit") || "un"),
        location: String(form.get("location") || ""),
        notes: String(form.get("notes") || ""),
      };
    const r = await fetch("/api/lots", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (r.ok) {
      setEditing(null);
      setCreating(false);
      setSuggestion(null);
      notify(editing ? "Lote atualizado" : "Lote cadastrado");
      await load();
    } else notify(data.error || "Não foi possível salvar o lote");
  };
  const visible = lots.filter(
    (lot) => !productFilter || lot.productId === Number(productFilter),
  );
  return (
    <>
      <section className="panel archive-panel">
        <div className="section-title">
          <div>
            <h2>Lotes e validade</h2>
            <p>Saída sugerida pelo vencimento mais próximo (FEFO).</p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Novo lote
          </button>
        </div>
        <div className="archive-search">
          <span>⌕</span>
          <select
            aria-label="Filtrar por produto"
            value={productFilter}
            onChange={(event) => setProductFilter(event.target.value)}
          >
            <option value="">Todos os produtos</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <button
            className="secondary-button"
            disabled={!productFilter}
            onClick={() => askSuggestion(Number(productFilter))}
          >
            Sugerir saída (FEFO)
          </button>
        </div>
        {suggestion && (
          <div className="fefo-callout">
            <strong>Ordem sugerida de saída</strong>
            <ol>
              {suggestion.map((lot) => (
                <li key={lot.id}>
                  {lot.lotNumber} — {lot.quantity} {lot.unit} — vence{" "}
                  {lot.expiryDate || "sem data"}
                </li>
              ))}
              {!suggestion.length && <li>Nenhum lote disponível com validade vigente.</li>}
            </ol>
          </div>
        )}
        {visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Lote</th>
                  <th>Fabricação</th>
                  <th>Validade</th>
                  <th>Quantidade</th>
                  <th>Localização</th>
                  <th>Situação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((lot) => {
                  const days = daysUntil(lot.expiryDate);
                  return (
                    <tr key={lot.id}>
                      <td>
                        <strong>{lot.productName}</strong>
                      </td>
                      <td>{lot.lotNumber}</td>
                      <td>{lot.manufactureDate || "—"}</td>
                      <td>{lot.expiryDate || "—"}</td>
                      <td>
                        <strong>
                          {lot.quantity} {lot.unit}
                        </strong>
                      </td>
                      <td>{lot.location || "—"}</td>
                      <td>
                        {days === null ? (
                          <span className="record-status archived">Sem validade</span>
                        ) : days < 0 ? (
                          <span className="record-status pending">Vencido</span>
                        ) : days <= 30 ? (
                          <span className="record-status pending">
                            Vence em {days}d
                          </span>
                        ) : (
                          <span className="record-status active">Vigente</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="edit" onClick={() => setEditing(lot)}>
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>▤</span>
            <h3>Nenhum lote cadastrado</h3>
            <p>Registre a entrada dos produtos com data de validade.</p>
          </div>
        )}
      </section>
      {(creating || editing) && (
        <Modal
          eyebrow="CONTROLE DE LOTE"
          title={editing ? `Editar lote ${editing.lotNumber}` : "Cadastrar lote"}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <div className="scan-fields">
              <label className="full">
                Produto
                <select
                  name="productId"
                  required
                  defaultValue={editing?.productId ?? ""}
                >
                  <option value="" disabled>
                    Selecione o produto
                  </option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Número do lote
                <input name="lotNumber" required defaultValue={editing?.lotNumber} />
              </label>
              <label>
                Fabricação
                <input
                  name="manufactureDate"
                  type="date"
                  defaultValue={editing?.manufactureDate}
                />
              </label>
              <label>
                Validade
                <input
                  name="expiryDate"
                  type="date"
                  required
                  defaultValue={editing?.expiryDate}
                />
              </label>
              <label>
                Quantidade
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  defaultValue={editing?.quantity ?? 0}
                />
              </label>
              <label>
                Unidade
                <select name="unit" defaultValue={editing?.unit ?? "un"}>
                  {units.map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              <label>
                Localização
                <input
                  name="location"
                  placeholder="Ex.: Depósito B, prateleira 3"
                  defaultValue={editing?.location}
                />
              </label>
              <label className="full">
                Observações
                <textarea name="notes" rows={2} defaultValue={editing?.notes} />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button">Salvar lote</button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

function FispqTab({
  products,
  onFispqChanged,
  notify,
}: {
  products: Product[];
  onFispqChanged: () => void;
  notify: (message: string) => void;
}) {
  const [fispqs, setFispqs] = useState<Fispq[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    expired: 0,
    expiringSoon: 0,
  });
  const [editing, setEditing] = useState<Fispq | null>(null);
  const [creating, setCreating] = useState(false);
  const load = async () => {
    const r = await fetch("/api/fispq");
    if (!r.ok) return notify("Não foi possível carregar as FISPQ");
    const data = await r.json();
    setFispqs(data.fispqs);
    setSummary(data.summary);
  };
  useEffect(() => {
    load();
  }, []);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let r: Response, data: { error?: string };
    if (editing) {
      r = await fetch("/api/fispq", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          version: String(form.get("version") || ""),
          issueDate: String(form.get("issueDate") || ""),
          validityDate: String(form.get("validityDate") || ""),
          status: String(form.get("status") || "active"),
          notes: String(form.get("notes") || ""),
        }),
      });
      data = await r.json();
    } else {
      const payload = new FormData();
      payload.set("productId", String(form.get("productId") || ""));
      payload.set("version", String(form.get("version") || "1"));
      payload.set("issueDate", String(form.get("issueDate") || ""));
      payload.set("validityDate", String(form.get("validityDate") || ""));
      payload.set("status", String(form.get("status") || "active"));
      payload.set("notes", String(form.get("notes") || ""));
      const file = form.get("file");
      if (file instanceof File && file.size) payload.set("file", file);
      r = await fetch("/api/fispq", { method: "POST", body: payload });
      data = await r.json();
    }
    if (r.ok) {
      setEditing(null);
      setCreating(false);
      notify(editing ? "FISPQ atualizada" : "FISPQ cadastrada");
      await load();
      await onFispqChanged();
    } else notify(data.error || "Não foi possível salvar a FISPQ");
  };
  return (
    <>
      <section className="panel archive-panel">
        <div className="section-title">
          <div>
            <h2>Fichas de segurança (FISPQ / SDS)</h2>
            <p>
              {summary.active} vigentes · {summary.expiringSoon} vencem em 30
              dias · {summary.expired} vencidas
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Nova FISPQ
          </button>
        </div>
        {fispqs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Versão</th>
                  <th>Emissão</th>
                  <th>Validade</th>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fispqs.map((fispq) => {
                  const days = daysUntil(fispq.validityDate);
                  return (
                    <tr key={fispq.id}>
                      <td>
                        <strong>{fispq.productName}</strong>
                      </td>
                      <td>v{fispq.version}</td>
                      <td>{fispq.issueDate || "—"}</td>
                      <td>{fispq.validityDate || "—"}</td>
                      <td>
                        {fispq.fileName ? (
                          <a
                            className="download-button"
                            href={`/api/fispq?download=${fispq.id}`}
                          >
                            ⤓ {fispq.fileName}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {fispq.status === "active" ? (
                          days !== null && days < 0 ? (
                            <span className="record-status pending">Vencida</span>
                          ) : days !== null && days <= 30 ? (
                            <span className="record-status pending">
                              Vence em {days}d
                            </span>
                          ) : (
                            <span className="record-status active">Vigente</span>
                          )
                        ) : (
                          <span className="record-status archived">
                            {statusLabels[fispq.status] ?? fispq.status}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="edit" onClick={() => setEditing(fispq)}>
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>▤</span>
            <h3>Nenhuma FISPQ cadastrada</h3>
            <p>Vincule a ficha de segurança vigente a cada produto.</p>
          </div>
        )}
      </section>
      {(creating || editing) && (
        <Modal
          eyebrow="FICHA DE SEGURANÇA"
          title={editing ? `Editar FISPQ v${editing.version}` : "Cadastrar FISPQ"}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <div className="scan-fields">
              <label className="full">
                Produto
                <select
                  name="productId"
                  required
                  disabled={!!editing}
                  defaultValue={editing?.productId ?? ""}
                >
                  <option value="" disabled>
                    Selecione o produto
                  </option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Versão
                <input name="version" required defaultValue={editing?.version ?? "1"} />
              </label>
              <label>
                Data de emissão
                <input
                  name="issueDate"
                  type="date"
                  defaultValue={editing?.issueDate}
                />
              </label>
              <label>
                Validade
                <input
                  name="validityDate"
                  type="date"
                  defaultValue={editing?.validityDate}
                />
              </label>
              <label>
                Situação
                <select name="status" defaultValue={editing?.status ?? "active"}>
                  <option value="active">Vigente</option>
                  <option value="archived">Arquivada</option>
                  <option value="rejected">Rejeitada</option>
                </select>
              </label>
              {!editing && (
                <label className="full">
                  Arquivo (PDF ou imagem)
                  <input
                    name="file"
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                  />
                </label>
              )}
              <label className="full">
                Observações
                <textarea name="notes" rows={2} defaultValue={editing?.notes} />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button">
                {editing ? "Salvar FISPQ" : "Cadastrar FISPQ"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

function LicensesTab({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    expired: 0,
    expiringSoon: 0,
  });
  const [editing, setEditing] = useState<License | null>(null);
  const [creating, setCreating] = useState(false);
  const load = async () => {
    const r = await fetch("/api/licenses");
    if (!r.ok) return notify("Não foi possível carregar as licenças");
    const data = await r.json();
    setLicenses(data.licenses);
    setSummary(data.summary);
  };
  useEffect(() => {
    load();
  }, []);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      payload = {
        ...(editing ? { id: editing.id } : {}),
        licenseType: String(form.get("licenseType") || ""),
        issuingAgency: String(form.get("issuingAgency") || ""),
        number: String(form.get("number") || ""),
        validityDate: String(form.get("validityDate") || ""),
        scope: String(form.get("scope") || ""),
        status: String(form.get("status") || "active"),
        notes: String(form.get("notes") || ""),
      };
    const r = await fetch("/api/licenses", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (r.ok) {
      setEditing(null);
      setCreating(false);
      notify(editing ? "Licença atualizada" : "Licença cadastrada");
      await load();
    } else notify(data.error || "Não foi possível salvar a licença");
  };
  return (
    <>
      <section className="panel archive-panel">
        <div className="section-title">
          <div>
            <h2>Licenças e autorizações</h2>
            <p>
              {summary.active} vigentes · {summary.expiringSoon} vencem em 30
              dias · {summary.expired} vencidas
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Nova licença
          </button>
        </div>
        {licenses.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Licença</th>
                  <th>Órgão</th>
                  <th>Número</th>
                  <th>Validade</th>
                  <th>Escopo</th>
                  <th>Situação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((license) => {
                  const days = daysUntil(license.validityDate);
                  return (
                    <tr key={license.id}>
                      <td>
                        <strong>{license.licenseType}</strong>
                      </td>
                      <td>{license.issuingAgency}</td>
                      <td>{license.number}</td>
                      <td>{license.validityDate || "—"}</td>
                      <td>{license.scope || "—"}</td>
                      <td>
                        {license.effectiveStatus === "active" ? (
                          days !== null && days <= 30 ? (
                            <span className="record-status pending">
                              Vence em {days}d
                            </span>
                          ) : (
                            <span className="record-status active">Vigente</span>
                          )
                        ) : license.effectiveStatus === "expired" ? (
                          <span className="record-status pending">Vencida</span>
                        ) : (
                          <span className="record-status archived">
                            {statusLabels[license.effectiveStatus] ??
                              license.effectiveStatus}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="edit" onClick={() => setEditing(license)}>
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>▤</span>
            <h3>Nenhuma licença cadastrada</h3>
            <p>Alvará, licença ambiental, SIPROQUIM e bombeiros em um só lugar.</p>
          </div>
        )}
      </section>
      {(creating || editing) && (
        <Modal
          eyebrow="LICENÇA E AUTORIZAÇÃO"
          title={editing ? "Editar licença" : "Cadastrar licença"}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <div className="scan-fields">
              <label className="full">
                Tipo
                <select
                  name="licenseType"
                  required
                  defaultValue={editing?.licenseType ?? ""}
                >
                  <option value="" disabled>
                    Selecione o tipo
                  </option>
                  {licenseTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                Órgão emissor
                <input
                  name="issuingAgency"
                  required
                  placeholder="Ex.: INEA"
                  defaultValue={editing?.issuingAgency}
                />
              </label>
              <label>
                Número
                <input name="number" required defaultValue={editing?.number} />
              </label>
              <label>
                Validade
                <input
                  name="validityDate"
                  type="date"
                  defaultValue={editing?.validityDate}
                />
              </label>
              <label>
                Escopo
                <input
                  name="scope"
                  placeholder="Ex.: Depósito principal"
                  defaultValue={editing?.scope}
                />
              </label>
              <label>
                Situação
                <select name="status" defaultValue={editing?.status ?? "active"}>
                  <option value="active">Vigente</option>
                  <option value="archived">Arquivada</option>
                  <option value="expired">Vencida</option>
                </select>
              </label>
              <label className="full">
                Observações
                <textarea name="notes" rows={2} defaultValue={editing?.notes} />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button">Salvar licença</button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

function SuppliersTab({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    expired: 0,
    expiringSoon: 0,
  });
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const load = async () => {
    const r = await fetch("/api/suppliers");
    if (!r.ok) return notify("Não foi possível carregar os fornecedores");
    const data = await r.json();
    setSuppliers(data.suppliers);
    setSummary(data.summary);
  };
  useEffect(() => {
    load();
  }, []);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      certTypes = form.getAll("certType").map(String),
      certExpiries = form.getAll("certExpiry").map(String),
      certificates = certTypes
        .map((type, index) => ({
          type,
          expiry: certExpiries[index] ?? "",
        }))
        .filter((cert) => cert.type.trim()),
      payload = {
        ...(editing ? { id: editing.id } : {}),
        companyName: String(form.get("companyName") || ""),
        cnpj: String(form.get("cnpj") || ""),
        stateRegistration: String(form.get("stateRegistration") || ""),
        contactName: String(form.get("contactName") || ""),
        contactEmail: String(form.get("contactEmail") || ""),
        contactPhone: String(form.get("contactPhone") || ""),
        certificates,
        status: String(form.get("status") || "active"),
        notes: String(form.get("notes") || ""),
      };
    const r = await fetch("/api/suppliers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (r.ok) {
      setEditing(null);
      setCreating(false);
      notify(editing ? "Fornecedor atualizado" : "Fornecedor cadastrado");
      await load();
    } else notify(data.error || "Não foi possível salvar o fornecedor");
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <section className="panel archive-panel">
        <div className="section-title">
          <div>
            <h2>Fornecedores</h2>
            <p>
              {summary.active} ativos · {summary.expiringSoon} com certificado
              vencendo · {summary.expired} com certificado vencido
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Novo fornecedor
          </button>
        </div>
        {suppliers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Razão social</th>
                  <th>CNPJ</th>
                  <th>Contato</th>
                  <th>Certificados</th>
                  <th>Situação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <strong>{supplier.companyName}</strong>
                      <small>{supplier.stateRegistration || "—"}</small>
                    </td>
                    <td>{supplier.cnpj}</td>
                    <td>
                      {supplier.contactName || "—"}
                      <small>{supplier.contactPhone || ""}</small>
                    </td>
                    <td>
                      {supplier.certificates.length ? (
                        supplier.certificates.map((cert, index) => (
                          <span
                            key={index}
                            className={`compliance-tag ${
                              cert.expiry && cert.expiry < today ? "controlled" : ""
                            }`}
                          >
                            {cert.type}
                            {cert.expiry
                              ? ` até ${cert.expiry}${cert.expiry < today ? " (vencido)" : ""}`
                              : ""}
                          </span>
                        ))
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span
                        className={`record-status ${
                          supplier.status === "active" ? "active" : "archived"
                        }`}
                      >
                        {statusLabels[supplier.status] ?? supplier.status}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="edit" onClick={() => setEditing(supplier)}>
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>▤</span>
            <h3>Nenhum fornecedor cadastrado</h3>
            <p>Registre fornecedores e seus certificados com validade.</p>
          </div>
        )}
      </section>
      {(creating || editing) && (
        <Modal
          eyebrow="FORNECEDOR"
          title={editing ? `Editar ${editing.companyName}` : "Cadastrar fornecedor"}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <div className="scan-fields">
              <label className="full">
                Razão social
                <input
                  name="companyName"
                  required
                  defaultValue={editing?.companyName}
                />
              </label>
              <label>
                CNPJ
                <input
                  name="cnpj"
                  required
                  inputMode="numeric"
                  placeholder="Somente números"
                  defaultValue={editing?.cnpj}
                />
              </label>
              <label>
                Inscrição estadual
                <input
                  name="stateRegistration"
                  defaultValue={editing?.stateRegistration}
                />
              </label>
              <label>
                Contato
                <input name="contactName" defaultValue={editing?.contactName} />
              </label>
              <label>
                Telefone
                <input name="contactPhone" defaultValue={editing?.contactPhone} />
              </label>
              <label>
                E-mail
                <input
                  name="contactEmail"
                  type="email"
                  defaultValue={editing?.contactEmail}
                />
              </label>
              <label>
                Situação
                <select name="status" defaultValue={editing?.status ?? "active"}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
              <div className="full cert-editor">
                <span className="cert-label">Certificados e validade</span>
                {(editing?.certificates ?? [{ type: "", expiry: "" }]).map(
                  (cert, index) => (
                    <div className="cert-row" key={index}>
                      <input
                        name="certType"
                        placeholder="Ex.: Certificado de regularidade"
                        defaultValue={cert.type}
                      />
                      <input
                        name="certExpiry"
                        type="date"
                        defaultValue={cert.expiry}
                      />
                    </div>
                  ),
                )}
              </div>
              <label className="full">
                Observações
                <textarea name="notes" rows={2} defaultValue={editing?.notes} />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button">Salvar fornecedor</button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
