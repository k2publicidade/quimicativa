import type { SupabaseClient } from '@supabase/supabase-js';
import { decimal, itemValues, object, rows, text, type ErpRow } from './vhsys';

type Config = {id:number;base_url:string;api_token:string|null;secret_api_token:string|null};
const literal = (v: unknown): string => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/'/g,"''")}'`;
const assignments = (v: ErpRow) => Object.entries(v).map(([k,x])=>`${k}=${literal(x)}`).join(',');
const epoch = (v: unknown) => { const n = Date.parse(String(v ?? '')); return Number.isFinite(n) ? Math.floor(n/1000) : null; };
// SQL identifiers below are application constants; only values come from the ERP.
function upsert(table: string, key: string, values: ErpRow, time:number, legacy?:string) {
  const fields = {...values,source_key:key,updated_at:time};
  const queries:string[] = [];
  if (legacy) queries.push(`UPDATE ${table} SET source_key=${literal(key)} WHERE id=(SELECT id FROM ${table} WHERE source_key IS NULL AND (${legacy}) ORDER BY id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM ${table} WHERE source_key=${literal(key)})`);
  queries.push(`INSERT INTO ${table} (${Object.keys(fields).join(',')},created_at) VALUES (${Object.values(fields).map(literal).join(',')},${time}) ON CONFLICT(source_key) DO UPDATE SET ${assignments(fields)}`);
  return queries;
}
const ref = (table:string,key:string) => `(SELECT id FROM ${table} WHERE source_key=${literal(key)})`;

export function createVhsysClient(config:Config) {
  const base = new URL(config.base_url);
  if (base.protocol !== 'https:' || base.hostname !== 'api.vhsys.com' || base.username || base.password) throw new Error('Use o endereço oficial https://api.vhsys.com/v2 para a vhsys.');
  if (!config.api_token || !config.secret_api_token) throw new Error('Configure os dois tokens da vhsys.');
  return async (path:string, empty?:RegExp):Promise<ErpRow> => {
    for (let attempt=0;attempt<3;attempt++) {
      const response = await fetch(`${config.base_url.replace(/\/+$/,'')}${path}`, {cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','access-token':config.api_token!,'secret-access-token':config.secret_api_token!,'User-Agent':'Quimicativa/1.0'}});
      const payload = object(await response.json());
      // VHSYS uses 403 for an empty collection; only accept the exact documented/observed empty response.
      if (empty && response.status===403 && typeof payload.data==='string' && empty.test(payload.data)) return {code:200,status:'success',data:[]};
      if ((response.status===429 || response.status>=500) && attempt<2) {await new Promise(r=>setTimeout(r,Math.min(5000,Math.max(1000,Number(response.headers.get('retry-after')||1)*1000))));continue;}
      if (!response.ok || payload.status==='error' || (payload.code && Number(payload.code)!==200)) throw new Error(`vhsys: consulta ${path.split('?')[0]} falhou (HTTP ${response.status}).`);
      return payload;
    }
    throw new Error('Limite temporário da vhsys. Tente novamente.');
  };
}

export async function syncVhsysBatch(s:SupabaseClient, config:Config, options:{offset?:number;remoteId?:string;preview?:boolean;force?:boolean}={}) {
  const get = createVhsysClient(config), offset=options.offset??0, size=5;
  const list = options.remoteId ? [object((await get(`/pedidos/${encodeURIComponent(options.remoteId)}`)).data)] : rows(await get(`/pedidos?limit=${size}&offset=${offset}&order=id_ped&sort=desc`));
  const issues:string[]=[], samples:ErpRow[]=[], imported:number[]=[];
  let skipped=0;
  const cache = new Map<string,ErpRow>();
  const detail = async(path:string) => {if(!cache.has(path)) cache.set(path,object((await get(path)).data)); return cache.get(path)!;};
  for (const summary of list) {
    const remoteId=text(summary,'id_ped');
    const number=text(summary,'id_pedido');
    if(!remoteId || !number) {issues.push('Pedido sem identificadores vhsys.');continue;}
    const key=`vhsys:${config.id}:${remoteId}`;
    try {
      const previous=await s.from('orders').select('id,source_payload').eq('source_key',key).maybeSingle();
      if(previous.error) throw new Error(previous.error.message);
      const old=previous.data?.source_payload as ErpRow|undefined;
      if(!options.preview && !options.force && old?._importVersion===2 && old.data_mod_pedido===summary.data_mod_pedido && Date.now()-Number(old._fetchedAt)<3600000) {skipped++;continue;}
      const order = await detail(`/pedidos/${encodeURIComponent(remoteId)}`);
      const products = rows(await get(`/pedidos/${encodeURIComponent(remoteId)}/produtos`,/^Nenhum produto.*encontrado[!.]?$/i));
      const installments = rows(await get(`/pedidos/${encodeURIComponent(remoteId)}/parcelas`,/^Nenhuma parcela para o pedido encontrado!$/));
      const customer = await detail(`/clientes/${encodeURIComponent(text(order,'id_cliente'))}`);
      for (const item of products) {
        const catalogId = text(item,'id_produto');
        const catalog = catalogId && catalogId !== '0' ? await detail(`/produtos/${encodeURIComponent(catalogId)}`) : {};
        item.catalog = catalog;
        item.unidade_produto = text(catalog,'unidade_produto') || text(item,'unidade_produto','unidade');
        itemValues(item); // Validate every item before any write for this order.
        if(!text(item,'id_ped_produto')) throw new Error('Item sem identificador vhsys.');
      }
      if(!products.length && decimal(order.valor_total_produtos)>0) throw new Error('Pedido com valor e sem produtos: dados existentes preservados.');
      const snapshot={...order,items:products,customer,installments,_importVersion:2,_fetchedAt:Date.now()};
      samples.push({number,customerName:text(customer,'razao_cliente'),deliveryDate:text(order,'prazo_entrega'),paymentTerms:text(order,'condicao_pagamento'),items:products.length});
      if(options.preview) continue;
      const time=Math.floor(Date.now()/1000), customerKey=`vhsys:${config.id}:${text(customer,'id_cliente')}`;
      const name=text(customer,'razao_cliente','nome_cliente');
      const document=text(customer,'cnpj_cliente','cpf_cliente');
      if(!name) throw new Error('Cliente sem razão social.');
      const q = [`SELECT pg_advisory_xact_lock(hashtext(${literal(`vhsys:${config.id}`)}))`];
      q.push(...upsert('customers',customerKey,{company_name:name,trading_name:text(customer,'fantasia_cliente'),document,
        state_registration:text(customer,'insc_estadual_cliente'),street:text(customer,'endereco_cliente'),number:text(customer,'numero_cliente'),complement:text(customer,'complemento_cliente'),district:text(customer,'bairro_cliente'),city:text(customer,'cidade_cliente'),state:text(customer,'uf_cliente'),zip_code:text(customer,'cep_cliente'),
        contact_name:text(customer,'contato_cliente'),contact_email:text(customer,'email_contato_cliente','email_cliente'),contact_phone:text(customer,'fone_contato_cliente','celular_cliente','fone_cliente'),notes:text(customer,'observacoes_cliente'),status:text(customer,'situacao_cliente').toLowerCase()==='inativo'?'inactive':'active',source_payload:customer},time,document?`regexp_replace(document,'[^0-9]','','g')=${literal(document.replace(/\D/g,''))}`:`company_name=${literal(name)}`));
      // Bind stable external identities while retaining legacy local order IDs.
      q.push(`UPDATE orders SET source_key=${literal(key)} WHERE number=${literal(number)} AND source_key IS NULL AND NOT EXISTS(SELECT 1 FROM orders WHERE source_key=${literal(key)})`);
      const notes=[text(order,'obs_pedido'),text(order,'obs_interno_pedido')?`Observações internas: ${text(order,'obs_interno_pedido')}`:''].filter(Boolean).join('\n\n');
      const fields={number,order_date:epoch(order.data_pedido),delivery_date:epoch(order.data_entrega_pedido),payment_terms:installments.map(p=>`${text(p,'forma_pagamento')} ${text(p,'data_parcela')}`).join(' · ')||text(order,'condicao_pagamento'),notes,source_payload:snapshot,updated_at:time};
      q.push(`INSERT INTO orders (source_key,customer_id,${Object.keys(fields).join(',')},status,created_at) VALUES (${literal(key)},${ref('customers',customerKey)},${Object.values(fields).map(literal).join(',')},'active',${time}) ON CONFLICT(source_key) DO UPDATE SET customer_id=${ref('customers',customerKey)},${assignments(fields)}`);
      const itemKeys:string[]=[];
      for(const item of products) {
        const catalog=object(item.catalog), productKey=`vhsys:${config.id}:${text(item,'id_produto')}`, itemKey=`${key}:${text(item,'id_ped_produto')}`;
        itemKeys.push(itemKey);
        const hasCatalog = !!text(item,'id_produto') && text(item,'id_produto') !== '0';
        if(hasCatalog) q.push(...upsert('products',productKey,{name:text(catalog,'desc_produto') || text(item,'desc_produto'),notes:text(catalog,'obs_produto'),source_payload:catalog},time,`name=${literal(text(catalog,'desc_produto') || text(item,'desc_produto'))}`));
        const values={...itemValues(item),source_payload:item,updated_at:time};
        const productRef=hasCatalog?ref('products',productKey):'NULL';
        q.push(`INSERT INTO order_items (source_key,order_id,product_id,${Object.keys(values).join(',')},created_at) VALUES (${literal(itemKey)},${ref('orders',key)},${productRef},${Object.values(values).map(literal).join(',')},${time}) ON CONFLICT(source_key) DO UPDATE SET product_id=${productRef},${assignments(values)}`);
      }
      // FK protection intentionally rolls back the order if a removed ERP item has a local document.
      q.push(`DELETE FROM order_items WHERE order_id=${ref('orders',key)} AND source_key IS NOT NULL${itemKeys.length?` AND source_key NOT IN (${itemKeys.map(literal).join(',')})`:''}`);
      const result=await s.rpc('exec_sql_batch',{queries:q});
      if(result.error) throw new Error(result.error.message.includes('foreign key')?'Produto removido no ERP possui documento local; revise o vínculo antes de sincronizar.':result.error.message);
      const saved=await s.from('orders').select('id').eq('source_key',key).single();
      if(saved.error) throw new Error(saved.error.message);
      imported.push(saved.data.id);
    } catch(e) {issues.push(`Pedido ${number}: ${e instanceof Error?e.message:'falha de importação'}`);}
  }
  const nextOffset=!options.remoteId && list.length===size ? offset+size : null;
  const message=`${imported.length} pedido(s) atualizado(s), ${skipped} sem alterações${issues.length?` · ${issues.length} falha(s)` : ''}${nextOffset!==null?' · sincronização em andamento':''}`;
  if(!options.preview) {
    const saved=await s.from('erp_integrations').update({last_sync_at:Math.floor(Date.now()/1000),last_sync_status:issues.length?'error':nextOffset!==null?'running':'success',last_sync_message:message}).eq('id',config.id);
    if(saved.error) throw new Error(saved.error.message);
  }
  return {imported:imported.length,skipped,issues,orderIds:imported,message,nextOffset,totalRecords:list.length,validRecords:samples.length,sample:samples,preview:!!options.preview};
}
