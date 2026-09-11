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
  if (error || !data.user)
    return NextResponse.json(
      { error: "E-mail ou senha inválidos." },
      { status: 401 },
    );

  return NextResponse.json({ ok: true });
}
