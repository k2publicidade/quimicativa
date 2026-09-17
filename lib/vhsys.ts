export type ErpRow = Record<string, unknown>;
export const text = (o: ErpRow, ...keys: string[]) => String(keys.map(k => o[k]).find(v => v !== undefined && v !== null && v !== '') ?? '').trim();
export function decimal(input: unknown): number {
  if (input === undefined || input === null || input === '') return 0;
  const s = String(input).trim();
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  if (!Number.isFinite(n)) throw new Error('Valor numérico inválido recebido do ERP');
  return n;
}
export function object(input: unknown): ErpRow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Objeto inválido recebido do ERP');
  return input as ErpRow;
}
export function rows(payload: unknown): ErpRow[] {
  const p = object(payload);
  if (p.status === 'error' || (p.code && Number(p.code) !== 200)) throw new Error('ERP recusou a consulta');
  if (!Array.isArray(p.data)) throw new Error('Lista ausente na resposta do ERP');
  return p.data.flatMap(raw => {
    const o = object(raw);
    const nested = Object.entries(o).find(([k,v]) => /^(produto|cliente|pedido|parcela)\s*:?\s*$/i.test(k) && Array.isArray(v));
    return nested ? (nested[1] as unknown[]).map(object) : [o];
  });
}
export function normalizedItems(order: ErpRow) {
  const list = order.items ?? order.produtos ?? [];
  if (!Array.isArray(list)) throw new Error('Produtos do pedido inválidos');
  return list.map(raw => {
    const item = object(raw);
    const productName = text(item,'desc_produto','productName','name','descricao_produto','nome_produto');
    const quantity = decimal(item.qtde_produto ?? item.quantity ?? item.quantidade);
    if (!productName || quantity <= 0) throw new Error('Produto sem descrição ou quantidade válida');
    return {raw:item,productName,quantity};
  });
}
export function itemValues(item: ErpRow) {
  const {productName,quantity} = normalizedItems({items:[item]})[0];
  const unitPrice = decimal(item.valor_unit_produto);
  return {product_name:productName,quantity,unit: text(item,'unidade_produto','unidade') || 'un',
    unit_price_cents: Math.round(unitPrice * 100000000) / 1000000,
    line_total_cents: Math.round(decimal(item.valor_total_produto ?? quantity * unitPrice) * 100),
    notes:text(item,'info_adicional','obs_produto'),
  };
}
export function snapshot(input: unknown): ErpRow | null {
  try { return object(typeof input === 'string' ? JSON.parse(input) : input); } catch { return null; }
}
export function erpTotals(input: unknown) {
  const s = snapshot(input);
  if (!s || s.valor_total_nota === undefined) return null;
  return {totalCents:Math.round(decimal(s.valor_total_nota)*100), productsCents:Math.round(decimal(s.valor_total_produtos)*100),
    freightCents:Math.round(decimal(s.frete_pedido)*100), discountCents:Math.round(decimal(s.desconto_pedido)*100),
    ipiCents:Math.round(decimal(s.valor_IPI)*100), icmsCents:Math.round(decimal(s.valor_ICMS)*100),
    grossWeightKg:decimal(s.peso_total_nota),netWeightKg:decimal(s.peso_total_nota_liq)};
}
