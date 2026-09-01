// Classificação automática de documentos digitalizados (client-side, sem API externa).
// Entrada: texto extraído (OCR de imagem, texto de PDF, conteúdo de XML fiscal) + nome do arquivo.
// Saída: setor/módulo/tipo detectados + campos estruturados extraídos + nível de confiança.

export type ExtractedFields = Record<string, string>;

export type Classification = {
  department: string;
  module: string;
  documentType: string;
  fields: ExtractedFields;
  confidence: "alta" | "media" | "baixa";
  reason: string;
};

type Rule = {
  type: string;
  module: string;
  department: string;
  patterns: RegExp[];
  extract?: (text: string) => ExtractedFields;
};

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const findFirst =
  (...regexes: RegExp[]) =>
  (text: string): string => {
    for (const regex of regexes) {
      const match = text.match(regex);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };

export const extractors = {
  cnpj: (text: string) =>
    findFirst(
      /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
      /\b\d{14}\b/,
    )(text),
  cpf: (text: string) => findFirst(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, /\b\d{11}\b/)(text),
  date: (text: string) => {
    const match = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/) ??
      text.match(/\b(\d{2})\/(\d{2})\/(\d{2})\b/);
    return match ? `${match[1]}/${match[2]}/${match[3]}` : "";
  },
  money: (text: string) =>
    findFirst(
      /valor\s*(?:total|da\s*nota|do\s*servico)?\s*[:.]?\s*R\$\s*([\d.,]+)/i,
      /R\$\s*([\d.,]+)/,
    )(text),
  number: (text: string) =>
    findFirst(
      /(?:n[ºo]\s*(?:da\s*(?:nf|nota\s*fiscal)|da\s*nota|do\s*documento|documento)|numero\s*(?:da\s*(?:nf|nota)|da\s*nota)?)\s*[:.]?\s*(\d[\d.\/-]{3,})/i,
      /\b(?:n[ºo]|numero)\s*[:.]?\s*(\d[\d.\/-]{3,})\b/i,
    )(text),
  plate: (text: string) =>
    findFirst(/\b([A-Z]{3}[-\s]?\d[A-Z0-9]\d{2})\b/)(text.toUpperCase()),
  nameAfter: (labels: string[]) => (text: string) => {
    const regex = new RegExp(
      `(?:${labels.join("|")})\\s*[:.]?\\s*([A-ZÀ-Ú0-9%º][A-Za-zÀ-ú0-9%º.'-]*(?:[ \\t]+[A-Za-zÀ-ú0-9%º.'-]+){0,9})`,
      "i",
    );
    const match = text.match(regex);
    return match?.[1]?.trim() ?? "";
  },
};

const extractNF = (text: string): ExtractedFields => {
  const fields: ExtractedFields = {};
  const numero = extractors.number(text);
  const valor = extractors.money(text);
  const data = extractors.date(text);
  const fornecedor = extractors.nameAfter([
    "fornecedor",
    "emitente",
    "remetente",
  ])(text);
  const cliente = extractors.nameAfter([
    "cliente",
    "destinatario",
    "tomador",
  ])(text);
  const cnpj = extractors.cnpj(text);
  if (numero) fields.numero = numero;
  if (valor) fields.valor = valor;
  if (data) fields.data = data;
  if (fornecedor) fields.fornecedor = fornecedor;
  if (cliente) fields.cliente = cliente;
  if (cnpj) fields.cnpj = cnpj;
  return fields;
};

