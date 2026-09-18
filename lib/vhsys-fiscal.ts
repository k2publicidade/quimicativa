import { decimal, object, rows, text, type ErpRow } from './vhsys';
import { createVhsysFinanceClient, type VhsysConfig } from './vhsys-finance';

export async function listVhsysCollection(config: VhsysConfig, path: string, query: Record<string, string | number | undefined> = {}) {
  const get = createVhsysFinanceClient(config), params = new URLSearchParams();
  for (const [key, value] of Object.entries({ limit: 5, offset: 0, order: path === '/entradas-mercadoria' ? 'id_entrada' : 'id_venda', sort: 'asc', ...query })) if (value !== undefined && value !== '') params.set(key, String(value));
  return rows(await get(`${path}?${params}`));
}

const dateEpoch = (value: unknown) => { const parsed = Date.parse(String(value ?? '')); return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null; };
const status = (value: unknown) => String(value ?? '').toLowerCase().includes('cancel') ? 'cancelled' : String(value ?? '').toLowerCase().includes('atend') || String(value ?? '').toLowerCase().includes('autoriz') ? 'completed' : 'pending';

export function fiscalRecord(row: ErpRow, integrationId: number, kind: 'entrada' | 'nota', details: ErpRow[] = []) {
  const id = text(row, kind === 'entrada' ? 'id_entrada' : 'id_venda');
  if (!id) throw new Error(`Registro de ${kind} sem identificador.`);
  const isEntry = kind === 'entrada', party = text(row, 'nome_cliente') || 'Emitente não informado';
  const document = text(row, 'nota_numero', 'id_pedido', 'id_venda') || id;
  const amount = decimal(row.valor_total_nota);
  return { sourceKey: `vhsys:${integrationId}:${kind}:${id}`, title: `${party} — ${isEntry ? 'Entrada' : 'NF-e'} ${document}`, description: text(row, 'obs_pedido', 'obs_interno_pedido', 'natureza_pedido'), status: status(row.status_pedido || row.nota_emitida || row.nota_data_autorizacao), amountCents: Math.round(amount * 100), dueDate: dateEpoch(row.data_emissao ?? row.data_pedido), metadata: { kind, remoteId: id, party, number: document, accessKey: text(row, 'nota_chave'), protocol: text(row, 'nota_protocolo'), issueDate: text(row, 'data_emissao', 'data_pedido'), authorizationDate: text(row, 'nota_data_autorizacao'), cancellationDate: text(row, 'nota_data_cancelamento'), cancellationReason: text(row, 'nota_motivo_cancelamento'), status: text(row, 'status_pedido'), category: text(row, 'centro_custos_pedido'), supplierOrCustomerId: text(row, 'id_cliente'), transport: text(row, 'transportadora_pedido'), freight: text(row, 'frete_pedido'), discount: text(row, 'desconto_pedido'), taxes: { icms: text(row, 'valor_ICMS'), st: text(row, 'valor_ST'), ipi: text(row, 'valor_IPI'), pis: text(row, 'valor_PIS'), cofins: text(row, 'valor_COFINS') }, products: details, raw: row }, sourcePayload: JSON.stringify({ header: row, details }), kind };
}

export async function getFiscalDetails(config: VhsysConfig, kind: 'entrada' | 'nota', id: string) {
  const get = createVhsysFinanceClient(config), root = kind === 'entrada' ? 'entradas-mercadoria' : 'notas-fiscais';
  const header = object((await get(`/${root}/${encodeURIComponent(id)}`)).data);
  const products = rows(await get(`/${root}/${encodeURIComponent(id)}/produtos`));
  const parcels = rows(await get(`/${root}/${encodeURIComponent(id)}/parcelas`));
  return { header, products, parcels };
}
