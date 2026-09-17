"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Vehicle = {
  id: number;
  plate: string;
  brand: string;
  model: string;
  capacityKg: number | null;
  capacityM3: number | null;
  modelYear: number | null;
  vehicleType: string;
  odometerKm: number;
  maintIntervalKm: number | null;
  maintIntervalMonths: number | null;
  status: string;
  statusLabel: string;
  renavam: string;
  chassis: string;
  notes: string;
  documentsCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  lastMaintenance: { type: string; date: string; odometerKm: number } | null;
  alert: { level: "ok" | "warn" | "danger"; items: string[] };
};
type VDoc = {
  id: number;
  docType: string;
  number: string;
  issuingBody: string;
  issueDate: string;
  expiryDate: string;
  hasFile: boolean;
  fileName: string;
  sizeBytes: number;
  notes: string;
};
type VMaint = {
  id: number;
  vehicleId: number;
  plate: string;
  model: string;
  maintType: string;
  serviceDate: string;
  odometerKm: number;
  description: string;
  supplier: string;
  costCents: number;
  nextDueKm: number | null;
  nextDueDate: string;
  status: string;
  notes: string;
};
type Driver = { id: number; name: string; cpf: string; phone: string; licenseNumber: string; licenseCategory: string; licenseExpiry: string; moppExpiry: string; status: string; notes: string; alerts: string[] };
type VehicleFull = {
  vehicle: Vehicle;
  documents: VDoc[];
  maintenance: VMaint[];
  alert: { level: "ok" | "warn" | "danger"; items: string[] };
};
type TruckRoute = { id: number; vehicleId: number; name: string; code: string; driverName: string; routeDate: string; status: string; loadedKg: number; capacityKg: number | null; occupancy: number | null; loadedM3: number; capacityM3: number | null; volumeOccupancy: number | null; volumeDataComplete: boolean; loadSummary: { packageType: string; unitWeightKg: number; count: number }[]; productSummary: { productName: string; quantity: number; unit: string; unNumber: string; hazardClass: string }[]; hazardousLoad: boolean; hasValidMopp: boolean; safetyNotices: string[]; stops: { id: number; sequence: number; customerName: string; orderNumber: string; address: string; weightKg: number; volumeM3: number; packageSummary: string; receivingWindow: string; paymentTerms: string }[] };

const docTypes = [
  "CRLV",
  "Licenciamento",
  "Seguro",
  "ANTT",
  "Tacógrafo",
  "Inspeção veicular",
  "Outro",
];
const maintTypes = ["Preventiva", "Corretiva", "Inspeção", "Pneus", "Outro"];
const maintStatuses = [
  { value: "scheduled", label: "Agendada" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluída" },
  { value: "cancelled", label: "Cancelada" },
];
const vehicleStatuses = [
  { value: "active", label: "Ativo" },
  { value: "in_maintenance", label: "Em manutenção" },
  { value: "retired", label: "Baixado" },
];
const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const fmtKm = (km: number) => km.toLocaleString("pt-BR");
const fmtDateBR = (iso: string) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtBytes = (bytes: number) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const daysTo = (iso: string) =>
  iso
    ? Math.ceil(
        (new Date(`${iso}T12:00:00`).getTime() - Date.now()) / (1000 * 86400),
      )
    : null;
const alertLabel = (level: Vehicle["alert"]["level"]) =>
  level === "danger" ? "Atenção" : level === "warn" ? "Aviso" : "Em dia";
const centsFromBRL = (text: string) => {
  const cleaned = String(text)
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

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
        className="product-modal-card ord-modal-card"
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

export default function FleetCenter({
  notify,
  canWrite = true,
  initialTab = "vehicles",
}: {
  notify: (message: string) => void;
  canWrite?: boolean;
  initialTab?: "vehicles" | "drivers" | "maintenance";
}) {
  const [tab, setTab] = useState<"vehicles" | "drivers" | "maintenance">(initialTab);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    inMaintenance: 0,
    attention: 0,
    danger: 0,
  });
  const [maintenance, setMaintenance] = useState<VMaint[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const loadVehicles = useCallback(async () => {
    try {
      const r = await fetch("/api/vehicles");
      if (!r.ok) throw new Error();
      const data = await r.json();
      setVehicles(data.vehicles ?? []);
      setSummary(data.summary);
    } catch {
      notify("Não foi possível carregar a frota");
    }
  }, [notify]);
  const loadMaintenance = useCallback(async () => {
    try {
      const r = await fetch("/api/vehicle-maintenance?limit=200");
      if (!r.ok) throw new Error();
      setMaintenance((await r.json()).maintenance ?? []);
    } catch {
      /* agenda secundária */
    }
  }, []);
  const loadDrivers = useCallback(async () => {
    try {
      const r = await fetch("/api/drivers");
      if (!r.ok) throw new Error();
      setDrivers((await r.json()).drivers ?? []);
    } catch {
      notify("Não foi possível carregar os motoristas");
    }
  }, [notify]);

  useEffect(() => {
    Promise.all([loadVehicles(), loadMaintenance(), loadDrivers()]).finally(() =>
      setLoading(false),
    );
  }, [loadVehicles, loadMaintenance, loadDrivers]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadVehicles(), loadMaintenance(), loadDrivers()]);
  }, [loadVehicles, loadMaintenance, loadDrivers]);

  const tabs = [
    ["vehicles", "Veículos", `${summary.total}`],
    ["drivers", "Motoristas", `${drivers.filter(driver => driver.status === "active").length}`],
    ["maintenance", "Manutenções", ""],
  ] as const;
  const okCount = summary.total - summary.attention;

  return (
    <>
      <section className="migration-hero">
        <div>
          <p className="eyebrow">GESTÃO DA FROTA</p>
          <h2>Veículos, documentos e revisões em dia</h2>
          <p>
            Cadastre caminhões e motoristas, acompanhe CRLV, seguro, CNH e
            MOPP, e controle as manutenções periódicas por km
            e por tempo — com alerta antes de vencer.
          </p>
        </div>
        {canWrite && (
          <button className="fleet-hero-driver-button" onClick={() => setTab("drivers")}>
            Gerenciar motoristas
          </button>
        )}
      </section>
      <section className="ord-kpis">
        <article>
          <span>Veículos ativos</span>
          <strong>{summary.active}</strong>
        </article>
        <article>
          <span>Em manutenção</span>
          <strong>{summary.inMaintenance}</strong>
        </article>
        <article className={summary.danger ? "flt-alert-card" : ""}>
          <span>Exigem atenção</span>
          <strong>{summary.attention}</strong>
        </article>
        <article>
          <span>Em dia</span>
          <strong>{okCount}</strong>
        </article>
      </section>
      <div className="product-tabs" role="tablist" aria-label="Frota">
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
      ) : tab === "vehicles" ? (
        <VehiclesTab
          vehicles={vehicles}
          canWrite={canWrite}
          notify={notify}
          onChanged={loadVehicles}
          onOpen={(id) => setOpenId(id)}
        />
      ) : tab === "drivers" ? (
        <DriversTab drivers={drivers} canWrite={canWrite} notify={notify} onChanged={loadDrivers} />
      ) : (
        <MaintenanceTab
          maintenance={maintenance}
          vehicles={vehicles}
          canWrite={canWrite}
          notify={notify}
          onChanged={reloadAll}
        />
      )}
      {openId !== null && (
        <VehicleDetailModal
          vehicleId={openId}
          canWrite={canWrite}
          notify={notify}
          onClose={() => setOpenId(null)}
          onChanged={reloadAll}
        />
      )}
    </>
  );
}

