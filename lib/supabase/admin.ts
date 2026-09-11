import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "./env";

/**
 * Cliente com a chave secreta (service role): ignora RLS.
 * USO EXCLUSIVO NO SERVIDOR. O controle de acesso (RBAC) e aplicado em
 * app/api/authz.ts, exatamente como era feito sobre o D1.
 *
 * O schema nao e tipado (generics `any`) de proposito: o app fala com o banco
 * por SQL (ver db/index.ts), entao os tipos de tabela nao agregam aqui.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, "public", any>;

let cached: Client | null = null;

export function supabaseAdmin(): Client {
  if (!cached) {
    cached = createClient<any, "public", any>(supabaseUrl(), supabaseSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
