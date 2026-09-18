import {createClient} from '@supabase/supabase-js';
const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
const {data:c,error}=await s.from('erp_integrations').select('*').eq('active',1).limit(1).single();
if(error) throw error;
for(const path of ['/pedidos','/contas-pagar','/entradas-mercadoria','/notas-fiscais']) {
 const r=await fetch(c.base_url+path+'?limit=1&offset=0',{headers:{'access-token':c.api_token,'secret-access-token':c.secret_api_token,'User-Agent':'Quimicativa/1.0'}});
 const p=await r.json(); console.log(JSON.stringify({path,http:r.status,paging:p.paging,keys:Array.isArray(p.data)?Object.keys(p.data[0]||{}):[],error:typeof p.data==='string'?p.data:undefined}));
 if(Array.isArray(p.data)&&p.data.length&&path!='/contas-pagar') {
 const id=p.data[0].id_entrada||p.data[0].id_venda||p.data[0].id_ped;
 for(const suffix of ['/produtos','/parcelas']) {const r2=await fetch(c.base_url+path+'/'+id+suffix,{headers:{'access-token':c.api_token,'secret-access-token':c.secret_api_token,'User-Agent':'Quimicativa/1.0'}});const p2=await r2.json();console.log(JSON.stringify({path:path+suffix,http:r2.status,count:Array.isArray(p2.data)?p2.data.length:null,error:typeof p2.data==='string'?p2.data:undefined}));}
 }
}
const v=await s.rpc('exec_sql',{query:"SELECT indexdef FROM pg_indexes WHERE tablename='records'",expect_rows:true});console.log(v);
