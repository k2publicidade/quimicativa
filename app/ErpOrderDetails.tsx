import { decimal, erpTotals, snapshot, text, type ErpRow } from '../lib/vhsys';

const number=(v:unknown)=>decimal(v).toLocaleString('pt-BR',{maximumFractionDigits:6});
const money=(c:number)=> (c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const labels:Record<string,string>={items:'Produtos do pedido',customer:'Cliente',catalog:'Cadastro completo do produto',installments:'Parcelas',desc_produto:'Descrição',qtde_produto:'Quantidade',valor_unit_produto:'Valor unitário',valor_total_produto:'Total do item',ipi_produto:'IPI (%)',icms_produto:'ICMS (%)',info_adicional:'Informações adicionais',obs_pedido:'Observações',obs_interno_pedido:'Observações internas',vendedor_pedido:'Vendedor',referencia_pedido:'Referência',prazo_entrega:'Prazo de entrega',transportadora_pedido:'Transportadora',condicao_pagamento:'Condição de pagamento',status_pedido:'Situação no ERP',valor_total_nota:'Total do pedido',valor_total_produtos:'Total dos produtos',frete_pedido:'Frete',desconto_pedido:'Desconto',peso_total_nota:'Peso bruto',peso_total_nota_liq:'Peso líquido',razao_cliente:'Razão social',fantasia_cliente:'Nome fantasia',cnpj_cliente:'CNPJ / CPF',insc_estadual_cliente:'Inscrição estadual',endereco_cliente:'Endereço',numero_cliente:'Número',complemento_cliente:'Complemento',bairro_cliente:'Bairro',cidade_cliente:'Cidade',uf_cliente:'UF',cep_cliente:'CEP',contato_cliente:'Contato',email_cliente:'E-mail',fone_cliente:'Telefone',celular_cliente:'Celular',observacoes_cliente:'Observações do cliente',data_parcela:'Vencimento',valor_parcela:'Valor da parcela',forma_pagamento:'Forma de pagamento',observacoes_parcela:'Observações da parcela',cod_produto:'Código',unidade_produto:'Unidade',ncm_produto:'NCM',cest_produto:'CEST',obs_produto:'Observações do produto'};
function Fields({data}:{data:ErpRow}) {
  return <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,margin:'12px 0',overflowWrap:'anywhere'}}>{Object.entries(data).filter(([k])=>!k.startsWith('_')).map(([k,v])=><div key={k}>
    <dt style={{fontSize:12,color:'#64748b'}}>{labels[k]||k.replaceAll('_',' ')}</dt>
    <dd style={{margin:'4px 0',whiteSpace:'pre-wrap'}}>{v!==null && typeof v==='object'?<details><summary>Ver detalhes{Array.isArray(v)?` (${v.length})`:''}</summary>{Array.isArray(v)?v.map((x,i)=><div key={i}>{snapshot(x)?<Fields data={snapshot(x)!}/>:String(x)}</div>):<Fields data={v as ErpRow}/>}</details>:v===null||v===''?'—':String(v)}</dd>
  </div>)}</dl>;
}
export default function ErpOrderDetails({data}:{data:ErpRow}) {
  const totals=erpTotals(data), customer=snapshot(data.customer), items=Array.isArray(data.items)?data.items.map(snapshot).filter((v):v is ErpRow=>!!v):[];
  return <section className="ord-section">
    <header><div><h4>Informações do pedido na vhsys</h4><p>{text(data,'status_pedido')} · Vendedor: {text(data,'vendedor_pedido')||'—'} · Referência: {text(data,'referencia_pedido')||'—'}</p></div></header>
    {totals&&<dl className="ord-form-grid">{[['Produtos',money(totals.productsCents)],['Frete',money(totals.freightCents)],['Desconto',money(totals.discountCents)],['IPI',money(totals.ipiCents)],['ICMS',money(totals.icmsCents)],['Total do pedido',money(totals.totalCents)],['Peso bruto',`${number(totals.grossWeightKg)} kg`],['Peso líquido',`${number(totals.netWeightKg)} kg`]].map(([k,v])=><div key={k}><dt>{k}</dt><dd style={{margin:0,fontWeight:600}}>{v}</dd></div>)}</dl>}
    <p style={{whiteSpace:'pre-wrap'}}><strong>Observações:</strong> {text(data,'obs_pedido')||'—'}<br/><strong>Observações internas:</strong> {text(data,'obs_interno_pedido')||'—'}</p>
    {items.length>0&&<div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Unidade</th><th>Valor unitário</th><th>IPI %</th><th>ICMS %</th><th>Total</th></tr></thead><tbody>{items.map((item,i)=><tr key={i}><td>{text(item,'desc_produto')}</td><td>{number(item.qtde_produto)}</td><td>{text(item,'unidade_produto')}</td><td>{number(item.valor_unit_produto)}</td><td>{number(item.ipi_produto)}</td><td>{number(item.icms_produto)}</td><td>{money(Math.round(decimal(item.valor_total_produto)*100))}</td></tr>)}</tbody></table></div>}
    {customer&&<details><summary>Cadastro completo do cliente</summary><Fields data={customer}/></details>}
    <details><summary>Todos os detalhes recebidos da vhsys</summary><Fields data={data}/></details>
    {!data._importVersion&&<p>Este pedido precisa de uma nova sincronização para carregar produtos e cadastro completo.</p>}
  </section>;
}
