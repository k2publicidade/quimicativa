import type { SupabaseClient } from '@supabase/supabase-js';
import { fiscalRecord, getFiscalDetails, listVhsysCollection } from './vhsys-fiscal';
import { getPayable, listPayables, payableRecord, type VhsysConfig } from './vhsys-finance';
export async function syncVhsysRecords(s: SupabaseClient, config: VhsysConfig & {id:number}, scope:string, offset=0, remoteId?:string, preview=false) {
  if (!['entradas','notas-fiscais','contas-pagar'].includes(scope) || !Number.isSafeInteger(offset) || offset<0 || (remoteId && !/^\d+$/.test(remoteId))) throw new Error('Parâmetros de sincronização inválidos');
  const kind=scope==='entradas'?'entrada':'nota', size=5;
  const list=scope==='contas-pagar'?(remoteId?[await getPayable(config,remoteId)]:await listPayables(config,{offset,limit:size,sort:'asc'})):remoteId?[(await getFiscalDetails(config,kind,remoteId)).header]:await listVhsysCollection(config,kind==='entrada'?'/entradas-mercadoria':'/notas-fiscais',{offset,limit:size});
  let imported=0; const issues:string[]=[];
  for(const summary of list) {
    try {
      let record, department='financeiro', moduleName='Contas a Pagar';
      if(scope==='contas-pagar') {
        const id=String(summary.id_conta_pag??'');
        if(!/^\d+$/.test(id)) throw new Error('Identificador remoto ausente');
        record=payableRecord(await getPayable(config,id),config.id);
        Object.assign(record.metadata,{documentNumber:record.metadata.document,value:String(record.amountCents/100)});
      } else {
        const id=String(summary[kind==='entrada'?'id_entrada':'id_venda']??'');
        if(!/^\d+$/.test(id)) throw new Error('Identificador remoto ausente');
        const detail=await getFiscalDetails(config,kind,id);
        record=fiscalRecord(detail.header,config.id,kind,detail.products);
        record.sourcePayload=JSON.stringify(detail);
        department=kind==='entrada' || Number(detail.header.tp_nfe)===0?'compras':'financeiro';
        moduleName=department==='compras'?'Notas Fiscais de Entrada':'Notas Fiscais de Saída';
        Object.assign(record.metadata,{supplier:record.metadata.party,customer:record.metadata.party,invoiceNumber:record.metadata.number,value:String(record.amountCents/100)});
        record.status=record.status==='completed'?(department==='financeiro'?'approved':'completed'):record.status;
      }
      if(!preview) {
        const now=Math.floor(Date.now()/1000);
        const previous=await s.from('records').select('created_at,priority,owner_id').eq('source_key',record.sourceKey).maybeSingle();
        if(previous.error) throw new Error(previous.error.message);
        const result=await s.from('records').upsert({source_key:record.sourceKey,source_payload:JSON.parse(record.sourcePayload),department,module:moduleName,title:record.title,description:record.description,metadata:JSON.stringify(record.metadata),status:record.status,priority:previous.data?.priority??'medium',owner_id:previous.data?.owner_id??null,due_date:Number.isFinite(record.dueDate)?record.dueDate:null,amount_cents:record.amountCents,created_at:previous.data?.created_at??now,updated_at:now},{onConflict:'source_key'});
        if(result.error) throw new Error(result.error.message);
      }
      imported++;
    } catch(e) {issues.push(e instanceof Error?e.message:'Falha na importação');}
  }
  const nextOffset=!remoteId&&list.length===size?offset+size:null;
  const message=`${scope}: ${imported} registros processados${issues.length?` · ${issues.length} falhas`:''}`;
  if(!preview) {
    const saved=await s.from('erp_integrations').update({last_sync_at:Math.floor(Date.now()/1000),last_sync_status:issues.length?'error':nextOffset===null?'success':'running',last_sync_message:message}).eq('id',config.id);
    if(saved.error) throw new Error(saved.error.message);
  }
  return {imported,issues,nextOffset,message};
}