function AlertPill({ alert }: { alert: Vehicle["alert"] }) {
  return (
    <span className={`flt-pill ${alert.level}`} title={alert.items.join(" · ")}>
      {alert.level === "ok" ? "✓ " : alert.level === "warn" ? "! " : "▲ "}
      {alertLabel(alert.level)}
    </span>
  );
}

function VehiclesTab({
  vehicles,
  canWrite,
  notify,
  onChanged,
  onOpen,
}: {
  vehicles: Vehicle[];
  canWrite: boolean;
  notify: (message: string) => void;
  onChanged: () => void;
  onOpen: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const visible = vehicles.filter(
    (v) =>
      (!statusFilter || v.status === statusFilter) &&
      (!query ||
        `${v.plate} ${v.brand} ${v.model} ${v.renavam}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <section className="panel archive-panel">
      <div className="section-title">
        <div>
          <h2>Frota de caminhões</h2>
          <p>
            Placa, modelo, km atual e alertas de documento e revisão por
            veículo.
          </p>
        </div>
        {canWrite && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Novo veículo
          </button>
        )}
      </div>
      <div className="ord-toolbar">
        <div className="archive-search">
          <span>⌕</span>
          <input
            aria-label="Buscar veículos"
            placeholder="Buscar por placa, modelo ou RENAVAM..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="Filtrar por situação"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="flt-select"
        >
          <option value="">Todas as situações</option>
          {vehicleStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {visible.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Veículo</th>
                <th>Km atual</th>
                <th>Documentos</th>
                <th>Última manutenção</th>
                <th>Alerta</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td>
                    <strong className="flt-plate">{vehicle.plate}</strong>
                    <small>
                      {" "}
                    {[vehicle.brand, vehicle.model, vehicle.modelYear]
                        .filter(Boolean)
                      .join(" ")}{vehicle.capacityM3 ? ` · ${vehicle.capacityM3.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m³` : ""}
                    </small>
                  </td>
                  <td>{fmtKm(vehicle.odometerKm)} km</td>
                  <td>
                    <span className="flt-chip">total {vehicle.documentsCount}</span>
                    {vehicle.expiredCount > 0 && (
                      <span className="flt-chip danger">
                        {vehicle.expiredCount} vencido
                        {vehicle.expiredCount > 1 ? "s" : ""}
                      </span>
                    )}
                    {vehicle.expiringSoonCount > 0 && (
                      <span className="flt-chip warn">
                        {vehicle.expiringSoonCount} vencem em breve
                      </span>
                    )}
                    {!vehicle.documentsCount && (
                      <small style={{ color: "#9aa1ad" }}>sem registros</small>
                    )}
                  </td>
                  <td>
                    {vehicle.lastMaintenance ? (
                      <>
                        {vehicle.lastMaintenance.type} ·{" "}
                        {fmtDateBR(vehicle.lastMaintenance.date)} ·{" "}
                        {fmtKm(vehicle.lastMaintenance.odometerKm)} km
                      </>
                    ) : (
                      <small style={{ color: "#9aa1ad" }}>—</small>
                    )}
                  </td>
                  <td>
                    <AlertPill alert={vehicle.alert} />
                  </td>
                  <td>
                    <span className={`flt-status ${vehicle.status}`}>
                      <span className="k" />
                      {vehicle.statusLabel}
                    </span>
                  </td>
                  <td>
                    <button
                      className="primary-button"
                      onClick={() => onOpen(vehicle.id)}
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ord-empty">
          {vehicles.length
            ? "Nenhum veículo corresponde à busca."
            : "Nenhum veículo cadastrado. Cadastre o primeiro caminhão da frota."}
        </div>
      )}
      {creating && (
        <VehicleFormModal
          vehicle={null}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

const emptyVehicle = {
  plate: "",
  renavam: "",
  chassis: "",
  brand: "",
  model: "",
  modelYear: "",
  vehicleType: "Caminhão",
  capacityKg: "",
  capacityM3: "",
  odometerKm: "0",
  maintIntervalKm: "",
  maintIntervalMonths: "",
  status: "active",
  notes: "",
};
type VehicleFormState = typeof emptyVehicle;

function VehicleFormModal({
  vehicle,
  notify,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle | null;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<VehicleFormState>(
    vehicle
      ? {
          plate: vehicle.plate,
          renavam: vehicle.renavam,
          chassis: vehicle.chassis,
          brand: vehicle.brand,
          model: vehicle.model,
          modelYear: vehicle.modelYear ? String(vehicle.modelYear) : "",
          vehicleType: vehicle.vehicleType,
          capacityKg: vehicle.capacityKg ? String(vehicle.capacityKg) : "",
          capacityM3: vehicle.capacityM3 ? String(vehicle.capacityM3) : "",
          odometerKm: String(vehicle.odometerKm),
          maintIntervalKm: vehicle.maintIntervalKm
            ? String(vehicle.maintIntervalKm)
            : "",
          maintIntervalMonths: vehicle.maintIntervalMonths
            ? String(vehicle.maintIntervalMonths)
            : "",
          status: vehicle.status,
          notes: vehicle.notes,
        }
      : emptyVehicle,
  );
  const [saving, setSaving] = useState(false);
  const set = (key: keyof VehicleFormState) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm({ ...form, [key]: event.target.value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/vehicles", {
        method: vehicle ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...(vehicle ? { id: vehicle.id } : {}),
          modelYear: form.modelYear ? Number(form.modelYear) : null,
          capacityKg: form.capacityKg ? Number(form.capacityKg) : null,
          capacityM3: form.capacityM3 ? Number(form.capacityM3.replace(",", ".")) : null,
          odometerKm: Number(form.odometerKm || 0),
          maintIntervalKm: form.maintIntervalKm
            ? Number(form.maintIntervalKm)
            : null,
          maintIntervalMonths: form.maintIntervalMonths
            ? Number(form.maintIntervalMonths)
            : null,
        }),
      });
      const data = await r.json();
      if (r.ok) {
        notify(
          vehicle
            ? `Veículo ${data.vehicle.plate} atualizado`
            : `Veículo ${data.vehicle.plate} cadastrado`,
        );
        onSaved();
      } else notify(data.error || "Não foi possível salvar o veículo");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={vehicle ? `Editar veículo ${vehicle.plate}` : "Novo veículo"}
      eyebrow="FROTA"
      onClose={onClose}
    >
      <form onSubmit={submit} className="ord-detail">
        <div className="ord-section">
          <header>
            <div>
              <h4>Identificação do veículo</h4>
              <p>Placa no padrão Mercosul (ABC1D23) ou antigo (ABC1234).</p>
            </div>
          </header>
          <div className="ord-form-grid">
            <div className="ord-field">
              <label htmlFor="v-plate">Placa *</label>
              <input
                id="v-plate"
                value={form.plate}
                onChange={set("plate")}
                placeholder="ABC1D23"
                style={{ textTransform: "uppercase" }}
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-brand">Marca</label>
              <input
                id="v-brand"
                value={form.brand}
                onChange={set("brand")}
                placeholder="Volvo"
              />
            </div>
            <div className="ord-field span2">
              <label htmlFor="v-model">Modelo *</label>
              <input
                id="v-model"
                value={form.model}
                onChange={set("model")}
                placeholder="VM 270"
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-year">Ano</label>
              <input
                id="v-year"
                inputMode="numeric"
                value={form.modelYear}
                onChange={set("modelYear")}
                placeholder="2023"
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-type">Tipo</label>
              <select id="v-type" value={form.vehicleType} onChange={set("vehicleType")}>
                {["Caminhão", "Cavalo mecânico", "Carreta", "Truck", "VUC", "Van", "Outro"].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="ord-field">
              <label htmlFor="v-capacity">Capacidade (kg)</label>
              <input
                id="v-capacity"
                inputMode="numeric"
                value={form.capacityKg}
                onChange={set("capacityKg")}
                placeholder="14000"
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-capacity-m3">Capacidade útil (m³)</label>
              <input id="v-capacity-m3" inputMode="decimal" value={form.capacityM3} onChange={set("capacityM3")} placeholder="Ex.: 32,5" />
            </div>
            <div className="ord-field">
              <label htmlFor="v-renavam">RENAVAM</label>
              <input id="v-renavam" value={form.renavam} onChange={set("renavam")} />
            </div>
            <div className="ord-field span3">
              <label htmlFor="v-chassis">Chassi</label>
              <input id="v-chassis" value={form.chassis} onChange={set("chassis")} />
            </div>
          </div>
        </div>
        <div className="ord-section">
          <header>
            <div>
              <h4>Km e revisão periódica</h4>
              <p>
                Defina o intervalo da revisão preventiva (km e/ou meses). O
                sistema calcula a próxima revisão a cada manutenção concluída.
              </p>
            </div>
          </header>
          <div className="ord-form-grid">
            <div className="ord-field">
              <label htmlFor="v-odo">Odômetro atual (km)</label>
              <input
                id="v-odo"
                inputMode="numeric"
                value={form.odometerKm}
                onChange={set("odometerKm")}
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-int-km">Revisão a cada (km)</label>
              <input
                id="v-int-km"
                inputMode="numeric"
                value={form.maintIntervalKm}
                onChange={set("maintIntervalKm")}
                placeholder="10000"
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-int-months">ou a cada (meses)</label>
              <input
                id="v-int-months"
                inputMode="numeric"
                value={form.maintIntervalMonths}
                onChange={set("maintIntervalMonths")}
                placeholder="3"
              />
            </div>
            <div className="ord-field">
              <label htmlFor="v-status">Situação</label>
              <select id="v-status" value={form.status} onChange={set("status")}>
                {vehicleStatuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ord-field span4">
              <label htmlFor="v-notes">Observações</label>
              <textarea
                id="v-notes"
                value={form.notes}
                onChange={set("notes")}
                placeholder="Carroceria, tanque, restrições, apelido do caminhão..."
              />
            </div>
          </div>
        </div>
        <button
          type="submit"
          className="primary-button"
          disabled={saving}
          style={{ justifySelf: "start" }}
        >
          {saving ? "Salvando..." : vehicle ? "Salvar alterações" : "Cadastrar veículo"}
        </button>
      </form>
    </Modal>
  );
}

function VehicleDetailModal({
  vehicleId,
  canWrite,
  notify,
  onClose,
  onChanged,
}: {
  vehicleId: number;
  canWrite: boolean;
  notify: (message: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [full, setFull] = useState<VehicleFull | null>(null);
  const [routes, setRoutes] = useState<TruckRoute[]>([]);
  const [error, setError] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [showMaintForm, setShowMaintForm] = useState(false);
  const load = useCallback(async () => {
    try {
      const [r, routesResponse] = await Promise.all([fetch(`/api/vehicles?id=${vehicleId}`), fetch("/api/routes")]);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setFull(data);
      if (routesResponse.ok) { const routeData = await routesResponse.json(); setRoutes((routeData.routes ?? []).filter((route: TruckRoute) => route.vehicleId === vehicleId)); }
    } catch {
      setError("Não foi possível carregar o veículo.");
    }
  }, [vehicleId]);
  useEffect(() => {
    load();
  }, [load]);
  const vehicle = full?.vehicle ?? null;

  const downloadDoc = (docId: number) =>
    window.open(
      `/api/vehicle-docs?download=${docId}`,
      "_blank",
      "noopener",
    );
  const removeDoc = async (doc: VDoc) => {
    if (!window.confirm(`Remover o registro ${doc.docType} (${doc.number || "sem número"})?`))
      return;
    const r = await fetch(`/api/vehicle-docs?id=${doc.id}`, { method: "DELETE" });
    if (r.ok) {
      notify("Documento removido");
      await load();
      onChanged();
    } else notify("Não foi possível remover o documento");
  };
  return (
    <Modal
      title={vehicle ? `${vehicle.plate} — ${vehicle.model}` : "Carregando..."}
      eyebrow="GESTÃO DO VEÍCULO"
      onClose={onClose}
    >
      {!full || !vehicle ? (
        <div className="ord-empty">{error || "Carregando..."}</div>
      ) : (
        <div className="ord-detail">
          <div className="ord-section">
            <header>
              <div>
                <h4>
                  {vehicle.brand} {vehicle.model}
                  {vehicle.modelYear ? ` ${vehicle.modelYear}` : ""}
                </h4>
                <p>
                  {vehicle.vehicleType}
                  {vehicle.capacityKg ? ` · ${fmtKm(vehicle.capacityKg)} kg` : ""}
                  {vehicle.renavam ? ` · RENAVAM ${vehicle.renavam}` : ""}
                  {vehicle.chassis ? ` · Chassi ${vehicle.chassis}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`flt-status ${vehicle.status}`}>
                  <span className="k" />
                  {vehicle.statusLabel}
                </span>
                <AlertPill alert={full.alert} />
                {canWrite && (
                  <button className="ghost-button" onClick={() => setShowEdit(true)}>
                    Editar
                  </button>
                )}
              </div>
            </header>
            <div className="ord-form-grid">
              <div className="ord-field">
                <label>Odômetro atual</label>
                <strong style={{ fontSize: 18 }}>{fmtKm(vehicle.odometerKm)} km</strong>
              </div>
              <div className="ord-field">
                <label>Revisão a cada</label>
                <strong style={{ fontSize: 18 }}>
                  {[vehicle.maintIntervalKm ? `${fmtKm(vehicle.maintIntervalKm)} km` : "", vehicle.maintIntervalMonths ? `${vehicle.maintIntervalMonths} meses` : ""].filter(Boolean).join(" / ") || "não definido"}
                </strong>
              </div>
              {full.alert.items.length > 0 && (
                <div className="ord-field span2">
                  <label>Alertas ativos</label>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#7a4a12" }}>
                    {full.alert.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          {showEdit && canWrite && (
            <VehicleFormModal
              vehicle={vehicle}
              notify={notify}
              onClose={() => setShowEdit(false)}
              onSaved={() => {
                setShowEdit(false);
                load();
                onChanged();
              }}
            />
          )}

          <div className="ord-section truck-routes">
            <header><div><h4>Rotas e cargas atribuídas</h4><p>Pedidos vinculados automaticamente a este caminhão.</p></div><strong>{routes.length} rota(s)</strong></header>
            {routes.length ? routes.map(route => <article className="truck-route" key={route.id}><div className="truck-route-heading"><div><strong>{route.name}</strong><small>{route.code} · {route.routeDate} · {route.driverName || "Motorista não definido"}</small></div><span>{route.loadedKg.toLocaleString("pt-BR")} kg{route.capacityKg ? ` · ${route.occupancy ?? 0}%` : ""}<small>{route.volumeDataComplete ? ` · ${route.loadedM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³${route.capacityM3 ? ` · ${route.volumeOccupancy}%` : ""}` : " · cubagem incompleta"}</small></span></div>{route.loadSummary.length > 0 && <div className="truck-load-tags">{route.loadSummary.map(item => <span key={`${item.packageType}-${item.unitWeightKg}`}>{item.count.toLocaleString("pt-BR")} {item.packageType}{item.unitWeightKg ? ` de ${item.unitWeightKg.toLocaleString("pt-BR")} kg` : ""}</span>)}</div>}{route.productSummary.length > 0 && <div className="truck-load-tags">{route.productSummary.map(item => <span key={`${item.productName}-${item.unit}`}>{item.productName}: {item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} {item.unit}{item.unNumber ? ` · ONU ${item.unNumber}` : ""}</span>)}</div>}{route.safetyNotices.length > 0 && <div className="truck-safety-alert">{route.safetyNotices.map(notice => <small key={notice}>{notice}</small>)}</div>}<div className="truck-stops">{route.stops.map(stop => <div key={stop.id}><b>{stop.sequence}</b><span><strong>{stop.customerName} · {stop.orderNumber}</strong><small>{stop.address || "Endereço não informado"}</small><small>Recebimento: {stop.receivingWindow || "sem restrição informada"}</small><small>{stop.packageSummary || `${stop.weightKg.toLocaleString("pt-BR")} kg`} · {stop.volumeM3 ? `${stop.volumeM3.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³ · ` : "cubagem não informada · "}Pagamento: {stop.paymentTerms || "não informado"}</small></span></div>)}</div></article>) : <p className="ord-empty">Nenhuma rota atribuída a este caminhão.</p>}
          </div>

          <div className="ord-section">
            <header>
              <div>
                <h4>Documentos e validades</h4>
                <p>
                  CRLV, licenciamento, seguro, ANTT e inspeções — validade vencida
                  gera alerta no veículo.
                </p>
              </div>
              {canWrite && (
                <button
                  className="ghost-button"
                  onClick={() => setShowDocForm((value) => !value)}
                >
                  {showDocForm ? "Cancelar" : "+ Documento"}
                </button>
              )}
            </header>
            {showDocForm && canWrite && (
              <DocForm
                vehicleId={vehicleId}
                notify={notify}
                onDone={() => {
                  setShowDocForm(false);
                  load();
                  onChanged();
                }}
              />
            )}
            {full.documents.length ? (
              <div className="ord-docs">
                {full.documents.map((doc) => {
                  const days = daysTo(doc.expiryDate);
                  const state =
                    days === null || days === undefined || (doc.docType === "Outro" && !doc.expiryDate)
                      ? ""
                      : days < 0
                        ? "danger"
                        : days <= 30
                          ? "warn"
                          : "ok";
                  return (
                    <div className="ord-doc" key={doc.id}>
                      <span className={`flt-doc-type ${state}`}>
                        {state === "ok" ? "✓" : state === "warn" ? "!" : "▲"}{" "}
                        {doc.docType}
                      </span>
                      <div className="name">
                        {doc.number || doc.issuingBody || doc.fileName || "Registro"}
                        <small>
                          {doc.issueDate
                            ? `Emissão ${fmtDateBR(doc.issueDate)} · `
                            : ""}
                          {doc.expiryDate
                            ? `Validade ${fmtDateBR(doc.expiryDate)}`
                            : "Sem validade"}
                          {days !== null &&
                            days !== undefined &&
                            doc.expiryDate &&
                            days < 0 &&
                            ` (vencido há ${Math.abs(days)} dia(s))`}
                          {days !== null &&
                            days !== undefined &&
                            doc.expiryDate &&
                            days >= 0 &&
                            days <= 30 &&
                            ` (vence em ${days} dia(s))`}
                          {doc.hasFile ? ` · ${fmtBytes(doc.sizeBytes)}` : " · sem arquivo"}
                        </small>
                      </div>
                      {doc.hasFile && (
                        <button onClick={() => downloadDoc(doc.id)}>Baixar</button>
                      )}
                      {canWrite && (
                        <button className="danger" onClick={() => removeDoc(doc)}>
                          Remover
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#9aa1ad" }}>
                Nenhum documento registrado para este veículo.
              </p>
            )}
          </div>

          <div className="ord-section">
            <header>
              <div>
                <h4>Manutenções do veículo</h4>
                <p>
                  Histórico de serviços com km e custo; a preventiva concluída
                  agenda a próxima revisão.
                </p>
              </div>
              {canWrite && (
                <button
                  className="ghost-button"
                  onClick={() => setShowMaintForm((value) => !value)}
                >
                  {showMaintForm ? "Cancelar" : "+ Manutenção"}
                </button>
              )}
            </header>
            {showMaintForm && canWrite && (
              <MaintForm
                vehicle={vehicle}
                notify={notify}
                onDone={() => {
                  setShowMaintForm(false);
                  load();
                  onChanged();
                }}
              />
            )}
            {full.maintenance.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th>Km</th>
                      <th>Serviço</th>
                      <th>Fornecedor</th>
                      <th>Custo</th>
                      <th>Próxima revisão</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {full.maintenance.map((m) => (
                      <tr key={m.id}>
                        <td>{fmtDateBR(m.serviceDate)}</td>
                        <td>{m.maintType}</td>
                        <td>{fmtKm(m.odometerKm)} km</td>
                        <td>{m.description || "—"}</td>
                        <td>{m.supplier || "—"}</td>
                        <td>{m.costCents ? fmtBRL(m.costCents) : "—"}</td>
                        <td>
                          {m.status === "completed" && (m.nextDueKm || m.nextDueDate)
                            ? [
                                m.nextDueKm ? `${fmtKm(m.nextDueKm)} km` : "",
                                m.nextDueDate ? fmtDateBR(m.nextDueDate) : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "—"}
                        </td>
                        <td>
                          <span className={`flt-maint ${m.status}`}>
                            {maintStatuses.find((s) => s.value === m.status)?.label ??
                              m.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#9aa1ad" }}>
                Nenhuma manutenção registrada. Registre a primeira para iniciar
                o controle periódico.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function DocForm({
  vehicleId,
  notify,
  onDone,
}: {
  vehicleId: number;
  notify: (message: string) => void;
  onDone: () => void;
}) {
  const [docType, setDocType] = useState("CRLV");
  const [number, setNumber] = useState("");
  const [issuingBody, setIssuingBody] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const requiresValidity = !["Outro"].includes(docType);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (requiresValidity && !expiryDate)
      return notify(`Informe a validade do ${docType}.`);
    setSaving(true);
    try {
      const form = new FormData();
      form.append("vehicleId", String(vehicleId));
      form.append("docType", docType);
      form.append("number", number);
      form.append("issuingBody", issuingBody);
      form.append("issueDate", issueDate);
      form.append("expiryDate", expiryDate);
      form.append("notes", notes);
      if (file) form.append("file", file);
      const r = await fetch("/api/vehicle-docs", { method: "POST", body: form });
      const data = await r.json();
      if (r.ok) {
        notify(`${docType} registrado`);
        onDone();
      } else notify(data.error || "Não foi possível registrar o documento");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="ord-form-grid" style={{ marginBottom: 14 }}>
      <div className="ord-field">
        <label htmlFor="vd-type">Tipo *</label>
        <select id="vd-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
          {docTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="ord-field">
        <label htmlFor="vd-number">Número</label>
        <input id="vd-number" value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
      <div className="ord-field">
        <label htmlFor="vd-body">Órgão emissor</label>
        <input
          id="vd-body"
          value={issuingBody}
          onChange={(e) => setIssuingBody(e.target.value)}
          placeholder="DETRAN, seguradora..."
        />
      </div>
      <div className="ord-field">
        <label htmlFor="vd-issue">Emissão</label>
        <input
          id="vd-issue"
          type="date"
          value={issueDate}
          onChange={(e) => setIssueDate(e.target.value)}
        />
      </div>
      <div className="ord-field">
        <label htmlFor="vd-expiry">
          Validade {requiresValidity ? "*" : "(opcional)"}
        </label>
        <input
          id="vd-expiry"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
      </div>
      <div className="ord-field span2">
        <label htmlFor="vd-file">Arquivo (PDF ou imagem, opcional)</label>
        <input
          id="vd-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/tiff"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="ord-field span3">
        <label htmlFor="vd-notes">Observações</label>
        <input id="vd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button
        type="submit"
        className="primary-button"
        disabled={saving}
        style={{ alignSelf: "end" }}
      >
        {saving ? "Salvando..." : "Registrar"}
      </button>
    </form>
  );
}

function MaintForm({
  vehicle,
  notify,
  onDone,
}: {
  vehicle: Vehicle | null;
  notify: (message: string) => void;
  onDone: () => void;
}) {
  const [maintType, setMaintType] = useState("Preventiva");
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [odometerKm, setOdometerKm] = useState(String(vehicle?.odometerKm ?? 0));
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState("");
  const [costText, setCostText] = useState("");
  const [status, setStatus] = useState("completed");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/vehicle-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: vehicle?.id,
          maintType,
          serviceDate,
          odometerKm: Number(odometerKm || 0),
          description,
          supplier,
          costCents: centsFromBRL(costText),
          status,
        }),
      });
      const data = await r.json();
      if (r.ok) {
        notify(`Manutenção ${data.maintenance.maintType} registrada`);
        const newKm = Number(odometerKm || 0);
        if (vehicle && newKm > vehicle.odometerKm) {
          await fetch("/api/vehicles", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: vehicle.id, odometerKm: newKm }),
          });
        }
        onDone();
      } else notify(data.error || "Não foi possível registrar a manutenção");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="ord-form-grid" style={{ marginBottom: 14 }}>
      <div className="ord-field">
        <label htmlFor="vm-type">Tipo *</label>
        <select id="vm-type" value={maintType} onChange={(e) => setMaintType(e.target.value)}>
          {maintTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="ord-field">
        <label htmlFor="vm-date">Data *</label>
        <input
          id="vm-date"
          type="date"
          value={serviceDate}
          onChange={(e) => setServiceDate(e.target.value)}
        />
      </div>
      <div className="ord-field">
        <label htmlFor="vm-km">Km na manutenção *</label>
        <input
          id="vm-km"
          inputMode="numeric"
          value={odometerKm}
          onChange={(e) => setOdometerKm(e.target.value)}
        />
      </div>
      <div className="ord-field">
        <label htmlFor="vm-status">Situação</label>
        <select id="vm-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {maintStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="ord-field span2">
        <label htmlFor="vm-desc">Serviço realizado</label>
        <input
          id="vm-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Troca de óleo e filtros, revisão de freios..."
        />
      </div>
      <div className="ord-field">
        <label htmlFor="vm-supplier">Fornecedor / oficina</label>
        <input
          id="vm-supplier"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
      </div>
      <div className="ord-field">
        <label htmlFor="vm-cost">Custo (R$)</label>
        <input
          id="vm-cost"
          inputMode="decimal"
          placeholder="0,00"
          value={costText}
          onChange={(e) => setCostText(e.target.value)}
        />
      </div>
      <button
        type="submit"
        className="primary-button"
        disabled={saving}
        style={{ alignSelf: "end" }}
      >
        {saving ? "Salvando..." : "Registrar manutenção"}
      </button>
    </form>
  );
}

function MaintenanceTab({
  maintenance,
  vehicles,
  canWrite,
  notify,
  onChanged,
}: {
  maintenance: VMaint[];
  vehicles: Vehicle[];
  canWrite: boolean;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const kmByVehicle = useMemo(
    () => new Map(vehicles.map((v) => [v.id, v.odometerKm])),
    [vehicles],
  );
  const [creating, setCreating] = useState(false);
  const dueState = (m: VMaint) => {
    if (m.status === "cancelled") return "none";
    if (m.status === "scheduled") return "scheduled";
    if (m.status === "in_progress") return "scheduled";
    const current = kmByVehicle.get(m.vehicleId) ?? 0;
    if (m.nextDueKm !== null && m.nextDueKm !== undefined && current >= m.nextDueKm)
      return "danger";
    if (m.nextDueKm !== null && m.nextDueKm !== undefined && m.nextDueKm - current <= 500)
      return "warn";
    if (m.nextDueDate) {
      const days = daysTo(m.nextDueDate);
      if (days !== null && days !== undefined && days < 0) return "danger";
      if (days !== null && days !== undefined && days <= 15) return "warn";
    }
    return "ok";
  };
  const visible = maintenance.filter(
    (m) =>
      (!vehicleFilter || String(m.vehicleId) === vehicleFilter) &&
      (!statusFilter || m.status === statusFilter),
  );
  return (
    <section className="panel archive-panel">
      <div className="section-title">
        <div>
          <h2>Manutenções da frota</h2>
          <p>
            Agenda geral: revisões concluídas e as próximas preventivas por km
            e por data.
          </p>
        </div>
        {canWrite && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>+</span> Nova manutenção
          </button>
        )}
      </div>
      <div className="ord-toolbar">
        <select
          aria-label="Filtrar por veículo"
          className="flt-select"
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
        >
          <option value="">Todos os veículos</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} — {v.model}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por situação"
          className="flt-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todas as situações</option>
          {maintStatuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {visible.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Veículo</th>
                <th>Tipo</th>
                <th>Km</th>
                <th>Serviço / fornecedor</th>
                <th>Custo</th>
                <th>Próxima revisão</th>
                <th>Andamento</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const state = dueState(m);
                return (
                  <tr key={m.id}>
                    <td>{fmtDateBR(m.serviceDate)}</td>
                    <td>
                      <strong className="flt-plate">{m.plate}</strong>
                      <small> {m.model}</small>
                    </td>
                    <td>{m.maintType}</td>
                    <td>{fmtKm(m.odometerKm)} km</td>
                    <td>
                      {m.description || "—"}
                      {m.supplier && (
                        <small> · {m.supplier}</small>
                      )}
                    </td>
                    <td>{m.costCents ? fmtBRL(m.costCents) : "—"}</td>
                    <td>
                      <span className={`flt-pill ${state === "ok" ? "ok" : state}`}>
                        {m.status === "completed" && (m.nextDueKm !== null || m.nextDueDate)
                          ? [
                              m.nextDueKm !== null ? `${fmtKm(m.nextDueKm)} km` : "",
                              m.nextDueDate ? fmtDateBR(m.nextDueDate) : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : m.status === "scheduled"
                            ? "agendada"
                            : m.status === "in_progress"
                              ? "em andamento"
                              : "—"}
                      </span>
                    </td>
                    <td>
                      <span className={`flt-maint ${m.status}`}>
                        {maintStatuses.find((s) => s.value === m.status)?.label ??
                          m.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ord-empty">
          {maintenance.length
            ? "Nenhuma manutenção corresponde ao filtro."
            : "Nenhuma manutenção registrada ainda."}
        </div>
      )}
      {creating && (
        <VehiclePickerMaintModal
          vehicles={vehicles}
          notify={notify}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function VehiclePickerMaintModal({
  vehicles,
  notify,
  onClose,
  onDone,
}: {
  vehicles: Vehicle[];
  notify: (message: string) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [vehicleId, setVehicleId] = useState("");
  const pick = vehicles.find((v) => String(v.id) === vehicleId);
  return (
    <Modal title="Nova manutenção" eyebrow="MANUTENÇÕES DA FROTA" onClose={onClose}>
      <div className="ord-detail">
        <div className="ord-section">
          <div className="ord-form-grid">
            <div className="ord-field span2">
              <label htmlFor="mm-vehicle">Veículo *</label>
              <select
                id="mm-vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Escolha o veículo</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} — {v.model} ({fmtKm(v.odometerKm)} km)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {pick && (
          <MaintForm vehicle={pick} notify={notify} onDone={onDone} />
        )}
      </div>
    </Modal>
  );
}

function DriversTab({ drivers, canWrite, notify, onChanged }: { drivers: Driver[]; canWrite: boolean; notify: (message: string) => void; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Driver | null | undefined>(undefined);
  const visible = drivers.filter(driver => `${driver.name} ${driver.cpf} ${driver.licenseNumber}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel archive-panel">
    <div className="section-title"><div><h2>Motoristas</h2><p>CNH, MOPP, contato e disponibilidade para vinculação às rotas.</p></div>{canWrite && <button className="primary-button" onClick={() => setEditing(null)}><span>+</span> Novo motorista</button>}</div>
    <div className="ord-toolbar"><div className="archive-search"><span>⌕</span><input aria-label="Buscar motoristas" placeholder="Buscar por nome, CPF ou CNH..." value={query} onChange={event => setQuery(event.target.value)} /></div></div>
    {visible.length ? <div className="table-wrap"><table><thead><tr><th>Motorista</th><th>CNH</th><th>MOPP</th><th>Contato</th><th>Situação</th><th></th></tr></thead><tbody>{visible.map(driver => <tr key={driver.id}>
      <td><strong>{driver.name}</strong><small>{driver.cpf || "CPF não informado"}</small></td>
      <td>{driver.licenseNumber || "—"}<small>{driver.licenseCategory ? `Categoria ${driver.licenseCategory}` : "Categoria não informada"} · {driver.licenseExpiry ? `vence ${fmtDateBR(driver.licenseExpiry)}` : "sem validade"}</small></td>
      <td>{driver.moppExpiry ? fmtDateBR(driver.moppExpiry) : "Não informado"}{driver.alerts.map(alert => <small className="driver-alert" key={alert}>{alert}</small>)}</td>
      <td>{driver.phone || "—"}</td><td><span className={`flt-status ${driver.status}`}><span className="k" />{driver.status === "active" ? "Ativo" : "Inativo"}</span></td>
      <td>{canWrite && <button className="primary-button" onClick={() => setEditing(driver)}>Editar</button>}</td>
    </tr>)}</tbody></table></div> : <div className="ord-empty">Nenhum motorista cadastrado ou correspondente à busca.</div>}
    {editing !== undefined && <DriverFormModal driver={editing} notify={notify} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged(); }} />}
  </section>;
}

const emptyDriver = { name: "", cpf: "", phone: "", licenseNumber: "", licenseCategory: "", licenseExpiry: "", moppExpiry: "", status: "active", notes: "" };

function DriverFormModal({ driver, notify, onClose, onSaved }: { driver: Driver | null; notify: (message: string) => void; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(driver ? { name: driver.name, cpf: driver.cpf, phone: driver.phone, licenseNumber: driver.licenseNumber, licenseCategory: driver.licenseCategory, licenseExpiry: driver.licenseExpiry, moppExpiry: driver.moppExpiry, status: driver.status, notes: driver.notes } : emptyDriver);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof emptyDriver, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch("/api/drivers", { method: driver ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(driver ? { id: driver.id } : {}), ...form }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o motorista.");
      notify(driver ? "Motorista atualizado" : "Motorista cadastrado"); onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : "Não foi possível salvar o motorista"); }
    finally { setSaving(false); }
  };
  return <Modal title={driver ? "Editar motorista" : "Novo motorista"} eyebrow="GESTÃO DE CONDUTORES" onClose={onClose}><form className="ord-detail" onSubmit={submit}><div className="ord-section"><div className="ord-form-grid">
    <div className="ord-field span2"><label>Nome completo *</label><input required minLength={3} value={form.name} onChange={event => set("name", event.target.value)} /></div>
    <div className="ord-field"><label>CPF</label><input inputMode="numeric" maxLength={14} value={form.cpf} onChange={event => set("cpf", event.target.value)} placeholder="Somente números ou formatado" /></div>
    <div className="ord-field"><label>Telefone</label><input value={form.phone} onChange={event => set("phone", event.target.value)} /></div>
    <div className="ord-field"><label>Número da CNH</label><input value={form.licenseNumber} onChange={event => set("licenseNumber", event.target.value)} /></div>
    <div className="ord-field"><label>Categoria</label><input maxLength={5} value={form.licenseCategory} onChange={event => set("licenseCategory", event.target.value)} placeholder="Ex.: D ou AE" /></div>
    <div className="ord-field"><label>Validade da CNH</label><input type="date" value={form.licenseExpiry} onChange={event => set("licenseExpiry", event.target.value)} /></div>
    <div className="ord-field"><label>Validade do MOPP</label><input type="date" value={form.moppExpiry} onChange={event => set("moppExpiry", event.target.value)} /></div>
    <div className="ord-field"><label>Situação</label><select value={form.status} onChange={event => set("status", event.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></div>
    <div className="ord-field span2"><label>Observações</label><textarea value={form.notes} onChange={event => set("notes", event.target.value)} /></div>
  </div></div><div className="ord-form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar motorista"}</button></div></form></Modal>;
}
