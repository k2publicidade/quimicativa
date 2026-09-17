// Run with node --env-file=.env.local scripts/vhsys-sync.mjs [remote id | all | migrate]
// Credentials are read server-side from the existing integration; never printed.
import {createClient} from '@supabase/supabase-js';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
const {data:config,error}=await s.from('erp_integrations').select('*').eq('active',1).order('id',{ascending:false}).limit(1).single();
if(error) throw error;
const mode=process.argv[2];
if(mode==='migrate') {
  const sql=readFileSync(new URL('../supabase/erp-order-details.sql',import.meta.url),'utf8');
  const result=await s.rpc('exec_sql_batch',{queries:sql.split(';').map(x=>x.trim()).filter(Boolean)});
  if(result.error) throw result.error;
  console.log('Migração aditiva aplicada.');
} else {
  if(mode!=='all'&&mode!=='repair'&&mode!=='verify'&&!/^\d+$/.test(mode||'')) throw Error('Informe um ID remoto, repair, verify ou all.');
  const built=await build({entryPoints:['lib/vhsys-sync.ts'],bundle:true,write:false,platform:'node',format:'esm'});
  const {syncVhsysBatch}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  if(mode==='repair') {
    const {data:orders,error}=await s.from('orders').select('number,source_payload').range(0,9999);
    if(error) throw error;
    let repaired=0;
    const issues=[];
    for(const o of orders) {
      const p=typeof o.source_payload==='string'?JSON.parse(o.source_payload):o.source_payload;
      if(!p?.id_ped || p._importVersion===2) continue;
      const result=await syncVhsysBatch(s,config,{remoteId:String(p.id_ped),force:true});
      repaired+=result.imported;issues.push(...result.issues);
      console.log(JSON.stringify({number:o.number,imported:result.imported,issues:result.issues}));
    }
    console.log(JSON.stringify({repaired,issues}));
    process.exit(issues.length?1:0);
  }
  if(mode==='verify') {
    const key=`vhsys:${config.id}:51105940`;
    const {data:o,error:e}=await s.from('orders').select('id,customer_id,source_payload').eq('source_key',key).single();
    if(e) throw e;
    const before=await s.from('order_items').select('id,source_key,quantity,unit,unit_price_cents,line_total_cents').eq('order_id',o.id);
    assert.equal(before.data.length,1);
    assert.equal(before.data[0].quantity,1200);
    assert.equal(before.data[0].unit,'KG');
    assert.equal(before.data[0].line_total_cents,286800);
    assert.equal(before.data[0].unit_price_cents,239);
    assert.ok(o.source_payload.customer.cnpj_cliente);
    assert.ok(o.source_payload.items[0].catalog.id_produto);
    assert.ok(o.source_payload.obs_interno_pedido);
    const result=await syncVhsysBatch(s,config,{remoteId:'51105940',force:true});
    assert.deepEqual(result.issues,[]);
    const after=await s.from('order_items').select('id,source_key,quantity,unit,unit_price_cents,line_total_cents').eq('order_id',o.id);
    assert.deepEqual(after.data,before.data,'Reimportação deve manter IDs, quantidade, preço e número de itens');
    console.log('Produção: pedido 765 validado. Quantidade 1200 KG, unitário 2,39, total 2868,00, cliente, catálogo e observações completos; IDs estáveis após reimportação.');
    process.exit(0);
  }
  let offset=0,total=0,failed=0;
  do {
    const result=await syncVhsysBatch(s,config,mode==='all'?{offset}:{remoteId:mode,force:true});
    total+=result.imported; failed+=result.issues.length;
    console.log(JSON.stringify({offset,imported:result.imported,skipped:result.skipped,issues:result.issues,nextOffset:result.nextOffset}));
    if(result.nextOffset===null) break;
    offset=result.nextOffset;
  } while(true);
  console.log(JSON.stringify({total,failed}));
  if(failed) process.exitCode=1;
}
