let running: Promise<{message:string}> | null = null;
export function syncErp(onProgress?: (message:string)=>void) {
  if(running) return running;
  running=(async()=>{
    let offset=0, imported=0, skipped=0;
    const issues:string[]=[];
    for(;;) {
      const response=await fetch(`/api/integrations/sync?offset=${offset}`,{method:'POST'});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Falha ao sincronizar ERP');
      imported+=data.imported??0; skipped+=data.skipped??0; issues.push(...(data.issues??[]));
      onProgress?.(`${imported} pedidos atualizados · ${skipped} sem alterações${issues.length?` · ${issues.length} falhas`:''}`);
      if(data.nextOffset===null || data.nextOffset===undefined) break;
      if(data.nextOffset<=offset) throw new Error('Paginação do ERP não avançou');
      offset=data.nextOffset;
    }
    if(issues.length) throw new Error(`${issues.length} pedido(s) com falha. ${issues.slice(0,2).join(' ')}`);
    return {message:`Sincronização concluída: ${imported} pedidos atualizados · ${skipped} sem alterações.`};
  })().finally(()=>{running=null;});
  return running;
}
