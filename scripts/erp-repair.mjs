import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);
const migration=await s.rpc('exec_sql_batch',{queries:readFileSync('supabase/erp-records-fix.sql','utf8').split(';').map(x=>x.trim()).filter(Boolean)});
if(migration.error) throw migration.error;
const {data:c,error}=await s.from('erp_integrations').select('*').eq('active',1).limit(1).single();if(error)throw error;
const bundle=await build({entryPoints:['lib/vhsys-record-sync.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {syncVhsysRecords}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
for(const scope of ['contas-pagar','entradas','notas-fiscais']) {
 if(process.argv.includes('--scope') && process.argv[process.argv.indexOf('--scope')+1]!==scope) continue;
 let offset=0,total=0;
 do {const r=await syncVhsysRecords(s,c,scope,offset);if(r.issues.length)throw Error(scope+': '+r.issues.join('; '));total+=r.imported;console.log(JSON.stringify({scope,offset,total}));if(r.nextOffset===null)break;offset=r.nextOffset;} while(process.argv.includes('--all'));
 const check=await syncVhsysRecords(s,c,scope,0);if(check.issues.length)throw Error(check.issues.join('; '));
 console.log(JSON.stringify({scope,verified:true,total}));
}
