// Read-only reconciliation: compares remote IDs with the production database.
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
const {data:c,error}=await s.from('erp_integrations').select('*').eq('active',1).order('id',{ascending:false}).limit(1).single();
if(error) throw error;
for(const [path,idField,table,suffix] of [['pedidos','id_ped','orders',''],['contas-pagar','id_conta_pag','records','conta-pagar:'],['entradas-mercadoria','id_entrada','records','entrada:'],['notas-fiscais','id_venda','records','nota:']]) {
  const prefix=`vhsys:${c.id}:${suffix}`, remote=new Set();
  for(let offset=0;;offset+=250) {
    const res=await fetch(`${c.base_url}/${path}?limit=250&offset=${offset}&order=${idField}&sort=asc`,{headers:{'access-token':c.api_token,'secret-access-token':c.secret_api_token,'User-Agent':'Quimicativa/1.0'}});
    const payload=await res.json();assert.ok(res.ok && Array.isArray(payload.data),`${path}: consulta falhou`);
    for(const r of payload.data) remote.add(prefix+String(r[idField]));
    if(payload.data.length<250)break;
  }
  const local=[];
  for(let offset=0;;offset+=500) {
    const {data,error}=await s.from(table).select('id,source_key,source_payload').like('source_key',prefix+'%').order('id').range(offset,offset+499);
    if(error)throw error;local.push(...data);if(data.length<500)break;
  }
  const localIds=new Set(local.map(r=>r.source_key));
  const missing=[...remote].filter(id=>!localIds.has(id));
  const incomplete=local.filter(r=>remote.has(r.source_key)&&(!r.source_payload||(table==='records'&&path!=='contas-pagar'&&(!r.source_payload.header||!Array.isArray(r.source_payload.products)||!Array.isArray(r.source_payload.parcels)))));
  console.log(JSON.stringify({module:path,remote:remote.size,local:localIds.size,missing:missing.length,missingKeys:missing,incomplete:incomplete.length,duplicateIds:local.length-localIds.size}));
  assert.equal(missing.length,0,`${path}: IDs remotos ausentes`);assert.equal(incomplete.length,0,`${path}: detalhes incompletos`);assert.equal(local.length,localIds.size);
}
