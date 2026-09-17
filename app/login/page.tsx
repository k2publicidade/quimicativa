"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Mode = "login" | "bootstrap";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/auth/signup", { cache: "no-store" })
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { bootstrap?: boolean };
        setMode(d?.bootstrap ? "bootstrap" : "login");
      })
      .catch(() => {});
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const payload =
        mode === "login" ? { email, password } : { email, password, name };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!r.ok) {
        if (
          mode === "bootstrap" &&
          r.status === 403 &&
          data?.error?.includes("cadastro é fechado")
        ) {
          setMode("login");
          setNotice("O acesso administrativo já existe. Entre com o e-mail e a senha definidos.");
          return;
        }
        setError(data?.error || "Não foi possível concluir. Tente novamente.");
        return;
      }
      if (mode === "bootstrap") {
        const login = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!login.ok) {
          setNotice(
            "Acesso criado. Entre com o e-mail e a senha que você acabou de definir.",
          );
          setMode("login");
          return;
        }
      }
      window.location.href = "/";
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <Image
            className="brand-logo brand-logo-login"
            src="/brand/quimicativa-logo.png"
            alt="Quimicativa Distribuidora"
            width={223}
            height={64}
            priority
          />
          <small>Plataforma de gestão integrada</small>
        </div>

        <h1>{mode === "bootstrap" ? "Primeiro acesso" : "Entrar no painel"}</h1>
        <p className="login-hint">
          {mode === "bootstrap"
            ? "Como ainda não há nenhum usuário, este cadastro será criado com perfil de Direção."
            : "Use o e-mail e a senha do seu acesso."}
        </p>

        <form onSubmit={submit}>
          {mode === "bootstrap" && (
            <label>
              Nome completo
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            E-mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com.br"
              autoComplete="email"
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo de 8 caracteres"
              autoComplete={
                mode === "bootstrap" ? "new-password" : "current-password"
              }
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="login-notice">{notice}</p>}

          <button className="primary-button" disabled={busy}>
            {busy
              ? "Aguarde..."
              : mode === "bootstrap"
                ? "Criar acesso e entrar"
                : "Entrar"}
          </button>
        </form>

        {mode === "login" && (
          <p className="login-foot">
            Esqueceu a senha? Peça à direção para redefinir o seu acesso.
          </p>
        )}
      </section>
    </main>
  );
}
