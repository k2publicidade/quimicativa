import { env } from "node:process";

/**
 * Variaveis de ambiente do Supabase.
 * Configure na Vercel (Project > Settings > Environment Variables):
 *   NEXT_PUBLIC_SUPABASE_URL       - https://<ref>.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  - chave publishable (usada no browser)
 *   SUPABASE_SECRET_KEY            - chave secreta (SO no servidor)
 */
const read = (name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`Variavel de ambiente ausente: ${name}`);
  return value;
};

export const supabaseUrl = (): string =>
  env.NEXT_PUBLIC_SUPABASE_URL || read("SUPABASE_URL");
export const supabaseAnonKey = (): string =>
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  read("SUPABASE_PUBLISHABLE_KEY");
export const supabaseSecretKey = (): string => read("SUPABASE_SECRET_KEY");

export const hasSupabaseEnv = (): boolean =>
  Boolean(
    (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL) &&
      (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        env.SUPABASE_PUBLISHABLE_KEY) &&
      env.SUPABASE_SECRET_KEY,
  );
