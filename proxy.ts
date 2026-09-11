import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Convencao "proxy" (Next 16+): substitui o antigo middleware.ts, que esta
 * depreciado e causava MIDDLEWARE_INVOCATION_FAILED na Vercel.
 * O Next resolve o handler assim: `isProxy ? mod.proxy : mod.middleware`.
 *
 * Renova a sessao do Supabase e protege o painel.
 *
 * BLINDAGEM: roda no Edge. Se as variaveis de ambiente nao estiverem
 * configuradas, ou qualquer falha inesperada ocorrer, NAO pode derrubar o site
 * com 500. Nesse caso apenas segue em frente; o portao de verdade continua nos
 * route handlers, que respondem 401 sem sessao (app/api/authz.ts).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/og.png";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sem configuracao nao ha como validar a sessao: nao quebra o site.
  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  try {
    let response = NextResponse.next({ request });

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list)
            response.cookies.set(name, value, options);
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("return_to", pathname);
      return NextResponse.redirect(url);
    }

    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return response;
  } catch {
    // Nunca derruba a requisicao: segue para a pagina/rota, que decide.
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|mjs)$).*)",
  ],
};
