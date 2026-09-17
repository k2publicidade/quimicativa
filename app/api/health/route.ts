import { NextResponse } from "next/server";

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

  return NextResponse.json({
    ok: check("NEXT_PUBLIC_SUPABASE_URL") && check("NEXT_PUBLIC_SUPABASE_ANON_KEY") && check("SUPABASE_SECRET_KEY"),
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
    hint: "Se algum item de env for false, cadastre em Vercel > Settings > Environment Variables e faca um novo deploy.",
  });
}