const rules: Rule[] = [
  {
    type: "Nota fiscal",
    module: "Notas Fiscais de Entrada",
    department: "compras",
    patterns: [
      /danfe/i,
      /documento auxiliar da nota fiscal eletronica/i,
      /nota fiscal eletronica/i,
      /nfe/i,
      /nf-e/i,
      /nota fiscal/i,
    ],
    extract: extractNF,
  },
  {
    type: "Nota fiscal de saída",
    module: "Notas Fiscais de Saída",
    department: "financeiro",
    patterns: [/nota fiscal de saida/i, /nf de saida/i, /danfe\s*-?\s*saida/i],
    extract: extractNF,
  },
  {
    type: "Boleto",
    module: "Boletos e Recebimentos",
    department: "financeiro",
    patterns: [/boleto/i, /cobranca/i, /codigo de barras/i, /pagavel ate/i, /instrucoes de pagamento/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = findFirst(/vencimento\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i)(text);
      if (valor) fields.valor = valor;
      if (data) fields.vencimento = data;
      return fields;
    },
  },
  {
    type: "Contrato",
    module: "Funcionários",
    department: "rh",
    patterns: [/contrato de trabalho/i, /contrato de experiencia/i, /clausulas?\s+do\s+contrato/i, /registro\s+em\s+carteira/i, /ctps/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const colaborador = extractors.nameAfter([
        "empregado",
        "colaborador",
        "funcionario",
        "contratado",
      ])(text);
      const cpf = extractors.cpf(text);
      const data = extractors.date(text);
      if (colaborador) fields.colaborador = colaborador;
      if (cpf) fields.cpf = cpf;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "FISPQ",
    module: "FISPQ",
    department: "produtos",
    patterns: [/fispq/i, /ficha de informacoes de seguranca/i, /ficha de dados de seguranca/i, /\bsds\b/i, /secao 1[.:]\s*identificacao/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const produto = extractors.nameAfter([
        "nome do produto",
        "produto",
        "identificacao do produto",
      ])(text);
      const onuMatch = text.match(/n[ºo]?\s*onu\s*[:.]?\s*(\d{4})\b/i);
      if (produto) fields.produto = produto;
      if (onuMatch?.[1]) fields.numeroOnu = onuMatch[1];
      return fields;
    },
  },
  {
    type: "Licença / certificado",
    module: "Licenças",
    department: "produtos",
    patterns: [/licenca ambiental/i, /\binea\b/i, /\bsiproquim\b/i, /licenciamento ambiental/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = findFirst(/(?:validade|valid ate)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i)(text);
      const numero = findFirst(/(?:n[ºo]|numero|registro)\s*[:.]?\s*([A-Z0-9][A-Z0-9.\/-]{3,20})/i)(text);
      if (data) fields.validade = data;
      if (numero) fields.numero = numero;
      return fields;
    },
  },
  {
    type: "Licença / certificado",
    module: "Licenças da Empresa",
    department: "rh",
    patterns: [/alvara/i, /corpo de bombeiros/i, /auto de vistoria/i, /certificado de regularidade/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = findFirst(/(?:validade|valid ate)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i)(text);
      if (data) fields.validade = data;
      return fields;
    },
  },
  {
    type: "Documento de veículo",
    module: "Caminhões – Documentos",
    department: "rh",
    patterns: [/\bcrlv\b/i, /licenciamento/i, /\brenavam\b/i, /seguro\s+dpvat/i, /certificado de registro e licenciamento/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const placa = extractors.plate(text);
      const data = findFirst(/(?:validade|vencimento)\s*[:.]?\s*(\d{2}\/\d{2}\/\d{4})/i)(text);
      if (placa) fields.placa = placa;
      if (data) fields.validade = data;
      return fields;
    },
  },
  {
    type: "Ficha assinada",
    module: "EPI",
    department: "rh",
    patterns: [/\bepi\b/i, /entrega de epi/i, /equipamento de protecao individual/i, /luva nitrilica/i, /respirador/i, /oculos de protecao/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const colaborador = extractors.nameAfter([
        "colaborador",
        "funcionario",
        "empregado",
      ])(text);
      if (colaborador) fields.colaborador = colaborador;
      return fields;
    },
  },
  {
    type: "Comprovante",
    module: "Entregas",
    department: "logistica",
    patterns: [/canhoto/i, /comprovante de entrega/i, /recebi.*em\s+(?:bons|perfeitas) condicoes/i, /romaneio/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = extractors.date(text);
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Orçamento / proposta",
    module: "Propostas e Orçamentos",
    department: "vendas",
    patterns: [/orcamento/i, /proposta comercial/i, /proposta\s+de\s+preco/i, /validade da proposta/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const cliente = extractors.nameAfter(["cliente", "empresa", "razao social"])(text);
      const valor = extractors.money(text);
      if (cliente) fields.cliente = cliente;
      if (valor) fields.valor = valor;
      return fields;
    },
  },
  {
    type: "Pedido de compra",
    module: "Pedidos de Compra",
    department: "compras",
    patterns: [/pedido de compra/i, /cotacao/i, /solicitacao de compra/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const numero = extractors.number(text);
      if (numero) fields.numero = numero;
      return fields;
    },
  },
  {
    type: "Ficha assinada",
    module: "Funcionários",
    department: "rh",
    patterns: [/ficha\s+de\s+registro/i, /ficha\s+funcional/i, /termo\s+de\s+responsabilidade/i, /admissao/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const colaborador = extractors.nameAfter([
        "colaborador",
        "funcionario",
        "empregado",
        "nome",
      ])(text);
      const cpf = extractors.cpf(text);
      const data = extractors.date(text);
      if (colaborador) fields.colaborador = colaborador;
      if (cpf) fields.cpf = cpf;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Laudo / relatório",
    module: "Caminhões – Manutenção",
    department: "rh",
    patterns: [/ordem de servico/i, /manutencao/i, /revisao\s+do\s+veiculo/i, /nota de servico/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = extractors.date(text);
      if (valor) fields.valor = valor;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Rótulo",
    module: "Rótulos",
    department: "embalagem",
    patterns: [/rotulo/i, /rotulagem/i, /especificacao\s+de\s+rotulo/i],
  },
  {
    type: "Comprovante",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [/recibo/i, /comprovante de pagamento/i, /pagamento\s+efetuado/i],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = extractors.date(text);
      if (valor) fields.valor = valor;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Imagem digitalizada",
    module: "Controle de Bombonas",
    department: "embalagem",
    patterns: [/bombona/i, /vasilhame/i, /controle de embalagem/i],
  },
];

const fieldLabels: Record<string, string> = {
  numero: "Número",
  numeroOnu: "Nº ONU",
  valor: "Valor",
  data: "Data",
  vencimento: "Vencimento",
  validade: "Validade",
  cnpj: "CNPJ",
  cpf: "CPF",
  placa: "Placa",
  fornecedor: "Fornecedor",
  cliente: "Cliente",
  colaborador: "Colaborador",
  produto: "Produto",
};

export const labelOf = (key: string) => fieldLabels[key] ?? key;

export function classifyDocument(
  text: string,
  filename: string,
): Classification {
  const searchable = `${text}\n${filename}`;
  const normalized = norm(searchable);
  let best: Rule | null = null;
  let bestHits = 0;
  for (const rule of rules) {
    let hits = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) hits += 1;
      if (pattern.test(norm(filename))) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = rule;
    }
  }
  if (!best || bestHits === 0)
    return {
      department: "",
      module: "",
      documentType: "Documento geral",
      fields: {},
      confidence: "baixa",
      reason: "Nenhum padrão reconhecido",
    };
  const fields = best.extract ? best.extract(text) : {};
  const confidence =
    bestHits >= 3 ? "alta" : bestHits >= 1 ? "media" : "baixa";
  return {
    department: best.department,
    module: best.module,
    documentType: best.type,
    fields,
    confidence,
    reason: `Padrões reconhecidos: ${bestHits}`,
  };
}

// --- XML fiscal (NFe) -------------------------------------------------------

export function classifyXml(xml: string, filename: string): Classification {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return classifyDocument(xml, filename);
  }
  if (parsed.querySelector("parsererror")) return classifyDocument(xml, filename);
  const nNF = parsed.querySelector("nNF")?.textContent ?? "",
    vNF = parsed.querySelector("vNF")?.textContent ?? "",
    dhEmi = parsed.querySelector("dhEmi")?.textContent ?? "",
    emitNome = parsed.querySelector("emit xNome")?.textContent ?? "",
    emitCnpj = parsed.querySelector("emit CNPJ")?.textContent ?? "",
    destNome = parsed.querySelector("dest xNome")?.textContent ?? "",
    destCnpj = parsed.querySelector("dest CNPJ")?.textContent ?? "",
    mod = parsed.querySelector("mod")?.textContent ?? "";
  if (!nNF && !vNF && !emitNome) return classifyDocument(xml, filename);
  const fields: ExtractedFields = {};
  if (nNF) fields.numero = nNF;
  if (vNF) fields.valor = vNF;
  if (dhEmi) {
    const match = dhEmi.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const [y, m, d] = match[1].split("-");
      fields.data = `${d}/${m}/${y}`;
    }
  }
  if (emitNome) fields.fornecedor = emitNome;
  if (emitCnpj) fields.cnpj = emitCnpj;
  if (destNome) fields.cliente = destNome;
  if (destCnpj && !emitCnpj) fields.cnpj = destCnpj;
  const saida = norm(mod) === "55" && destNome && !emitNome.includes(destNome);
  return {
    department: saida ? "financeiro" : "compras",
    module: saida ? "Notas Fiscais de Saída" : "Notas Fiscais de Entrada",
    documentType: "Nota fiscal",
    fields,
    confidence: nNF ? "alta" : "media",
    reason: "XML fiscal (NF-e)",
  };
}

export function extractPdfText(pages: string[]): string {
  return pages.join("\n");
}
