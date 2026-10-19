import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password)
    return NextResponse.json(
      { error: "Informe e-mail e senha." },
      { status: 400 },
    );

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error && (!error.status || error.status >= 500))
    return NextResponse.json(
      { error: "O serviço de acesso está temporariamente indisponível. Tente novamente em instantes." },
      { status: 503 },
    );
  if (error?.status === 429)
    return NextResponse.json(
      { error: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." },
      { status: 429 },
    );
  if (error || !data.user)
    return NextResponse.json(
      { error: "E-mail ou senha inválidos." },
      { status: 401 },
    );

  return NextResponse.json({ ok: true });
}
