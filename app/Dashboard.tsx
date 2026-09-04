"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getModuleConfig } from "./module-config";
import DocumentCenter, { RecordDocuments } from "./DocumentCenter";
import ProductCenter from "./ProductCenter";
import PedidosCenter from "./PedidosCenter";
import FleetCenter from "./FleetCenter";

type Module = {
  name: string;
  description: string;
  count: string;
  alert?: string;
};
type Department = {
  code: string;
  name: string;
  eyebrow: string;
  summary: string;
  color: string;
  modules: Module[];
};
type RecordItem = {
  id: number;
  department: string;
  module: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string;
  amountCents: number;
  metadata: Record<string, string>;
  updatedAt: number;
};
type DrawerState = { mode: "view" | "edit" | "new"; record: RecordItem | null };

const departments: Record<string, Department> = {
  dashboard: {
    code: "IN",
    name: "Visão geral",
    eyebrow: "PAINEL EXECUTIVO",
    summary: "Acompanhe os principais indicadores e pendências da sua empresa.",
    color: "#2aa99a",
    modules: [],
  },
  digitalizacao: {
    code: "AD",
    name: "Acervo Digital",
    eyebrow: "MIGRAÇÃO E CUSTÓDIA DOCUMENTAL",
    summary:
      "Transforme documentos físicos em um acervo privado, classificado e rastreável.",
    color: "#176f83",
    modules: [],
  },
  produtos: {
    code: "PQ",
    name: "Produtos",
    eyebrow: "CATÁLOGO E CONFORMIDADE REGULATÓRIA",
    summary:
      "Cadastre produtos, lotes com validade, FISPQ, licenças e fornecedores com alerta antes do prazo.",
    color: "#b0562e",
    modules: [],
  },
  pedidos: {
    code: "PD",
    name: "Pedidos",
    eyebrow: "FLUXO DE PEDIDOS E DOCUMENTAÇÃO",
    summary:
      "Cadastre clientes e pedidos e monte o dossiê do pedido: Nota fiscal, boleto, laudos e fichas de risco em um único PDF.",
    color: "#1d6f9c",
    modules: [],
  },
  rh: {
    code: "RH",
    name: "Recursos Humanos",
    eyebrow: "GESTÃO DE PESSOAS E CONFORMIDADE",
    summary: "Centralize colaboradores, documentos, equipamentos e licenças.",
    color: "#7657c8",
    modules: [
      {
        name: "Funcionários",
        description: "Admissão, pagamentos e contratos",
        count: "42 ativos",
      },
      {
        name: "EPI",
        description: "Entregas, termos e vencimentos",
        count: "186 itens",
        alert: "3 assinaturas",
      },
      {
        name: "Uniformes",
        description: "Entrega e reposição por colaborador",
        count: "74 entregas",
      },
      {
        name: "Caminhões – Documentos",
        description: "CRLV, seguros e licenciamento",
        count: "8 veículos",
        alert: "1 próximo",
      },
      {
        name: "Caminhões – Manutenção",
        description: "Histórico e notas de serviço",
        count: "23 serviços",
      },
      {
        name: "Licenças da Empresa",
        description: "Alvará, ambiental e SIPROQUIM",
        count: "6 licenças",
        alert: "1 urgente",
      },
      {
        name: "Recrutamento e Seleção",
        description: "Vagas, candidatos e etapas",
        count: "12 candidatos",
      },
    ],
  },
  logistica: {
    code: "LG",
    name: "Logística",
    eyebrow: "OPERAÇÃO E DISTRIBUIÇÃO",
    summary: "Planeje rotas, comprove entregas e cuide dos equipamentos.",
    color: "#2876e5",
    modules: [
      {
        name: "Rotas",
        description: "Planejamento e roteirização",
        count: "14 esta semana",
      },
      {
        name: "Entregas",
        description: "Canhotos e comprovantes digitais",
        count: "128 no mês",
        alert: "5 pendentes",
      },
      {
        name: "Equipamentos de Transporte",
        description: "Carrinhos, bombas e paleteiras",
        count: "31 ativos",
        alert: "2 manutenções",
      },
    ],
  },
  frota: {
    code: "FR",
    name: "Frota",
    eyebrow: "VEÍCULOS, DOCUMENTOS E MANUTENÇÕES",
    summary:
      "Cadastre os caminhões, acompanhe validade de CRLV, seguro e MOPP, e controle as manutenções periódicas por km e por tempo.",
    color: "#0e8f7a",
    modules: [],
  },
  embalagem: {
    code: "EM",
    name: "Embalagem e Rotulagem",
    eyebrow: "PRODUÇÃO E RASTREABILIDADE",
    summary: "Gerencie artes, bombonas e insumos de embalagem.",
    color: "#d98d2e",
    modules: [
      {
        name: "Rótulos",
        description: "Artes e modelos por produto",
        count: "36 modelos",
      },
      {
        name: "Controle de Bombonas",
        description: "Movimentação e rastreabilidade",
        count: "1.248 unidades",
      },
      {
        name: "Estoque de Embalagem",
        description: "Saldo, consumo e estoque mínimo",
        count: "82 itens",
        alert: "4 em baixa",
      },
    ],
  },
  vendas: {
    code: "VD",
    name: "Vendas",
    eyebrow: "RELACIONAMENTO E RECEITA",
    summary: "Conduza clientes da oportunidade ao pós-venda.",
    color: "#1c9b77",
    modules: [
      {
        name: "Clientes",
        description: "Cadastro e histórico comercial",
        count: "284 ativos",
      },
      {
        name: "Propostas e Orçamentos",
        description: "Pipeline, versões e aprovações",
        count: "R$ 326 mil",
        alert: "8 abertas",
      },
      {
        name: "Pesquisa de Satisfação",
        description: "NPS e acompanhamento de respostas",
        count: "NPS 78",
      },
    ],
  },
  compras: {
    code: "CP",
    name: "Compras",
    eyebrow: "SUPRIMENTOS E FORNECEDORES",
    summary: "Controle cotações, pedidos e entradas fiscais.",
    color: "#d15c6d",
    modules: [
      {
        name: "Fornecedores",
        description: "Cadastro e avaliação",
        count: "67 homologados",
      },
      {
        name: "Pedidos de Compra",
        description: "Solicitação, aprovação e entrega",
        count: "21 em aberto",
        alert: "4 aprovações",
      },
      {
        name: "Notas Fiscais de Entrada",
        description: "Conferência fiscal e recebimento",
        count: "96 no mês",
      },
    ],
  },
  financeiro: {
    code: "FN",
    name: "Financeiro",
    eyebrow: "FLUXO DE CAIXA E RESULTADOS",
    summary: "Acompanhe recebíveis, obrigações e resultado gerencial.",
    color: "#2473ca",
    modules: [
      {
        name: "Notas Fiscais de Saída",
        description: "Emissão e acompanhamento",
        count: "R$ 487 mil",
      },
      {
        name: "Boletos e Recebimentos",
        description: "Baixas, atrasos e conciliação",
        count: "18 em aberto",
        alert: "3 atrasados",
      },
      {
        name: "Contas a Pagar",
        description: "Agenda e aprovações",
        count: "R$ 92 mil",
        alert: "6 esta semana",
      },
      {
        name: "DRE e Relatórios",
        description: "Resultado e indicadores gerenciais",
        count: "Margem 24,7%",
      },
    ],
  },
};

