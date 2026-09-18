import { decimal, object, rows, text, type ErpRow } from './vhsys';

export type VhsysConfig = { base_url: string; api_token: string | null; secret_api_token: string | null };

export function createVhsysFinanceClient(config: VhsysConfig) {
  if (!config.api_token || !config.secret_api_token) throw new Error('Configure os dois tokens da vhsys.');
  const base = new URL(config.base_url);
  if (base.protocol !== 'https:' || base.hostname !== 'api.vhsys.com') throw new Error('Use https://api.vhsys.com/v2 como endpoint da vhsys.');
  return async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${config.base_url.replace(/\/+$/, '')}${path}`, {
      ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'access-token': config.api_token!, 'secret-access-token': config.secret_api_token!, 'User-Agent': 'Quimicativa/1.0', ...(init.headers || {}) },
    });
    const payload = object(await response.json());
    if (!response.ok || payload.status === 'error' || (payload.code && Number(payload.code) !== 200)) throw new Error(`vhsys respondeu HTTP ${response.status}.`);
    return payload;
  };
}

export const payableId = (row: ErpRow) => text(row, 'id_conta_pag');
export function payableStatus(row: ErpRow): 'completed' | 'overdue' | 'pending' | 'review' {
  const liquidated = text(row, 'liquidado_pag').toLowerCase() === 'sim' || text(row, 'situacao').toLowerCase().includes('liquid');
  if (liquidated) return 'completed';
  const due = Date.parse(text(row, 'vencimento_pag'));
  if (Number.isFinite(due) && due < Date.now()) return 'overdue';
  return 'pending';
}
export function payableRecord(row: ErpRow, integrationId: number) {
  const id = payableId(row), amountCents = Math.round(decimal(row.valor_pag) * 100), dueDate = text(row, 'vencimento_pag');
  if (!id) throw new Error('Conta a pagar sem id_conta_pag.');
  const supplier = text(row, 'nome_fornecedor') || 'Fornecedor não informado';
  const title = `${supplier} — ${text(row, 'nome_conta', 'identificacao') || `Conta ${id}`}`;
  return {
    sourceKey: `vhsys:${integrationId}:conta-pagar:${id}`, title, description: text(row, 'observacoes_pag', 'obs_pagamento'), status: payableStatus(row), amountCents,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? Math.floor(new Date(`${dueDate}T12:00:00Z`).getTime() / 1000) : null,
    metadata: { supplier, document: text(row, 'n_documento_pag'), category: text(row, 'categoria_pag'), bankId: text(row, 'id_banco'), costCenter: text(row, 'centro_custos_pag'), paymentMethod: text(row, 'forma_pagamento'), barcode: text(row, 'codigo_barras'), issuedAt: text(row, 'data_emissao'), paidAt: text(row, 'data_pagamento'), paidAmount: text(row, 'valor_pago', 'valor_baixa'), interest: text(row, 'valor_juros'), discount: text(row, 'valor_desconto'), surcharge: text(row, 'valor_acrescimo'), fee: text(row, 'valor_taxa'), situation: text(row, 'situacao'), dda: text(row, 'vinculo_dda'), partials: row.parciais ?? null, remoteId: id }, sourcePayload: JSON.stringify(row), integrationId,
  };
}

export async function listPayables(config: VhsysConfig, query: Record<string, string | number | undefined> = {}) {
  const get = createVhsysFinanceClient(config), params = new URLSearchParams();
  for (const [key, value] of Object.entries({ limit: 250, offset: 0, order: 'id_conta_pag', sort: 'desc', ...query })) if (value !== undefined && value !== '') params.set(key, String(value));
  return rows(await get(`/contas-pagar?${params}`));
}

export async function getPayable(config: VhsysConfig, id: string) { return object((await createVhsysFinanceClient(config)(`/contas-pagar/${encodeURIComponent(id)}`)).data); }
