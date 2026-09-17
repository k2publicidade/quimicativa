import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
// Exercise the actual legacy parser before extraction, then the shared mapper.
const source = readFileSync(new URL('../app/api/integrations/sync/route.ts', import.meta.url), 'utf8');
const mapperPath = new URL('../lib/vhsys.ts', import.meta.url);
let map;
try {
  const code = readFileSync(mapperPath, 'utf8');
  map = await import('data:text/javascript;base64,' + Buffer.from((await transform(code, {loader:'ts',format:'esm'})).code).toString('base64'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  const code = source.slice(source.indexOf('const value ='), source.indexOf('const vhsysRows =')) + '\nexport { normalizedItems };';
  map = await import('data:text/javascript;base64,' + Buffer.from((await transform(code, {loader:'ts',format:'esm'})).code).toString('base64'));
}
const raw = {id_ped_produto:123, id_produto:456, desc_produto:'Hipoclorito', qtde_produto:'1200.0000',valor_unit_produto:'2.390000',valor_total_produto:'2868.00',ipi_produto:'0.00',icms_produto:'0.00'};
const items = map.normalizedItems({items:[raw]});
assert.equal(items.length,1,'O produto real da vhsys não pode ser descartado');
assert.equal(items[0].quantity,1200);
assert.equal(items[0].productName,'Hipoclorito');
assert.equal(map.decimal('1.200,000'),1200);
assert.equal(map.decimal('2.390000'),2.39);
assert.equal(map.decimal('0'),0);
assert.throws(()=>map.decimal('inválido'));
assert.equal(map.itemValues(raw).unit_price_cents,239);
assert.equal(map.itemValues({...raw,valor_unit_produto:'2.395',valor_total_produto:'2874.00'}).unit_price_cents,239.5);
assert.equal(map.itemValues(raw).line_total_cents,286800);
assert.throws(()=>map.itemValues({...raw,qtde_produto:'invalid'}));
assert.throws(()=>map.rows({code:403,status:'error',data:'Sem autorização'}));
assert.deepEqual(map.rows({code:200,status:'success',data:[]}),[]);
assert.equal(map.rows({data:[{'produto: ':[raw]}]})[0].desc_produto,'Hipoclorito');
console.log('ERP: regressões de mapeamento, precisão e respostas inválidas passaram.');
