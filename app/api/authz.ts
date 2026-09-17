import { supabaseAdmin } from "../../lib/supabase/admin";
import { getSupabaseUser } from "../../lib/supabase/server";

export type Actor = {
  userId: string;
  email: string;
  displayName: string;
  role: "ceo" | "manager" | "operator" | "viewer";
};

/**
 * Resolve o ator autenticado a partir da sessao Supabase Auth e do papel
 * gravado em public.users. O primeiro usuario do sistema vira `ceo`
 * (bootstrap); os demais entram como `viewer` ate alguem da direcao mudar.
 *
 * Mantem a MESMA assinatura de antes (ChatGPT auth), entao as 28 rotas que
 * usam canWrite/canValidate/canReadConfidential seguem valendo sem alteracao.
 */
export async function getActor(): Promise<Actor | null> {
  const user = await getSupabaseUser();
  if (!user) return null;

  const email = user.email ?? "";
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    email;

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("users")
    .select("role, name")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    return {
      userId: user.id,
      email,
      displayName: existing.name || displayName,
      role: existing.role as Actor["role"],
    };
  }

  const { count } = await db
    .from("users")
    .select("id", { count: "exact", head: true });
  const role: Actor["role"] = (count ?? 0) === 0 ? "ceo" : "viewer";

  await db.from("users").insert({
    id: user.id,
    email,
    name: displayName,
    role,
    created_at: Math.floor(Date.now() / 1000),
  });

  return { userId: user.id, email, displayName, role };
}

export const canWrite = (actor: Actor) => actor.role !== "viewer";
export const canValidate = (actor: Actor) =>
  actor.role === "ceo" || actor.role === "manager";
export const canReadConfidential = (actor: Actor) => actor.role === "ceo";
