"use client";
import { useEffect, useMemo, useState } from "react";

type DocumentItem = {
  id: number;
  recordId: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  department: string;
  module: string;
  documentType: string;
  referenceDate: string;
  expiresAt: string;
  notes: string;
  status: string;
  batchCode: string;
  physicalLocation: string;
  confidentiality: string;
  pageCount: number;
  version: number;
  ocrText: string;
  createdAt: number;
  recordTitle: string;
};
const areas: Record<string, { label: string; modules: string[] }> = {
  rh: {
    label: "Recursos Humanos",
    modules: [
      "Funcionários",
      "EPI",
      "Uniformes",
      "Caminhões – Documentos",
      "Caminhões – Manutenção",
      "Licenças da Empresa",
      "Recrutamento e Seleção",
    ],
  },
  logistica: {
    label: "Logística",
    modules: ["Rotas", "Entregas", "Equipamentos de Transporte"],
  },
  embalagem: {
    label: "Embalagem e Rotulagem",
    modules: ["Rótulos", "Controle de Bombonas", "Estoque de Embalagem"],
  },
  vendas: {
    label: "Vendas",
    modules: ["Clientes", "Propostas e Orçamentos", "Pesquisa de Satisfação"],
  },
  compras: {
    label: "Compras",
    modules: ["Fornecedores", "Pedidos de Compra", "Notas Fiscais de Entrada"],
  },
  financeiro: {
    label: "Financeiro",
    modules: [
      "Notas Fiscais de Saída",
      "Boletos e Recebimentos",
      "Contas a Pagar",
      "DRE e Relatórios",
    ],
  },
};
const types = [
  "Contrato",
  "Nota fiscal",
  "Licença / certificado",
  "Ficha assinada",
  "Comprovante",
  "Documento de veículo",
  "Orçamento / proposta",
  "Laudo / relatório",
  "Imagem digitalizada",
  "XML fiscal",
  "Outro documento",
];
const statusLabel: Record<string, string> = {
  review: "A revisar",
  indexed: "Classificado",
  validated: "Validado",
  archived: "Original arquivado",
  rejected: "Rejeitado",
};
const accepted = ".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.xml";