export default function Dashboard() {
  const [active, setActive] = useState("dashboard"),
    [query, setQuery] = useState(""),
    [selectedModule, setSelectedModule] = useState<Module | null>(null),
    [records, setRecords] = useState<RecordItem[]>([]),
    [loading, setLoading] = useState(false),
    [drawer, setDrawer] = useState<DrawerState | null>(null),
    [toast, setToast] = useState("");
  const [profile, setProfile] = useState({ name: "Usuário", role: "viewer" });
  const [attentionTotal, setAttentionTotal] = useState<number | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (mounted && data.name) setProfile(data);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    fetch("/api/summary")
      .then((r) => r.json())
      .then((data) => {
        if (mounted)
          setAttentionTotal(
            (data?.compliance?.totalAlerts ?? 0) +
              (data?.metrics?.review ?? 0),
          );
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const current = departments[active];
  const filteredModules = useMemo(
    () =>
      current.modules.filter((m) =>
        `${m.name} ${m.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [current, query],
  );
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2600);
  }, []);
  async function openModule(module: Module) {
    setSelectedModule(module);
    setQuery("");
    setLoading(true);
    try {
      const response = await fetch(
        `/api/records?department=${encodeURIComponent(active)}&module=${encodeURIComponent(module.name)}`,
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      setRecords(data.records);
    } catch {
      notify("Não foi possível carregar os registros");
    } finally {
      setLoading(false);
    }
  }
  async function saveRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedModule) return;
    const form = new FormData(e.currentTarget),
      isEdit = drawer?.mode === "edit",
      config = getModuleConfig(selectedModule.name),
      metadata = Object.fromEntries(
        config.fields.map((field) => [
          field.key,
          String(form.get(`meta_${field.key}`) || ""),
        ]),
      );
    const payload = {
      id: drawer?.record?.id,
      department: active,
      module: selectedModule.name,
      title: String(form.get("title") || ""),
      description: String(form.get("description") || ""),
      metadata,
      status: String(form.get("status") || "active"),
      priority: String(form.get("priority") || "medium"),
      dueDate: String(form.get("dueDate") || ""),
    };
    try {
      const response = await fetch("/api/records", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setRecords((prev) =>
        isEdit
          ? prev.map((r) => (r.id === data.record.id ? data.record : r))
          : [data.record, ...prev],
      );
      setDrawer(null);
      notify(
        isEdit
          ? "Alterações salvas com sucesso"
          : "Registro criado com sucesso",
      );
    } catch {
      notify("Não foi possível salvar o registro");
    }
  }
  const switchArea = (key: string) => {
    setActive(key);
    setSelectedModule(null);
    setQuery("");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>Quimicativa</strong>
            <small>Gestão integrada</small>
          </div>
        </div>
        <nav aria-label="Navegação principal">
          <p className="nav-label">MENU PRINCIPAL</p>
          {Object.entries(departments).map(([key, item]) => (
            <button
              className={`nav-item ${active === key ? "active" : ""}`}
              key={key}
              onClick={() => switchArea(key)}
            >
              <span>{item.code}</span>
              {item.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="support-icon">?</div>
          <div>
            <strong>Central de suporte</strong>
            <small>Fale com nossa equipe</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="search">
            <span>⌕</span>
            <input
              aria-label="Pesquisar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                selectedModule
                  ? "Buscar nos registros..."
                  : "Buscar clientes, notas, pedidos..."
              }
            />
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label="Pendências"
              title="Ver pendências"
              onClick={() => {
                switchArea("dashboard");
                notify(
                  attentionTotal
                    ? `${attentionTotal} pendência(s) precisam da sua atenção hoje`
                    : "Nenhuma pendência no momento",
                );
              }}
            >
              <span className="bell">
                ◌
                {attentionTotal ? <b>{attentionTotal}</b> : null}
              </span>
            </button>
            <div className="user">
              <span className="avatar">
                {profile.name
                  .split(" ")
                  .map((name) => name[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <div>
                <strong>{profile.name}</strong>
                <small>
                  {profile.role === "ceo"
                    ? "Direção"
                    : profile.role === "manager"
                      ? "Gestor"
                      : profile.role === "operator"
                        ? "Operador"
                        : "Consulta"}
                </small>
              </div>
              <span>⌄</span>
            </div>
          </div>
        </header>
        <div className="content">
          <section className="welcome">
            <div>
              <p className="eyebrow">
                {selectedModule
                  ? `${current.name}  /  MÓDULO`
                  : current.eyebrow}
              </p>
              <h1>
                {selectedModule ? (
                  selectedModule.name
                ) : active === "dashboard" ? (
                  <>
                    Bom dia, {profile.name.split(" ")[0]}! <span>👋</span>
                  </>
                ) : (
                  current.name
                )}
              </h1>
              <p>
                {selectedModule ? selectedModule.description : current.summary}
              </p>
            </div>
            {selectedModule && (
              <button
                className="primary-button"
                onClick={() => setDrawer({ mode: "new", record: null })}
              >
                <span>+</span> Novo registro
              </button>
            )}
          </section>
          {active === "dashboard" ? (
            <ExecutiveView onOpen={switchArea} />
          ) : active === "digitalizacao" ? (
            <DocumentCenter notify={notify} />
          ) : active === "produtos" ? (
            <ProductCenter notify={notify} canExport={profile.role !== "viewer"} />
          ) : active === "pedidos" ? (
            <PedidosCenter notify={notify} canWrite={profile.role !== "viewer"} />
          ) : active === "frota" ? (
            <FleetCenter notify={notify} canWrite={profile.role !== "viewer"} />
          ) : selectedModule ? (
            <ModuleWorkspace
              module={selectedModule}
              records={records}
              loading={loading}
              query={query}
              onBack={() => {
                setSelectedModule(null);
                setQuery("");
              }}
              onView={(record) => setDrawer({ mode: "view", record })}
              onEdit={(record) => setDrawer({ mode: "edit", record })}
            />
          ) : (
            <DepartmentView
              department={current}
              modules={filteredModules}
              query={query}
              onOpen={openModule}
            />
          )}
        </div>
      </main>
      {drawer && selectedModule && (
        <RecordDrawer
          state={drawer}
          module={selectedModule}
          department={active}
          notify={notify}
          canAnonymize={profile.role === "ceo" || profile.role === "manager"}
          onClose={() => setDrawer(null)}
          onEdit={() => setDrawer({ mode: "edit", record: drawer.record })}
          onSubmit={saveRecord}
        />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}

function ExecutiveView({ onOpen }: { onOpen: (key: string) => void }) {
  const [data, setData] = useState<{
    metrics: {
      records: number;
      attention: number;
      documents: number;
      review: number;
      expiring: number;
      products: number;
    };
    compliance?: {
      totalAlerts: number;
      fispqMissing: number;
      fispqExpired: number;
      fispqExpiring: number;
      lotsExpired: number;
      lotsExpiring: number;
      licensesExpired: number;
      licensesExpiring: number;
    };
    recent: Array<{
      title: string;
      department: string;
      module: string;
      status: string;
      updated_at: number;
    }>;
  } | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch("/api/summary")
      .then((r) => r.json())
      .then((result) => {
        if (mounted) setData(result);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const cards = [
    {
      label: "Registros operacionais",
      value: data?.metrics?.records ?? "—",
      note: "dados cadastrados nos setores",
      tone: "green",
    },
    {
      label: "Acervo digital",
      value: data?.metrics?.documents ?? "—",
      note: `${data?.metrics?.review ?? 0} aguardando revisão`,
      tone: "blue",
    },
    {
      label: "Validades próximas",
      value: data?.metrics?.expiring ?? "—",
      note: "documentos nos próximos 30 dias",
      tone: "amber",
    },
    {
      label: "Pendências operacionais",
      value: data?.metrics?.attention ?? "—",
      note: "registros que exigem atenção",
      tone: "red",
    },
  ];
  return (
    <>
      <section className="metrics" aria-label="Indicadores principais">
        {cards.map((item) => (
          <article className="metric-card" key={item.label}>
            <div className={`metric-icon ${item.tone}`}>
              {item.label.slice(0, 2).toUpperCase()}
            </div>
            <div className="metric-label">{item.label}</div>
            <strong>{item.value}</strong>
            <small className={item.tone}>{item.note}</small>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Migração documental</h2>
              <p>Indicadores calculados diretamente do acervo privado</p>
            </div>
            <button
              className="primary-button"
              onClick={() => onOpen("digitalizacao")}
            >
              Abrir Acervo Digital
            </button>
          </div>
          <div className="migration-callout">
            <strong>{data?.metrics?.documents ?? 0}</strong>
            <span>documentos recebidos</span>
            <b>{data?.metrics?.review ?? 0} aguardam conferência humana</b>
          </div>
        </article>
        <article className="panel pending-panel">
          <div className="panel-heading">
            <div>
              <h2>Atenção da direção</h2>
              <p>Pendências calculadas em tempo real</p>
            </div>
          </div>
          <ul className="pending-list">
            <li
              onClick={() => onOpen("digitalizacao")}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen("digitalizacao");
                }
              }}
            >
              <span className="task-icon amber">DOC</span>
              <div>
                <strong>Conferência documental</strong>
                <small>
                  {data?.metrics?.review ?? 0} documento(s) aguardando revisão
                </small>
              </div>
            </li>
            <li
              onClick={() => onOpen("produtos")}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen("produtos");
                }
              }}
            >
              <span className="task-icon red">FQ</span>
              <div>
                <strong>Conformidade regulatória</strong>
                <small>
                  {data?.compliance?.totalAlerts ?? 0} alerta(s) em FISPQ, lotes
                  e licenças
                </small>
              </div>
            </li>
            <li>
              <span className="task-icon red">!</span>
              <div>
                <strong>Pendências operacionais</strong>
                <small>
                  {data?.metrics?.attention ?? 0} registro(s) requerem ação
                </small>
              </div>
            </li>
          </ul>
        </article>
      </section>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>Atividade recente</h2>
            <p>Últimos registros reais entre todos os setores</p>
          </div>
        </div>
        {data?.recent?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Registro</th>
                  <th>Setor</th>
                  <th>Módulo</th>
                  <th>Status</th>
                  <th>Atualização</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={`${row.title}-${row.updated_at}`}>
                    <td>
                      <strong>{row.title}</strong>
                    </td>
                    <td>
                      {departments[row.department]?.name ?? row.department}
                    </td>
                    <td>{row.module}</td>
                    <td>
                      <span className="status">{row.status}</span>
                    </td>
                    <td>
                      {new Date(row.updated_at * 1000).toLocaleString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>Nenhuma atividade real cadastrada</h3>
            <p>
              Os registros aparecerão aqui conforme a equipe migrar e operar os
              módulos.
            </p>
          </div>
        )}
      </section>
      <section className="sector-shortcuts">
        <div className="section-title">
          <div>
            <h2>Acesso rápido aos setores</h2>
            <p>Visão consolidada de toda a empresa</p>
          </div>
        </div>
        <div className="shortcut-grid">
          {Object.entries(departments)
            .filter(([k]) => k !== "dashboard")
            .map(([key, d]) => (
              <button key={key} onClick={() => onOpen(key)}>
                <span style={{ background: d.color }}>{d.code}</span>
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    {d.modules.length
                      ? `${d.modules.length} módulos`
                      : "Central documental"}
                  </small>
                </div>
                <b>›</b>
              </button>
            ))}
        </div>
      </section>
    </>
  );
}
function DepartmentView({
  department,
  modules,
  query,
  onOpen,
}: {
  department: Department;
  modules: Module[];
  query: string;
  onOpen: (m: Module) => void;
}) {
  return (
    <>
      <section className="department-summary">
        <article>
          <span>Estrutura operacional</span>
          <strong>{department.modules.length}</strong>
          <small>módulos especializados</small>
        </article>
        <article>
          <span>Fonte dos indicadores</span>
          <strong>Real</strong>
          <small>sem dados demonstrativos</small>
        </article>
        <article>
          <span>Documentos</span>
          <strong>Privados</strong>
          <small>anexados a cada registro</small>
        </article>
      </section>
      <div className="section-title">
        <div>
          <h2>Módulos de {department.name}</h2>
          <p>Selecione uma área para consultar ou gerenciar registros.</p>
        </div>
      </div>
      <section className="module-grid">
        {modules.length ? (
          modules.map((m, i) => (
            <button
              className="module-card"
              key={m.name}
              onClick={() => onOpen(m)}
            >
              <div className="module-top">
                <span
                  className="module-code"
                  style={{
                    background: `${department.color}18`,
                    color: department.color,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3>{m.name}</h3>
              <p>{m.description}</p>
              <footer>
                <strong>Abrir módulo</strong>
                <b>›</b>
              </footer>
            </button>
          ))
        ) : (
          <div className="empty-state">
            <span>⌕</span>
            <h3>Nenhum módulo encontrado</h3>
            <p>Não encontramos resultados para &ldquo;{query}&rdquo;.</p>
          </div>
        )}
      </section>
    </>
  );
}

function ModuleWorkspace({
  module,
  records,
  loading,
  query,
  onBack,
  onView,
  onEdit,
}: {
  module: Module;
  records: RecordItem[];
  loading: boolean;
  query: string;
  onBack: () => void;
  onView: (r: RecordItem) => void;
  onEdit: (r: RecordItem) => void;
}) {
  const config = getModuleConfig(module.name),
    columns = config.fields.slice(0, 2);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"recent" | "due">("recent");
  const visible = records
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) =>
      `${r.title} ${r.description} ${Object.values(r.metadata ?? {}).join(" ")} ${r.status}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sortBy === "due"
        ? (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99")
        : b.updatedAt - a.updatedAt,
    ),
    statusLabel = Object.fromEntries(
      config.statuses.map((s) => [s.value, s.label]),
    );
  const attention = records.filter((r) =>
      [
        "pending",
        "review",
        "expired",
        "overdue",
        "critical",
        "failed",
      ].includes(r.status),
    ).length,
    done = records.filter((r) =>
      ["completed", "approved", "active"].includes(r.status),
    ).length;
  return (
    <>
      <div className="workspace-toolbar">
        <button className="back-button" onClick={onBack}>
          ‹ Voltar aos módulos
        </button>
        <div>
          <select
            className="select-button"
            aria-label="Filtrar por status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Todos os status</option>
            {config.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="select-button"
            onClick={() => setSortBy(sortBy === "recent" ? "due" : "recent")}
          >
            {sortBy === "recent" ? "Mais recentes ⌄" : "Por prazo ⌄"}
          </button>
        </div>
      </div>
      <div className="module-guidance">
        <span>FLUXO DO MÓDULO</span>
        <p>{config.guidance}</p>
      </div>
      <section className="module-kpis">
        <article>
          <span>{config.kpis[0]}</span>
          <strong>{records.length}</strong>
        </article>
        <article>
          <span>{config.kpis[1]}</span>
          <strong>{attention}</strong>
        </article>
        <article>
          <span>{config.kpis[2]}</span>
          <strong>{done}</strong>
        </article>
      </section>
      <section className="panel records-panel">
        <div className="panel-heading">
          <div>
            <h2>{config.titleLabel}</h2>
            <p>
              Consulte as informações operacionais e edite quando necessário.
            </p>
          </div>
        </div>
        {loading ? (
          <div className="records-loading">
            <i />
            <i />
            <i />
          </div>
        ) : visible.length ? (
          <div className="table-wrap">
            <table className="records-table">
              <thead>
                <tr>
                  <th>{config.titleLabel}</th>
                  {columns.map((field) => (
                    <th key={field.key}>{field.label}</th>
                  ))}
                  <th>Status</th>
                  <th>Prazo</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.title}</strong>
                      <small>{record.description}</small>
                    </td>
                    {columns.map((field) => (
                      <td key={field.key}>
                        <strong className="metadata-value">
                          {formatField(
                            record.metadata?.[field.key],
                            field.type,
                          )}
                        </strong>
                      </td>
                    ))}
                    <td>
                      <span className={`record-status ${record.status}`}>
                        {statusLabel[record.status] ?? record.status}
                      </span>
                    </td>
                    <td>
                      {record.dueDate
                        ? new Date(
                            `${record.dueDate}T12:00:00`,
                          ).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => onView(record)}>
                          Consultar
                        </button>
                        <button className="edit" onClick={() => onEdit(record)}>
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
            <span>⌕</span>
            <h3>Nenhum registro encontrado</h3>
            <p>Ajuste sua busca ou crie o primeiro registro deste módulo.</p>
          </div>
        )}
      </section>
    </>
  );
}

function RecordDrawer({
  state,
  module,
  department,
  notify,
  onClose,
  onEdit,
  onSubmit,
  canAnonymize = false,
}: {
  state: DrawerState;
  module: Module;
  department: string;
  notify: (message: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  canAnonymize?: boolean;
}) {
  const view = state.mode === "view",
    record = state.record,
    config = getModuleConfig(module.name),
    statusLabel = Object.fromEntries(
      config.statuses.map((s) => [s.value, s.label]),
    );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const anonymize = async () => {
    if (!record) return;
    const reason = window.prompt(
      "Motivo da anonimização (ex.: solicitação do titular — art. 18 da LGPD):",
    );
    if (!reason?.trim()) return;
    if (
      !window.confirm(
        "Anonimizar remove os dados pessoais deste registro. O histórico de negócio é preservado. Continuar?",
      )
    )
      return;
    const r = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: record.id, reason }),
      }),
      data = await r.json();
    if (r.ok) {
      notify(data.message || "Registro anonimizado");
      onClose();
    } else notify(data.error || "Não foi possível anonimizar o registro");
  };
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="record-drawer wide"
        role="dialog"
        aria-modal="true"
        aria-label={`${view ? "Consulta" : state.mode === "edit" ? "Edição" : "Novo"} de ${config.singular}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">
              {view
                ? `CONSULTA DE ${config.singular.toUpperCase()}`
                : state.mode === "edit"
                  ? `EDIÇÃO DE ${config.singular.toUpperCase()}`
                  : `NOVO ${config.singular.toUpperCase()}`}
            </p>
            <h2>
              {view
                ? record?.title
                : state.mode === "edit"
                  ? `Editar ${config.singular}`
                  : `Novo ${config.singular}`}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        {view ? (
          <div className="record-details">
            <div className="detail-hero">
              <span className={`record-status ${record?.status}`}>
                {statusLabel[record?.status ?? ""] ?? record?.status}
              </span>
              <p>{record?.description || "Sem observações cadastradas."}</p>
            </div>
            <dl className="custom-details">
              {config.fields.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>
                    {formatField(record?.metadata?.[field.key], field.type)}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Prioridade</dt>
                <dd className={`priority ${record?.priority}`}>
                  {record?.priority}
                </dd>
              </div>
              <div>
                <dt>Prazo de acompanhamento</dt>
                <dd>
                  {record?.dueDate
                    ? new Date(`${record.dueDate}T12:00:00`).toLocaleDateString(
                        "pt-BR",
                      )
                    : "Sem prazo"}
                </dd>
              </div>
              <div>
                <dt>Última atualização</dt>
                <dd>
                  {record
                    ? new Date(record.updatedAt * 1000).toLocaleString("pt-BR")
                    : "—"}
                </dd>
              </div>
            </dl>
            {record && (
              <RecordDocuments
                recordId={record.id}
                department={department}
                module={module.name}
                notify={notify}
              />
            )}
            <footer>
              <button className="secondary-button" onClick={onClose}>
                Fechar
              </button>
              {canAnonymize && (
                <button className="secondary-button danger" onClick={anonymize}>
                  Anonimizar (LGPD)
                </button>
              )}
              <button className="primary-button" onClick={onEdit}>
                Editar {config.singular}
              </button>
            </footer>
          </div>
        ) : (
          <form className="drawer-form" onSubmit={onSubmit}>
            <div className="form-section">
              <span>INFORMAÇÕES PRINCIPAIS</span>
              <label>
                {config.titleLabel}
                <input
                  name="title"
                  required
                  defaultValue={record?.title ?? ""}
                  placeholder={`Informe ${config.titleLabel.toLowerCase()}`}
                  autoFocus
                />
              </label>
              <label>
                {config.descriptionLabel}
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={record?.description ?? ""}
                  placeholder={config.guidance}
                />
              </label>
            </div>
            <div className="form-section">
              <span>DADOS DE {config.singular.toUpperCase()}</span>
              <div className="dynamic-fields">
                {config.fields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    {field.type === "select" ? (
                      <select
                        required={field.required}
                        name={`meta_${field.key}`}
                        defaultValue={record?.metadata?.[field.key] ?? ""}
                      >
                        <option value="">Selecione</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={field.required}
                        name={`meta_${field.key}`}
                        type={field.type}
                        step={field.type === "number" ? "any" : undefined}
                        defaultValue={record?.metadata?.[field.key] ?? ""}
                        placeholder={field.placeholder}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-section">
              <span>ACOMPANHAMENTO</span>
              <div className="form-row">
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={record?.status ?? config.statuses[0].value}
                  >
                    {config.statuses.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prioridade
                  <select
                    name="priority"
                    defaultValue={record?.priority ?? "medium"}
                  >
                    <option value="low">Baixa</option>
                    <option value="medium">Média</option>
                    <option value="high">Alta</option>
                    <option value="critical">Crítica</option>
                  </select>
                </label>
              </div>
              <label>
                Prazo de acompanhamento
                <input
                  name="dueDate"
                  type="date"
                  defaultValue={record?.dueDate ?? ""}
                />
              </label>
            </div>
            <div className="drawer-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button className="primary-button">
                Salvar {config.singular}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}

function formatField(value: string | undefined, type: string) {
  if (!value) return "—";
  if (type === "date")
    return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
  if (type === "number") return Number(value).toLocaleString("pt-BR");
  return value;
}
