import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase/admin";

/**
 * Diagnostico rapido de configuracao. Nao expoe valores, apenas se existem.
 * Abra /api/health na Vercel para saber o que falta configurar.
 * Publica de proposito (o middleware a libera) e sem dados sensiveis.
 */
export async function GET() {
  const env = process.env;
  const check = (name: string) => Boolean(env[name]);

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const cryptoOk = typeof globalThis.crypto?.randomUUID === "function";
  const configured = check("NEXT_PUBLIC_SUPABASE_URL") && check("NEXT_PUBLIC_SUPABASE_ANON_KEY") && check("SUPABASE_SECRET_KEY");
  let databaseReachable = false;
  if (configured) {
    try {
      const { error } = await supabaseAdmin().from("users").select("id").limit(1).abortSignal(AbortSignal.timeout(5000));
      databaseReachable = !error;
    } catch { /* Retorna estado indisponível sem expor detalhes do banco. */ }
  }

  return NextResponse.json({
    ok: configured && databaseReachable,
    databaseReachable,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: check("NEXT_PUBLIC_SUPABASE_URL"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: check("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      SUPABASE_SECRET_KEY: check("SUPABASE_SECRET_KEY"),
      SUPABASE_STORAGE_BUCKET: check("SUPABASE_STORAGE_BUCKET"),
      NEXT_PUBLIC_MAPBOX_TOKEN: check("NEXT_PUBLIC_MAPBOX_TOKEN"),
      MAPBOX_ACCESS_TOKEN: check("MAPBOX_ACCESS_TOKEN"),
    },
    supabaseHost: url ? new URL(url).host : null,
    runtime: "edge",
    randomUUID: cryptoOk,
    hint: !configured ? "Confira as variáveis de ambiente de produção." : !databaseReachable ? "Não foi possível conectar ao banco. Confira o estado do projeto Supabase." : "Configuração e conexão com o banco disponíveis.",
  }, { status: configured && databaseReachable ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
