import { NextRequest, NextResponse } from 'next/server';
import { getD1 } from '../../../../db';
import { getActor, canWrite } from '../../authz';
import { createVhsysFinanceClient, getPayable, listPayables, payableRecord } from '../../../../lib/vhsys-finance';
import { supabaseAdmin } from '../../../../lib/supabase/admin';

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
    if (body.action === 'sync') {
      const db = getD1(), now = Math.floor(Date.now() / 1000), remote = await listPayables(c), records = remote.map(row => payableRecord(row, c.id));
      for (const record of records) await db.prepare(`INSERT INTO records (source_key,source_payload,department,module,title,description,metadata,status,priority,owner_id,due_date,amount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET source_payload=excluded.source_payload,title=excluded.title,description=excluded.description,metadata=excluded.metadata,status=excluded.status,due_date=excluded.due_date,amount_cents=excluded.amount_cents,updated_at=excluded.updated_at`).bind(record.sourceKey, record.sourcePayload, 'financeiro', 'Contas a Pagar', record.title, record.description, JSON.stringify(record.metadata), record.status, 'medium', actor.userId, record.dueDate, record.amountCents, now, now).run();
      return NextResponse.json({ imported: records.length, message: `${records.length} conta(s) a pagar sincronizada(s).` });
    }
    if (!body.id || !['liquidar', 'desliquidar', 'atualizar'].includes(body.action || '')) return NextResponse.json({ error: 'Ação financeira inválida.' }, { status: 400 });
    const path = body.action === 'liquidar' ? `/contas-pagar/${body.id}/liquidar` : body.action === 'desliquidar' ? `/contas-pagar/${body.id}/desliquidar` : `/contas-pagar/${body.id}`;
    const result = await client(path, { method: body.action === 'atualizar' ? 'PUT' : 'PUT', body: JSON.stringify(body.payload || {}) });
    return NextResponse.json({ data: result.data });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha na operação financeira' }, { status: 502 }); }
}
