import { NextRequest, NextResponse } from 'next/server';
import { getActor, canWrite } from '../../authz';
import { createVhsysFinanceClient, getPayable, listPayables } from '../../../../lib/vhsys-finance';
import { supabaseAdmin } from '../../../../lib/supabase/admin';
import {syncVhsysRecords} from '../../../../lib/vhsys-record-sync';

async function config() {
  const row = await supabaseAdmin().from('erp_integrations').select('id,base_url,api_token,secret_api_token').eq('active', 1).order('id', { ascending: false }).limit(1).maybeSingle();
  if (row.error || !row.data) throw new Error('Integração vhsys ativa não configurada.');
  return row.data as { id: number; base_url: string; api_token: string | null; secret_api_token: string | null };
}

export async function GET(request: NextRequest) {
  if (!(await getActor())) return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 401 });
  try { const c = await config(), id = request.nextUrl.searchParams.get('id'); return NextResponse.json({ payable: id ? await getPayable(c, id) : await listPayables(c, Object.fromEntries(request.nextUrl.searchParams.entries())) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao consultar contas a pagar' }, { status: 502 }); }
}

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: 'Acesso não autorizado' }, { status: 401 });
  if (!canWrite(actor)) return NextResponse.json({ error: 'Seu perfil possui acesso somente para consulta' }, { status: 403 });
  try {
    const c = await config(), body = await request.json().catch(() => ({})) as { action?: string; id?: string; payload?: Record<string, unknown> }, client = createVhsysFinanceClient(c);
    if (body.action === 'sync') return NextResponse.json(await syncVhsysRecords(supabaseAdmin(),c,'contas-pagar',Number(request.nextUrl.searchParams.get('offset')||0)));
    if (!body.id || !['liquidar', 'desliquidar', 'atualizar'].includes(body.action || '')) return NextResponse.json({ error: 'Ação financeira inválida.' }, { status: 400 });
    if(!/^\d+$/.test(body.id)) return NextResponse.json({error:'Identificador inválido'},{status:400});
    const path = `/contas-pagar/${body.id}`;
    const payload=body.action==='desliquidar'?{liquidado_pag:'Nao'}:body.action==='liquidar'?{...body.payload,liquidado_pag:'Sim'}:body.payload;
    const result = await client(path, { method: 'PUT', body: JSON.stringify(payload || {}) });
    return NextResponse.json({ data: result.data });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha na operação financeira' }, { status: 502 }); }
}
