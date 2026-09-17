import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/admin";
import { getActor } from "../../authz";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Indica se o sistema ainda precisa do primeiro acesso (bootstrap). */
export async function GET() {
  const { count } = await supabaseAdmin()
    .from("users")
    .select("id", { count: "exact", head: true });
  return NextResponse.json(
    { bootstrap: (count ?? 0) === 0 },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

/**
 * Cadastro de usuario.
 * - Bootstrap: enquanto NAO existe nenhum usuario, o primeiro cadastro vira
 *   `ceo` (Direcao) — espelha o comportamento anterior.
 * - Depois disso, o cadastro e fechado: so direcao/gestao cria novos acessos.
 * A confirmacao por e-mail esta desativada no projeto, entao o login funciona
 * imediatamente (sem depender de SMTP).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim() || email;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (password.length < 8)
    return NextResponse.json(
      { error: "A senha precisa ter ao menos 8 caracteres." },
      { status: 400 },
    );

  const admin = supabaseAdmin();
  const { count } = await admin
    .from("users")
    .select("id", { count: "exact", head: true });
  const bootstrap = (count ?? 0) === 0;

  if (!bootstrap) {
    const actor = await getActor();
    if (!actor || !(actor.role === "ceo" || actor.role === "manager"))
      return NextResponse.json(
        {
          error:
            "O cadastro é fechado. Peça à direção ou a um gestor para criar o seu acesso.",
        },
        { status: 403 },
      );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user)
    return NextResponse.json(
      { error: error?.message || "Não foi possível criar o acesso." },
      { status: 400 },
    );

  const role = bootstrap ? "ceo" : "viewer";
  await admin
    .from("users")
    .upsert(
      {
        id: data.user.id,
        email,
        name,
        role,
        created_at: Math.floor(Date.now() / 1000),
      },
      { onConflict: "id" },
    );

  return NextResponse.json(
    {
      ok: true,
      role,
      message: bootstrap
        ? "Acesso criado como Direção (primeiro usuário do sistema)."
        : "Acesso criado.",
    },
    { status: 201 },
  );
}
