import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const out = path.resolve('.tmp-test/auth-availability');
await fs.mkdir(out, {recursive:true});
const shims = {
  next: `export const NextResponse={json:(data,init)=>Response.json(data,init)};`,
  server: `export const getSupabaseUser=async()=>globalThis.__authUser; export const createSupabaseServerClient=async()=>({auth:{signInWithPassword:async()=>globalThis.__loginResult}});`,
  admin: `export const supabaseAdmin=()=>({from:()=>({select:fields=>{const query={eq:()=>query,limit:()=>query,abortSignal:()=>query,maybeSingle:async()=>globalThis.__lookupResult,then:(resolve,reject)=>Promise.resolve(globalThis.__countResult).then(resolve,reject)};return query;},upsert:async()=>{globalThis.__writes++;return globalThis.__writeResult;},insert:async()=>{globalThis.__writes++;return globalThis.__writeResult;}}),auth:{admin:{createUser:async()=>{globalThis.__creates++;return {data:{user:{id:'new-user'}},error:null};}}}});`,
};
await build({entryPoints:{signup:'app/api/auth/signup/route.ts',login:'app/api/auth/login/route.ts',actor:'app/api/authz.ts',health:'app/api/health/route.ts'},bundle:true,format:'esm',platform:'node',packages:'external',outdir:out,outExtension:{'.js':'.mjs'},plugins:[{name:'auth-test',setup(b){b.onResolve({filter:/^next\/server$|supabase\/(admin|server)$/},a=>({path:a.path==='next/server'?'next':a.path.endsWith('/admin')?'admin':'server',namespace:'auth-test'}));b.onLoad({filter:/.*/,namespace:'auth-test'},a=>({contents:shims[a.path],loader:'js'}));}}]});
const api=Object.fromEntries(await Promise.all(['signup','login','actor','health'].map(async name=>[name,await import(pathToFileURL(path.join(out,name+'.mjs')))])));
const request=()=>new Request('https://example.invalid/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.invalid',password:'long-password'})});
function reset(){globalThis.__authUser=null;globalThis.__lookupResult={data:null,error:null};globalThis.__countResult={count:1,error:null};globalThis.__writeResult={error:null};globalThis.__creates=0;globalThis.__writes=0;globalThis.__loginResult={data:{user:null},error:{status:400,code:'invalid_credentials'}};}
reset();globalThis.__countResult={count:null,error:{message:'fetch failed'}};
let response=await api.signup.GET();assert.equal(response.status,503);assert.equal((await response.json()).bootstrap,false);
response=await api.signup.POST(request());assert.equal(response.status,503);assert.equal(globalThis.__creates,0);
console.log('OK Falha de banco não abre primeiro acesso nem cria usuário');
reset();response=await api.signup.POST(request());assert.equal(response.status,403);
globalThis.__countResult={count:0,error:null};response=await api.signup.GET();assert.equal(response.status,200);assert.equal((await response.json()).bootstrap,true);
globalThis.__writeResult={error:{message:'write failed'}};response=await api.signup.POST(request());assert.equal(response.status,503);
console.log('OK Cadastro fechado e falha de persistência sem sucesso falso');
reset();globalThis.__authUser={id:'existing',email:'test@example.invalid',user_metadata:{}};globalThis.__lookupResult={data:null,error:{message:'fetch failed'}};
assert.equal(await api.actor.getActor(),null);assert.equal(globalThis.__writes,0);
globalThis.__lookupResult={data:null,error:null};globalThis.__countResult={count:null,error:{message:'fetch failed'}};
assert.equal(await api.actor.getActor(),null);assert.equal(globalThis.__writes,0);
globalThis.__lookupResult={data:{role:'manager',name:'Gestor'},error:null};assert.equal((await api.actor.getActor()).role,'manager');
console.log('OK Falha de consulta não concede perfil de direção');
reset();globalThis.__loginResult={data:{user:null},error:{status:0,name:'AuthRetryableFetchError'}};
response=await api.login.POST(request());assert.equal(response.status,503);
globalThis.__loginResult={data:{user:null},error:{status:400,code:'invalid_credentials'}};response=await api.login.POST(request());assert.equal(response.status,401);
globalThis.__loginResult={data:{user:{id:'existing'}},error:null};response=await api.login.POST(request());assert.equal(response.status,200);
console.log('OK Login distingue indisponibilidade, credencial inválida e sucesso');
for(const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SECRET_KEY'])process.env[key]='configured';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.invalid';
reset();globalThis.__countResult={data:null,error:{message:'fetch failed'}};response=await api.health.GET();assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
globalThis.__countResult={data:[],error:null};response=await api.health.GET();assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
console.log('OK Saúde verifica conexão real com o banco');