export default function DocumentCenter({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [docs, setDocs] = useState<DocumentItem[]>([]),
    [batches, setBatches] = useState<
      Array<{
        id: number;
        code: string;
        responsible: string;
        expected_documents: number;
        received_documents: number;
        expected_pages: number;
        received_pages: number;
        divergences: string;
        status: string;
      }>
    >([]),
    [summary, setSummary] = useState<{
      total: number;
      toReview: number;
      expiring: number;
      indexed: number;
      byDepartment: Record<string, number>;
    }>({ total: 0, toReview: 0, expiring: 0, indexed: 0, byDepartment: {} }),
    [loading, setLoading] = useState(true),
    [uploading, setUploading] = useState(""),
    [department, setDepartment] = useState("rh"),
    [module, setModule] = useState(areas.rh.modules[0]),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<DocumentItem | null>(null);
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/documents");
      if (!r.ok) throw new Error();
      const data = await r.json();
      setDocs(data.documents);
      setBatches(data.batches ?? []);
      setSummary(data.summary);
    } catch {
      notify("Não foi possível carregar o acervo digital");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    fetch("/api/documents")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (mounted) {
          setDocs(data.documents);
          setBatches(data.batches ?? []);
          setSummary(data.summary);
        }
      })
      .catch(() => notify("Não foi possível carregar o acervo digital"))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [notify]);
  const visible = useMemo(
    () =>
      docs.filter((d) =>
        `${d.filename} ${d.documentType} ${d.recordTitle} ${d.module} ${d.batchCode} ${d.physicalLocation} ${(d.ocrText || "").slice(0, 4000)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [docs, query],
  );
  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget,
      source = new FormData(formElement),
      files = source
        .getAll("file")
        .filter(
          (value): value is File => value instanceof File && value.size > 0,
        );
    if (!files.length) return;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploading(`${i + 1} de ${files.length} — ${file.name}`);
        const form = new FormData();
        for (const [key, value] of source.entries())
          if (key !== "file") form.append(key, value);
        form.set("department", department);
        form.set("module", module);
        form.set("file", file);
        if (file.type.startsWith("image/")) {
          setUploading(`Lendo o texto de ${file.name} (OCR)...`);
          try {
            const { default: Tesseract } = await import("tesseract.js");
            const { data } = await Tesseract.recognize(file, "por");
            const text = (data.text || "").trim();
            if (text) form.set("ocrText", text.slice(0, 200000));
          } catch {
            // OCR falhou — o documento segue sem texto extraído
          }
          setUploading(`${i + 1} de ${files.length} — ${file.name}`);
        }
        const r = await fetch("/api/documents", { method: "POST", body: form }),
          data = await r.json();
        if (!r.ok) throw new Error(data.error || `Falha em ${file.name}`);
      }
      notify(`${files.length} documento(s) enviado(s) para revisão`);
      formElement.reset();
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar os documentos",
      );
    } finally {
      setUploading("");
    }
  };
  const updateStatus = async (doc: DocumentItem, status: string) => {
    let validationChecklist: Record<string, boolean> | undefined,
      rejectionReason = "";
    if (status === "validated") {
      if (
        !window.confirm(
          "Confirma arquivo completo, legível, classificado e custódia física conferida?",
        )
      )
        return;
      validationChecklist = {
        complete: true,
        legible: true,
        classified: true,
        custody: true,
      };
    }
    if (status === "rejected") {
      rejectionReason =
        window.prompt("Informe o motivo da rejeição:")?.trim() ?? "";
      if (!rejectionReason) return;
    }
    const r = await fetch("/api/documents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...doc,
          status,
          validationChecklist,
          rejectionReason,
        }),
      }),
      data = await r.json();
    if (r.ok) {
      setDocs((list) =>
        list.map((item) => (item.id === doc.id ? { ...item, status } : item)),
      );
      notify("Etapa de conferência atualizada");
    } else notify(data.error || "Não foi possível atualizar o documento");
  };
  const closeBatch = async (id: number) => {
    const r = await fetch("/api/batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }),
      data = await r.json();
    if (r.ok) {
      notify("Lote conferido e encerrado");
      await load();
    } else notify(data.error || "Não foi possível encerrar o lote");
  };
  const reconcileBatch = async (batch: {
    id: number;
    received_documents: number;
    received_pages: number;
  }) => {
    const expectedDocuments = Number(
        window.prompt(
          "Quantidade final de documentos:",
          String(batch.received_documents),
        ),
      ),
      expectedPages = Number(
        window.prompt(
          "Quantidade final de páginas:",
          String(batch.received_pages),
        ),
      ),
      reason = window.prompt("Justificativa do ajuste de inventário:")?.trim();
    if (!reason || !expectedDocuments || !expectedPages) return;
    const r = await fetch("/api/batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: batch.id,
          action: "reconcile",
          expectedDocuments,
          expectedPages,
          reason,
        }),
      }),
      data = await r.json();
    if (r.ok) {
      notify("Divergência reconciliada e auditada");
      await load();
    } else notify(data.error || "Não foi possível reconciliar o lote");
  };
  const saveMetadata = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget),
      payload = {
        ...editing,
        documentType: String(form.get("documentType") || editing.documentType),
        referenceDate: String(form.get("referenceDate") || ""),
        expiresAt: String(form.get("expiresAt") || ""),
        batchCode: String(form.get("batchCode") || ""),
        physicalLocation: String(form.get("physicalLocation") || ""),
        confidentiality: String(form.get("confidentiality") || "internal"),
        pageCount: Number(form.get("pageCount")) || 1,
        notes: String(form.get("notes") || ""),
        ocrText: String(form.get("ocrText") || ""),
      };
    const r = await fetch("/api/documents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (r.ok) {
      setEditing(null);
      notify("Ficha documental atualizada");
      await load();
    } else notify(data.error || "Não foi possível salvar a ficha");
  };
  return (
    <>
      <section className="migration-hero">
        <div>
          <span>CENTRAL DE TRANSFORMAÇÃO DIGITAL</span>
          <h2>Do arquivo físico ao acervo confiável</h2>
          <p>
            Receba lotes, digitalize, classifique e valide cada documento. O
            papel permanece localizado e o CEO encontra a versão digital em
            segundos.
          </p>
        </div>
        <strong>
          {summary.total}
          <small> documentos recebidos</small>
        </strong>
      </section>
      <section className="migration-flow" aria-label="Etapas da digitalização">
        {[
          ["01", "Preparar", "Identificar lote e origem"],
          ["02", "Digitalizar", "Capturar todas as páginas"],
          ["03", "Classificar", "Setor, módulo e tipo"],
          ["04", "Validar", "Conferência humana"],
          ["05", "Custodiar", "Localizar o original"],
        ].map((step, i) => (
          <article key={step[0]}>
            <span>{step[0]}</span>
            <div>
              <strong>{step[1]}</strong>
              <small>{step[2]}</small>
            </div>
            {i < 4 && <b>›</b>}
          </article>
        ))}
      </section>
      <section className="migration-grid">
        <form className="scan-card" onSubmit={upload}>
          <div className="card-title">
            <div>
              <span>NOVO LOTE DE DIGITALIZAÇÃO</span>
              <h3>Importar documentos físicos</h3>
            </div>
            <em>PDF, imagem ou XML · 20 MB por arquivo</em>
          </div>
          <label className="file-drop">
            <input
              name="file"
              type="file"
              multiple
              required
              accept={accepted}
            />
            <span>↑</span>
            <strong>Selecionar um ou vários arquivos</strong>
            <small>
              Prefira PDF pesquisável; cada arquivo será conferido separadamente
            </small>
          </label>
          <div className="scan-fields">
            <label>
              Setor
              <select
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setModule(areas[e.target.value].modules[0]);
                }}
              >
                {Object.entries(areas).map(([key, area]) => (
                  <option value={key} key={key}>
                    {area.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Módulo
              <select
                value={module}
                onChange={(e) => setModule(e.target.value)}
              >
                {areas[department].modules.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Tipo de documento
              <select name="documentType" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Código do lote / caixa
              <input
                name="batchCode"
                required
                placeholder="Ex.: CX-RH-2026-004"
              />
            </label>
            <label>
              Responsável pelo lote
              <input
                name="responsible"
                required
                placeholder="Nome do custodiante"
              />
            </label>
            <label>
              Documentos previstos
              <input
                name="expectedDocuments"
                type="number"
                min="1"
                defaultValue="1"
              />
            </label>
            <label>
              Páginas previstas
              <input
                name="expectedPages"
                type="number"
                min="1"
                defaultValue="1"
              />
            </label>
            <label>
              Localização do original
              <input
                name="physicalLocation"
                required
                placeholder="Arquivo A · Estante 2 · Caixa 4"
              />
            </label>
            <label>
              Nível de acesso
              <select name="confidentiality" defaultValue="internal">
                <option value="internal">Interno</option>
                <option value="restricted">Restrito / direção</option>
                <option value="confidential">Confidencial / direção</option>
              </select>
            </label>
            <label>
              Data do documento
              <input name="referenceDate" type="date" />
            </label>
            <label>
              Validade, se houver
              <input name="expiresAt" type="date" />
            </label>
            <label>
              Número de páginas
              <input
                name="pageCount"
                type="number"
                min="1"
                max="5000"
                defaultValue="1"
              />
            </label>
            <label className="full">
              Observações de custódia
              <textarea
                name="notes"
                rows={2}
                placeholder="Estado do original, responsável pela entrega ou informação importante"
              />
            </label>
          </div>
          <button
            className="primary-button scan-submit"
            disabled={Boolean(uploading)}
          >
            {uploading ? `Enviando ${uploading}...` : "Enviar para conferência"}
          </button>
        </form>
        <aside className="migration-aside">
          <h3>Controle da migração</h3>
          <div className="migration-stats">
            <article>
              <span>Recebidos</span>
              <strong>{summary.total}</strong>
              <small>arquivos privados</small>
            </article>
            <article>
              <span>Requer revisão</span>
              <strong>{summary.toReview}</strong>
              <small>conferência humana</small>
            </article>
            <article>
              <span>Validade próxima</span>
              <strong>{summary.expiring}</strong>
              <small>próximos 30 dias</small>
            </article>
            <article>
              <span>Disponíveis</span>
              <strong>{summary.indexed}</strong>
              <small>classificados ou validados</small>
            </article>
          </div>
          {batches.length > 0 && (
            <div className="batch-progress">
              <strong>Lotes em andamento</strong>
              {batches.slice(0, 4).map((batch) => {
                const progress = Math.min(
                  100,
                  Math.round(
                    (batch.received_documents / batch.expected_documents) * 100,
                  ),
                );
                return (
                  <article key={batch.id}>
                    <div>
                      <span>{batch.code}</span>
                      <b>{progress}%</b>
                    </div>
                    <small>
                      {batch.received_documents}/{batch.expected_documents} docs
                      · {batch.received_pages}/{batch.expected_pages} páginas
                    </small>
                    <i>
                      <em style={{ width: `${progress}%` }} />
                    </i>
                    {batch.divergences && (
                      <button
                        type="button"
                        onClick={() => reconcileBatch(batch)}
                      >
                        Resolver divergência
                      </button>
                    )}
                    {progress === 100 && batch.status === "open" && (
                      <button
                        type="button"
                        onClick={() => closeBatch(batch.id)}
                      >
                        Encerrar após conferência
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <div className="sector-coverage">
            <strong>Documentos por setor</strong>
            {Object.entries(areas).map(([key, area]) => (
              <div key={key}>
                <span>{area.label}</span>
                <b>{summary.byDepartment[key] ?? 0}</b>
              </div>
            ))}
          </div>
          <div className="quality-check">
            <strong>Conferência obrigatória</strong>
            <ul>
              <li>Página inteira, sem cortes e legível</li>
              <li>Frente, verso e anexos incluídos</li>
              <li>Lote e localização física corretos</li>
              <li>Validade e classificação conferidas</li>
            </ul>
            <p>
              Não descarte o original antes de validar a obrigação legal e a
              política de retenção.
            </p>
          </div>
        </aside>
      </section>
      <section className="panel archive-panel">
        <div className="panel-heading">
          <div>
            <h2>Acervo digital</h2>
            <p>
              Documentos privados, rastreáveis e vinculados aos registros
              operacionais.
            </p>
          </div>
          <div className="archive-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Arquivo, lote, local ou módulo..."
            />
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
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Classificação</th>
                  <th>Lote / original</th>
                  <th>Validade</th>
                  <th>Situação</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <strong>{doc.filename}</strong>
                      <small>
                        {formatSize(doc.sizeBytes)} · {doc.pageCount} pág. · v
                        {doc.version}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {areas[doc.department]?.label ?? doc.department}
                      </strong>
                      <small>
                        {doc.module} · {doc.documentType}
                      </small>
                    </td>
                    <td>
                      <strong>{doc.batchCode || "Sem lote"}</strong>
                      <small>
                        {doc.physicalLocation || "Local não informado"}
                      </small>
                    </td>
                    <td>
                      {doc.expiresAt
                        ? new Date(
                            `${doc.expiresAt}T12:00:00`,
                          ).toLocaleDateString("pt-BR")
                        : "Sem validade"}
                    </td>
                    <td>
                      <select
                        className={`doc-status ${doc.status}`}
                        value={doc.status}
                        onChange={(e) => updateStatus(doc, e.target.value)}
                      >
                        <option value={doc.status}>
                          {statusLabel[doc.status]}
                        </option>
                        {doc.status === "review" && (
                          <>
                            <option value="indexed">Classificar</option>
                            <option value="rejected">Rejeitar</option>
                          </>
                        )}
                        {doc.status === "rejected" && (
                          <option value="review">Reenviar à revisão</option>
                        )}
                        {doc.status === "indexed" && (
                          <>
                            <option value="validated">
                              Validar com checklist
                            </option>
                            <option value="review">Voltar à revisão</option>
                          </>
                        )}
                        {doc.status === "validated" && (
                          <>
                            <option value="archived">
                              Confirmar custódia do original
                            </option>
                            <option value="review">Reabrir revisão</option>
                          </>
                        )}
                      </select>
                    </td>
                    <td>
                      <button
                        className="download-button edit-doc"
                        onClick={() => setEditing(doc)}
                      >
                        Editar
                      </button>
                      <a
                        className="download-button"
                        href={`/api/documents?download=${doc.id}`}
                      >
                        Baixar
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>▤</span>
            <h3>O acervo digital começa aqui</h3>
            <p>Identifique a primeira caixa e importe seus documentos.</p>
          </div>
        )}
      </section>
      {editing && (
        <div
          className="doc-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Editar ficha documental"
          onMouseDown={() => setEditing(null)}
        >
          <form
            onSubmit={saveMetadata}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>FICHA DOCUMENTAL</span>
                <h3>Editar classificação e custódia</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>
            <div className="scan-fields">
              <label>
                Tipo
                <select name="documentType" defaultValue={editing.documentType}>
                  {types.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                Lote
                <input
                  name="batchCode"
                  required
                  defaultValue={editing.batchCode}
                />
              </label>
              <label>
                Localização do original
                <input
                  name="physicalLocation"
                  required
                  defaultValue={editing.physicalLocation}
                />
              </label>
              <label>
                Nível de acesso
                <select
                  name="confidentiality"
                  defaultValue={editing.confidentiality}
                >
                  <option value="internal">Interno</option>
                  <option value="restricted">Restrito / direção</option>
                  <option value="confidential">Confidencial / direção</option>
                </select>
              </label>
              <label>
                Data do documento
                <input
                  name="referenceDate"
                  type="date"
                  defaultValue={editing.referenceDate}
                />
              </label>
              <label>
                Validade
                <input
                  name="expiresAt"
                  type="date"
                  defaultValue={editing.expiresAt}
                />
              </label>
              <label>
                Páginas
                <input
                  name="pageCount"
                  type="number"
                  min="1"
                  defaultValue={editing.pageCount}
                />
              </label>
              <label className="full">
                Observações
                <textarea name="notes" rows={3} defaultValue={editing.notes} />
              </label>
              <label className="full">
                Texto extraído (OCR) — usado na busca
                <textarea
                  name="ocrText"
                  rows={5}
                  defaultValue={editing.ocrText}
                  placeholder="Texto reconhecido da imagem. Confira e corrija trechos importantes."
                />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <button className="primary-button">Salvar ficha</button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function RecordDocuments({
  recordId,
  department,
  module,
  notify,
}: {
  recordId: number;
  department: string;
  module: string;
  notify?: (message: string) => void;
}) {
  const [docs, setDocs] = useState<DocumentItem[]>([]),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const r = await fetch(`/api/documents?recordId=${recordId}`);
    if (r.ok) setDocs((await r.json()).documents);
  };
  useEffect(() => {
    let mounted = true;
    fetch(`/api/documents?recordId=${recordId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (mounted) setDocs(data.documents);
      })
      .catch(() => notify?.("Não foi possível carregar os anexos"));
    return () => {
      mounted = false;
    };
  }, [recordId, notify]);
  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    form.set("recordId", String(recordId));
    form.set("department", department);
    form.set("module", module);
    try {
      const r = await fetch("/api/documents", { method: "POST", body: form }),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      notify?.("Documento anexado e enviado para revisão");
      e.currentTarget.reset();
      await load();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : "Falha no envio");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="record-documents">
      <div className="record-doc-head">
        <div>
          <strong>Documentos digitais</strong>
          <small>{docs.length} arquivo(s) vinculado(s)</small>
        </div>
      </div>
      {docs.map((doc) => (
        <a href={`/api/documents?download=${doc.id}`} key={doc.id}>
          <span>{doc.contentType.includes("pdf") ? "PDF" : "DOC"}</span>
          <div>
            <strong>{doc.filename}</strong>
            <small>
              {doc.documentType} · {statusLabel[doc.status]} ·{" "}
              {formatSize(doc.sizeBytes)}
            </small>
          </div>
          <b>↓</b>
        </a>
      ))}
      <form onSubmit={upload} className="attach-form">
        <div className="attach-meta">
          <input name="documentType" required placeholder="Tipo do documento" />
          <input name="batchCode" required placeholder="Código do lote/caixa" />
          <input
            name="responsible"
            required
            placeholder="Responsável pelo lote"
          />
          <input
            name="physicalLocation"
            required
            placeholder="Localização física do original"
          />
          <label>
            Docs previstos
            <input
              name="expectedDocuments"
              type="number"
              min="1"
              defaultValue="1"
            />
          </label>
          <label>
            Páginas previstas
            <input
              name="expectedPages"
              type="number"
              min="1"
              defaultValue="1"
            />
          </label>
          <label>
            Páginas deste arquivo
            <input name="pageCount" type="number" min="1" defaultValue="1" />
          </label>
        </div>
        <label>
          <input name="file" type="file" required accept={accepted} />
          <span>+ Anexar documento digitalizado</span>
        </label>
        <button disabled={busy}>{busy ? "Enviando..." : "Enviar"}</button>
      </form>
    </section>
  );
}
