/**
 * Cliente mínimo da API do DeepSeek (compatível com o formato de chat da OpenAI).
 * A chave fica só na variável de ambiente DEEPSEEK_API_KEY, nunca no código ou no navegador.
 */
export const deepseekConfigured = () => Boolean(process.env.DEEPSEEK_API_KEY);

export async function deepseekJson(system: string, user: string, timeoutMs = 90_000): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY não configurada.");
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek respondeu HTTP ${response.status}.`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek não retornou conteúdo.");
  try { return JSON.parse(content); } catch { throw new Error("DeepSeek retornou um JSON inválido."); }
}
