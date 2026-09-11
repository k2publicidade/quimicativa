const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
};

const isPrivateHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host) || host.startsWith("::ffff:") ||
    isPrivateIpv4(host);
};

export function externalErpUrl(baseUrlInput: string, ordersPathInput: string) {
  let base: URL;
  try {
    base = new URL(baseUrlInput);
  } catch {
    throw new Error("Informe uma URL válida para o ERP.");
  }
  if (base.protocol !== "https:") throw new Error("A URL do ERP deve começar com https://");
  if (base.username || base.password) throw new Error("Não inclua credenciais na URL do ERP; use o campo de token.");
  if (base.search || base.hash) throw new Error("A URL base do ERP não deve conter consulta ou fragmento.");
  if (isPrivateHost(base.hostname)) throw new Error("A URL do ERP deve apontar para um serviço externo autorizado.");
  if (!ordersPathInput.startsWith("/") || ordersPathInput.startsWith("//") || ordersPathInput.includes("\\")) {
    throw new Error("O caminho dos pedidos deve começar com uma única barra (/).");
  }
  const baseUrl = baseUrlInput.trim().replace(/\/+$/, "");
  const endpoint = new URL(`${baseUrl}${ordersPathInput}`);
  if (endpoint.origin !== base.origin || isPrivateHost(endpoint.hostname)) throw new Error("O endpoint de pedidos é inválido.");
  return {
    baseUrl,
    ordersPath: ordersPathInput,
    endpoint: endpoint.toString(),
  };
}
