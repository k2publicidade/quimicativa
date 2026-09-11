import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Cliente Supabase ligado a sessao do usuario (cookies).
 * Use em route handlers e server components.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // chamado de um Server Component (cookies read-only): ignorado,
          // o middleware e os route handlers cuidam do refresh da sessao.
        }
      },
    },
  });
}

/** Usuario autenticado (ou null). */
export async function getSupabaseUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
