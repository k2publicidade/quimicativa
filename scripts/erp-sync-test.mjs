import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['lib/vhsys-sync.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {syncVhsysBatch}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const config={id:2,base_url:'https://api.vhsys.com/v2',api_token:'test',secret_api_token:'test'};
const order={id_ped:99,id_pedido:10,id_cliente:7,valor_total_produtos:'2868',valor_total_nota:'2868'};
const item={id_ped_produto:11,id_produto:0,desc_produto:'Produto avulso',qtde_produto:'1200.0000',valor_unit_produto:'2.390000',valor_total_produto:'2868.00'};
let statements=[], requested=[], failProducts=false;
const s={
  from(table) {return {
    select(){return this;},eq(){return this;},
    maybeSingle:async()=>({data:null,error:null}),
    single:async()=>({data:{id:1},error:null}),
    update(){return {eq:async()=>({error:null})};},
  };},
  rpc:async(_,{queries})=>{statements.push(...queries);return {error:null};},
};
globalThis.fetch=async(url)=>{
  const path=new URL(url).pathname.replace('/v2',''); requested.push(path);
  if(path==='/pedidos/99/parcelas') return new Response(JSON.stringify({code:403,status:'error',data:'Nenhuma parcela para o pedido encontrado!'}),{status:403});
  if(path==='/pedidos/99/produtos'&&failProducts) return new Response(JSON.stringify({code:401,status:'error'}),{status:401});
  const data=path==='/pedidos/99'?order:path==='/pedidos/99/produtos'?[item]:path==='/clientes/7'?{id_cliente:7,razao_cliente:'Cliente teste'}:undefined;
  assert.notEqual(data,undefined,`Consulta inesperada: ${path}`);
  return new Response(JSON.stringify({code:200,status:'success',data}),{status:200});
};
const result=await syncVhsysBatch(s,config,{remoteId:'99',force:true});
assert.deepEqual(result.issues,[]);
assert.equal(result.imported,1);
assert.ok(!requested.includes('/produtos/0'),'Produto avulso não pode exigir catálogo inexistente');
assert.ok(statements.some(q=>q.startsWith('INSERT INTO order_items')&&q.includes('1200')&&q.includes('286800')));
assert.ok(!statements.some(q=>q.startsWith('INSERT INTO products')),'Produto avulso não cria catálogo artificial');
assert.ok(statements.some(q=>q.includes('source_key IS NOT NULL')),'Itens manuais devem ser preservados');
statements=[]; failProducts=true;
const failed=await syncVhsysBatch(s,config,{remoteId:'99',force:true});
assert.equal(failed.imported,0);
assert.equal(failed.issues.length,1);
assert.equal(statements.length,0,'Falha na coleta deve preservar todo o pedido existente');
console.log('ERP: produto avulso, importação atômica e preservação após falha passaram.');
