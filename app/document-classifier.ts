// Classificação automática de documentos digitalizados (client-side, sem API externa).
// Entrada: texto extraído (OCR de imagem, texto de PDF, conteúdo de XML fiscal) + nome do arquivo.
// Saída: setor/módulo/tipo detectados + campos estruturados extraídos + nível de confiança.
// Cobre o fluxo completo de uma distribuidora de produtos químicos: RH, frota, logística e
// transporte de perigosos, embalagem, vendas, compras, financeiro/impostos e compliance de produtos.

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

const dateAfter = (labels: string[]) =>
  findFirst(
    new RegExp(
      `(?:${labels.join("|")})\\s*[:.]?\\s*(\\d{2}\\/\\d{2}\\/\\d{4})`,
      "i",
    ),
  );

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
      /valor\s*(?:total|da\s*nota|do\s*servico|liquido)?\s*[:.]?\s*R\$\s*([\d.,]+)/i,
      /R\$\s*([\d.,]+)/,
    )(text),
  number: (text: string) =>
    findFirst(
      /(?:n[ºo]\s*(?:da\s*(?:nf|nota\s*fiscal)|da\s*nota|do\s*documento|documento)|numero\s*(?:da\s*(?:nf|nota)|da\s*nota)?)\s*[:.]?\s*(\d[\d.\/-]{3,})/i,
      /\b(?:n[ºo]|numero)\s*[:.]?\s*(\d[\d.\/-]{3,})\b/i,
    )(text),
  plate: (text: string) =>
    findFirst(/\b([A-Z]{3}[-\s]?\d[A-Z0-9]\d{2})\b/)(text.toUpperCase()),
  lot: (text: string) =>
    findFirst(/\blote\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9.\/-]{2,20})/i)(text),
  nameAfter: (labels: string[]) => (text: string) => {
    const lb = labels.join("|");
    const word = `[A-ZÀ-Ú0-9%º][A-Za-zÀ-ú0-9%º.'-]*(?:[ \\t]+[A-Za-zÀ-ú0-9%º.'-]+){0,9}`;
    const colon = new RegExp(
      `(?<![A-Za-zÀ-ú])(?:${lb})\\s*[:.]\\s*(${word})`,
      "i",
    );
    const plain = new RegExp(
      `(?<![A-Za-zÀ-ú])(?:${lb})[ \\t]*[:.]?[ \\t]*(${word})`,
      "i",
    );
    return (
      text.match(colon)?.[1]?.trim() ??
      text.match(plain)?.[1]?.trim() ??
      ""
    );
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

const extractColaborador = (text: string): ExtractedFields => {
  const fields: ExtractedFields = {};
  const colaborador = extractors.nameAfter([
    "colaborador",
    "funcionario",
    "empregado",
    "contratado",
  ])(text);
  const cpf = extractors.cpf(text);
  const data = extractors.date(text);
  if (colaborador) fields.colaborador = colaborador;
  if (cpf) fields.cpf = cpf;
  if (data) fields.data = data;
  return fields;
};

// Regras em ordem de especificidade: a primeira regra com mais padrões acertados vence.
const rules: Rule[] = [
  // ── FISCAL / NOTAS ────────────────────────────────────────────────────────
  {
    type: "Nota fiscal de saída",
    module: "Notas Fiscais de Saída",
    department: "financeiro",
    patterns: [
      /nota fiscal de saida/,
      /nf de saida/,
      /danfe\s*-?\s*saida/,
      /nfe de saida/,
      /saida de mercadoria/,
      /saida/,
    ],
    extract: extractNF,
  },
  {
    type: "Nota fiscal",
    module: "Notas Fiscais de Entrada",
    department: "compras",
    patterns: [
      /danfe/,
      /documento auxiliar da nota fiscal eletronica/,
      /nota fiscal eletronica/,
      /\bnfe\b/,
      /nf-e/,
      /nota fiscal/,
    ],
    extract: extractNF,
  },
  {
    type: "XML fiscal",
    module: "Notas Fiscais de Entrada",
    department: "compras",
    patterns: [/<nfe/i, /<infnfe/i, /<nprot>/],
  },

  // ── FINANCEIRO ────────────────────────────────────────────────────────────
  {
    type: "Boleto",
    module: "Boletos e Recebimentos",
    department: "financeiro",
    patterns: [/boleto/, /cobranca/, /codigo de barras/, /pagavel ate/, /instrucoes de pagamento/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = dateAfter(["vencimento", "pagavel ate"])(text);
      if (valor) fields.valor = valor;
      if (data) fields.vencimento = data;
      return fields;
    },
  },
  {
    type: "Fatura / duplicata",
    module: "Boletos e Recebimentos",
    department: "financeiro",
    patterns: [/duplicata/, /fatura\s*(?:de\s*)?(?:cobranca|venda|prestacao)?/, /faturamento/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const numero = extractors.number(text);
      const valor = extractors.money(text);
      const data = dateAfter(["vencimento", "pagamento"])(text);
      if (numero) fields.numero = numero;
      if (valor) fields.valor = valor;
      if (data) fields.vencimento = data;
      return fields;
    },
  },
  {
    type: "Comprovante",
    module: "Boletos e Recebimentos",
    department: "financeiro",
    patterns: [/comprovante de venda/, /maquininha/, /\bpos\b.*venda/, /cupom\s+(?:fiscal|n[aã]o\s+fiscal)/],
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
    type: "Comprovante",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [
      /comprovante de (?:pagamento|transferencia|deposito)/,
      /transferencia bancaria/,
      /\bpix\b/,
      /\bted\b/,
      /\bdoc\b.*banc/,
      /deposito\s+bancario/,
      /pagamento\s+efetuado/,
      /recibo/,
    ],
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
    type: "Guia / imposto",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [
      /guia de recolhimento/,
      /\bdarf\b/,
      /\bdas\b/,
      /\bgps\b/,
      /\bgfip\b/,
      /simples nacional/,
      /contribuicao\s+previdenciaria/,
      /imposto\s+(?:sobre\s+)?(?:circulacao|sobre\s+servicos|predial)/,
      /\bicms\b/,
      /\biss\b.*(?:nota|servico)/,
      /\bpis\b/,
      /\bcofins\b/,
      /\bipi\b/,
      /\bdctfweb\b/,
      /\besocial\b/,
      /situacao fiscal/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = dateAfter(["vencimento", "data de pagamento"])(text);
      if (valor) fields.valor = valor;
      if (data) fields.vencimento = data;
      return fields;
    },
  },
  {
    type: "Guia / imposto",
    module: "DRE e Relatórios",
    department: "financeiro",
    patterns: [
      /imposto de renda/,
      /declaracao de ajuste anual/,
      /recibo de entrega da declaracao/,
      /informe de rendimentos/,
    ],
  },
  {
    type: "Extrato bancário",
    module: "DRE e Relatórios",
    department: "financeiro",
    patterns: [
      /extrato bancario/,
      /extrato de conta/,
      /extrato\s+(?:corrente|poupanca)/,
      /conta corrente/,
      /conta cheque/,
      /cheque\s+especial/,
      /saldo\s+(?:da\s+)?conta/,
      /lancamentos?\s+(?:da|em)\s+conta/,
    ],
  },
  {
    type: "Fatura / duplicata",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [
      /conta de (?:luz|energia|agua|gas|telefone|internet)/,
      /fatura de (?:energia|agua|gas|telefone)/,
      /consumo\s+de\s+energia/,
      /fatura\s+de\s+consumo/,
      /companhia\s+(?:de\s+)?(?:energia|agua|gas)/,
      /(?:energia\s+eletrica|abastecimento\s+de\s+agua)/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = dateAfter(["vencimento", "pagamento"])(text);
      const numero = findFirst(/(?:n[ºo]|numero|fatura)\s*[:.]?\s*([A-Z0-9][A-Z0-9.\/-]{3,20})/i)(text);
      if (valor) fields.valor = valor;
      if (data) fields.vencimento = data;
      if (numero) fields.numero = numero;
      return fields;
    },
  },
  {
    type: "Seguro / apólice",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [/apolice de seguro/, /seguro de vida/, /seguro patrimonial/, /endosso\s+de\s+apolice/, /premio\s+de\s+seguro/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = dateAfter(["vigencia", "validade"])(text);
      if (data) fields.validade = data;
      return fields;
    },
  },
  {
    type: "Contrato",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [/contrato de financiamento/, /financiamento\s+(?:de\s+)?veiculo/, /carnê/, /\bleasing\b/, /credito\s+(?:pessoal|consignado)/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = dateAfter(["vencimento"])(text);
      if (valor) fields.valor = valor;
      if (data) fields.vencimento = data;
      return fields;
    },
  },
  {
    type: "Nota fiscal",
    module: "Contas a Pagar",
    department: "financeiro",
    patterns: [/nota de debito/, /nota de credito/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = extractors.date(text);
      if (valor) fields.valor = valor;
      if (data) fields.data = data;
      return fields;
    },
  },

  // ── VENDAS ────────────────────────────────────────────────────────────────
  {
    type: "Orçamento / proposta",
    module: "Propostas e Orçamentos",
    department: "vendas",
    patterns: [/orcamento/, /proposta comercial/, /proposta\s+de\s+preco/, /validade da proposta/, /condicoes comerciais/],
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
    type: "Registro / cadastro",
    module: "Clientes",
    department: "vendas",
    patterns: [/ficha cadastral/, /cadastro de cliente/, /proposta de credito/, /cadastro\s+de\s+pessoa\s+(?:juridica|fisica)/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const cliente = extractors.nameAfter(["cliente", "empresa", "razao social"])(text);
      const cnpj = extractors.cnpj(text);
      const cpf = extractors.cpf(text);
      if (cliente) fields.cliente = cliente;
      if (cnpj) fields.cnpj = cnpj;
      if (cpf) fields.cpf = cpf;
      return fields;
    },
  },
  {
    type: "Contrato",
    module: "Clientes",
    department: "vendas",
    patterns: [
      /representacao comercial/,
      /contrato de fornecimento/,
      /contrato de compra e venda/,
      /contrato de prestacao de servicos/,
      /contrato de exclusividade/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const cliente = extractors.nameAfter(["cliente", "contratante", "razao social"])(text);
      const data = extractors.date(text);
      if (cliente) fields.cliente = cliente;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Registro / cadastro",
    module: "Pesquisa de Satisfação",
    department: "vendas",
    patterns: [/pesquisa de satisfacao/, /pesquisa de opiniao/, /nps\s*(?:de\s*)?satisfacao/],
  },

  // ── COMPRAS ───────────────────────────────────────────────────────────────
  {
    type: "Pedido de compra",
    module: "Pedidos de Compra",
    department: "compras",
    patterns: [/pedido de compra/, /cotacao/, /solicitacao de compra/, /orcamento de fornecedor/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const numero = extractors.number(text);
      const fornecedor = extractors.nameAfter(["fornecedor", "empresa"])(text);
      if (numero) fields.numero = numero;
      if (fornecedor) fields.fornecedor = fornecedor;
      return fields;
    },
  },
  {
    type: "Registro / cadastro",
    module: "Fornecedores",
    department: "compras",
    patterns: [/cadastro de fornecedor/, /ficha de fornecedor/, /certificado de fornecedor/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const fornecedor = extractors.nameAfter(["fornecedor", "razao social", "empresa"])(text);
      const cnpj = extractors.cnpj(text);
      if (fornecedor) fields.fornecedor = fornecedor;
      if (cnpj) fields.cnpj = cnpj;
      return fields;
    },
  },

  // ── PRODUTOS E COMPLIANCE QUÍMICO ─────────────────────────────────────────
  {
    type: "FISPQ",
    module: "FISPQ",
    department: "produtos",
    patterns: [/fispq/, /ficha de informacoes de seguranca/, /ficha de dados de seguranca/, /\bsds\b/, /secao 1[.:]\s*identificacao/],
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
    type: "Certificado de análise",
    module: "Produtos",
    department: "produtos",
    patterns: [
      /certificado de analise/,
      /\bcoa\b/,
      /laudo de analise/,
      /laudo\s+do\s+produto/,
      /laudo\s+tecnico\s+do\s+produto/,
      /laudo\s+de\s+qualidade/,
      /laudo\s+de\s+controle\s+de\s+qualidade/,
      /boletim de qualidade/,
      /resultado\s+de\s+analise/,
      /especificacao\s+(?:e\s+)?(?:metodo|resultado)/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const produto = extractors.nameAfter(["produto", "descricao do produto"])(text);
      const lote = extractors.lot(text);
      const data = extractors.date(text);
      if (produto) fields.produto = produto;
      if (lote) fields.lote = lote;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Documento de produto controlado",
    module: "Produtos",
    department: "produtos",
    patterns: [
      /produto controlado/,
      /policia federal/,
      /exercito\s+(?:brasileiro)?/,
      /requerimento\s+de\s+compra\s+de\s+produto/,
      /declaracao\s+de\s+consumo/,
      /balanco\s+de\s+produto\s+controlado/,
      /autorizacao\s+de\s+(?:compra|movimentacao)/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const produto = extractors.nameAfter(["produto", "descricao"])(text);
      const numero = extractors.number(text);
      if (produto) fields.produto = produto;
      if (numero) fields.numero = numero;
      return fields;
    },
  },
  {
    type: "Licença / certificado",
    module: "Licenças",
    department: "produtos",
    patterns: [
      /licenca ambiental/,
      /\binea\b/,
      /\bsiproquim\b/,
      /licenciamento ambiental/,
      /\banvisa\b/,
      /\bibama\b/,
      /registro\s+de\s+saneante/,
      /notificacao\s+de\s+saneante/,
      /licenca\s+de\s+operacao/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = dateAfter(["validade", "valid ate"])(text);
      const numero = findFirst(/(?:n[ºo]|numero|registro)\s*[:.]?\s*([A-Z0-9][A-Z0-9.\/-]{3,20})/i)(text);
      if (data) fields.validade = data;
      if (numero) fields.numero = numero;
      return fields;
    },
  },

  // ── RH ────────────────────────────────────────────────────────────────────
  {
    type: "Documento de identificação",
    module: "Funcionários",
    department: "rh",
    patterns: [
      /\bctps\b/,
      /carteira\s+de\s+trabalho/,
      /\bcnh\b/,
      /carteira nacional de habilitacao/,
      /habilitacao\s+(?:de\s+)?motorista/,
      /\brg\b.*(?:identidade)?/,
      /carteira de identidade/,
      /\bidentidade\b/,
      /passaporte/,
      /certificado\s+de\s+reservista/,
      /registro\s+geral/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const colaborador = extractors.nameAfter([
        "nome",
        "titular",
        "portador",
        "motorista",
      ])(text);
      const numero = findFirst(
        /(?:n[ºo]|numero|registro)\s*[:.]?\s*([A-Z0-9][A-Z0-9.\/-]{3,20})/i,
        /\b(\d{2,3}\.\d{3}\.\d{3}[-\s]?\d)\b/,
      )(text);
      const validade = dateAfter(["validade", "vencimento"])(text);
      const cpf = extractors.cpf(text);
      if (colaborador) fields.colaborador = colaborador;
      if (numero) fields.numero = numero;
      if (validade) fields.validade = validade;
      if (cpf) fields.cpf = cpf;
      return fields;
    },
  },
  {
    type: "Contrato",
    module: "Funcionários",
    department: "rh",
    patterns: [
      /contrato de trabalho/,
      /contrato de experiencia/,
      /clausulas?\s+do\s+contrato/,
      /registro\s+em\s+carteira/,
      /\bctps\b/,
      /\bclt\b/,
      /admissao\s+de\s+funcionario/,
    ],
    extract: extractColaborador,
  },
  {
    type: "Exame / atestado",
    module: "Funcionários",
    department: "rh",
    patterns: [
      /\baso\b/,
      /atestado de saude ocupacional/,
      /exame admissional/,
      /exame periodico/,
      /exame demissional/,
      /exame\s+medico\s+ocupacional/,
      /atestado medico/,
      /atestado de comparecimento/,
      /\bcat\b.*(?:acidente|trabalho)/,
      /comunicacao de acidente de trabalho/,
    ],
    extract: (text) => {
      const fields = extractColaborador(text);
      const tipo = findFirst(/exame\s+(admissional|periodico|demissional)/i)(text);
      if (tipo) fields.tipoExame = tipo;
      return fields;
    },
  },
  {
    type: "Holerite",
    module: "Funcionários",
    department: "rh",
    patterns: [/holerite/, /contracheque/, /folha de pagamento/, /salario\s+liquido/, /proventos\s+e\s+descontos/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const colaborador = extractors.nameAfter([
        "colaborador",
        "funcionario",
        "empregado",
        "matricula",
      ])(text);
      const valor = extractors.money(text);
      const competencia = findFirst(/\b(\d{2}\/\d{4})\b/)(text);
      if (colaborador) fields.colaborador = colaborador;
      if (valor) fields.valor = valor;
      if (competencia) fields.competencia = competencia;
      return fields;
    },
  },
  {
    type: "Termo / rescisão",
    module: "Funcionários",
    department: "rh",
    patterns: [
      /\btrct\b/,
      /termo de rescisao/,
      /rescisao\s+de\s+contrato/,
      /aviso previo/,
      /recibo de ferias/,
      /aviso de ferias/,
      /ferias\s+proporcionais/,
      /decimo terceiro/,
      /13[ºo]\s+salario/,
    ],
    extract: (text) => {
      const fields = extractColaborador(text);
      const valor = extractors.money(text);
      if (valor) fields.valor = valor;
      return fields;
    },
  },
  {
    type: "Currículo",
    module: "Recrutamento e Seleção",
    department: "rh",
    patterns: [/curriculo/, /experiencia profissional/, /formacao academica/, /objetivo profissional/, /pretensao salarial/],
  },
  {
    type: "Registro / cadastro",
    module: "Funcionários",
    department: "rh",
    patterns: [/registro de ponto/, /cartao\s+de\s+ponto/, /espelho de ponto/, /jornada de trabalho/, /banco de horas/],
    extract: extractColaborador,
  },
  {
    type: "Licença / certificado",
    module: "Funcionários",
    department: "rh",
    patterns: [
      /certificado de treinamento/,
      /treinamento\s+nr[-\s]?/,
      /\bnr-20\b/,
      /\bnr-35\b/,
      /\bnr-33\b/,
      /\bnr-12\b/,
      /integracao\s+de\s+seguranca/,
      /lista de presenca/,
    ],
    extract: extractColaborador,
  },
  {
    type: "Laudo / relatório",
    module: "Funcionários",
    department: "rh",
    patterns: [
      /\bppp\b/,
      /\bltcat\b/,
      /\bpgr\b/,
      /\bpcms0\b/,
      /\bpcmo\b/,
      /laudo tecnico das condicoes ambientais/,
      /programa de gerenciamento de riscos/,
      /\bspda\b/,
      /para[- ]?raios/,
      /laudo ergonomico/,
      /avaliacao\s+de\s+riscos/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = extractors.date(text);
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Ficha assinada",
    module: "Funcionários",
    department: "rh",
    patterns: [/ficha\s+de\s+registro/, /ficha\s+funcional/, /termo\s+de\s+responsabilidade/, /admissao/, /termo\s+de\s+sigilo/, /termo\s+de\s+confidencialidade/],
    extract: extractColaborador,
  },
  {
    type: "Ficha assinada",
    module: "Uniformes",
    department: "rh",
    patterns: [/uniformes/, /entrega de uniforme/, /vale[- ]?uniforme/],
    extract: extractColaborador,
  },
  {
    type: "Ficha assinada",
    module: "EPI",
    department: "rh",
    patterns: [/\bepi\b/, /entrega de epi/, /equipamento de protecao individual/, /luva nitrilica/, /respirador/, /oculos de protecao/, /capacete\s+de\s+seguranca/],
    extract: extractColaborador,
  },

  // ── FROTA (caminhões) ─────────────────────────────────────────────────────
  {
    type: "Documento de veículo",
    module: "Caminhões – Documentos",
    department: "rh",
    patterns: [/\bcrlv\b/, /licenciamento/, /\brenavam\b/, /seguro\s+dpvat/, /certificado de registro e licenciamento/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const placa = extractors.plate(text);
      const data = dateAfter(["validade", "vencimento"])(text);
      if (placa) fields.placa = placa;
      if (data) fields.validade = data;
      return fields;
    },
  },
  {
    type: "Seguro / apólice",
    module: "Caminhões – Documentos",
    department: "rh",
    patterns: [/seguro\s+do\s+veiculo/, /apolice.*veiculo/, /apolice.*caminhao/, /seguro\s+de\s+frota/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const placa = extractors.plate(text);
      const data = dateAfter(["vigencia", "validade"])(text);
      if (placa) fields.placa = placa;
      if (data) fields.validade = data;
      return fields;
    },
  },
  {
    type: "Notificação / multa",
    module: "Caminhões – Documentos",
    department: "rh",
    patterns: [/multa\s+de\s+transito/, /notificacao\s+de\s+transito/, /\bait\b.*(?:infracao|transito)?/, /auto\s+de\s+infracao/, /penalidade\s+de\s+transito/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const placa = extractors.plate(text);
      const valor = extractors.money(text);
      const data = extractors.date(text);
      if (placa) fields.placa = placa;
      if (valor) fields.valor = valor;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Licença / certificado",
    module: "Caminhões – Documentos",
    department: "rh",
    patterns: [/\bmopp\b/, /\brntrc\b/, /\bantt\b/, /tacografo/, /certificado\s+de\s+capacitacao/, /registro\s+antt/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = dateAfter(["validade", "vencimento"])(text);
      const numero = findFirst(/(?:n[ºo]|numero|registro)\s*[:.]?\s*([A-Z0-9][A-Z0-9.\/-]{3,20})/i)(text);
      if (data) fields.validade = data;
      if (numero) fields.numero = numero;
      return fields;
    },
  },
  {
    type: "Laudo / relatório",
    module: "Caminhões – Manutenção",
    department: "rh",
    patterns: [/ordem de servico/, /manutencao\s+do\s+veiculo/, /revisao\s+do\s+veiculo/, /nota de servico/, /troca\s+de\s+oleo/, /alinhamento\s+e\s+balanceamento/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const valor = extractors.money(text);
      const data = extractors.date(text);
      const placa = extractors.plate(text);
      if (valor) fields.valor = valor;
      if (data) fields.data = data;
      if (placa) fields.placa = placa;
      return fields;
    },
  },

  // ── LICENÇAS DA EMPRESA ───────────────────────────────────────────────────
  {
    type: "Licença / certificado",
    module: "Licenças da Empresa",
    department: "rh",
    patterns: [
      /alvara/,
      /corpo de bombeiros/,
      /auto de vistoria/,
      /\bavcb\b/,
      /certificado de regularidade/,
      /certidao\s+(?:negativa|positiva)/,
      /\bcnd\b/,
      /certidao\s+conjunta/,
      /certidao\s+de\s+regularidade\s+do\s+fgts/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = dateAfter(["validade", "valid ate"])(text);
      if (data) fields.validade = data;
      return fields;
    },
  },

  // ── LOGÍSTICA / TRANSPORTE ────────────────────────────────────────────────
  {
    type: "Documento de transporte",
    module: "Entregas",
    department: "logistica",
    patterns: [
      /\bct-e\b/,
      /conhecimento de transporte/,
      /\bmdf-e\b/,
      /manifesto eletronico/,
      /ficha de emergencia/,
      /envelope\s+de\s+transporte/,
      /\bdpp\b/,
      /declaracao\s+de\s+carga\s+perigosa/,
      /guia de remessa/,
      /nota fiscal\s+de\s+transporte/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const numero = extractors.number(text);
      const data = extractors.date(text);
      const onuMatch = text.match(/n[ºo]?\s*onu\s*[:.]?\s*(\d{4})\b/i);
      if (numero) fields.numero = numero;
      if (data) fields.data = data;
      if (onuMatch?.[1]) fields.numeroOnu = onuMatch[1];
      return fields;
    },
  },
  {
    type: "Comprovante",
    module: "Entregas",
    department: "logistica",
    patterns: [
      /canhoto/,
      /comprovante de entrega/,
      /recebi.*em\s+(?:bons|perfeitas) condicoes/,
      /romaneio/,
      /devolucao\s+de\s+mercadoria/,
      /ocorrencia\s+de\s+entrega/,
      /avaria\s+em\s+transporte/,
    ],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = extractors.date(text);
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Contrato",
    module: "Entregas",
    department: "logistica",
    patterns: [/contrato de frete/, /contrato\s+com\s+transportadora/, /contrato\s+de\s+transporte\s+de\s+carga/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const fornecedor = extractors.nameAfter(["transportadora", "empresa"])(text);
      const data = extractors.date(text);
      if (fornecedor) fields.fornecedor = fornecedor;
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Laudo / relatório",
    module: "Equipamentos de Transporte",
    department: "logistica",
    patterns: [/paleteira/, /empilhadeira/, /check[- ]?list\s+de\s+equipamento/, /inspecao\s+de\s+equipamento/, /manutencao\s+de\s+(?:paleteira|empilhadeira)/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const data = extractors.date(text);
      if (data) fields.data = data;
      return fields;
    },
  },
  {
    type: "Laudo / relatório",
    module: "Rotas",
    department: "logistica",
    patterns: [/roteirizacao/, /plano\s+de\s+rota/, /mapa\s+de\s+rota/, /relatorio\s+de\s+rotas/, /planejamento\s+de\s+entrega/],
  },

  // ── EMBALAGEM ─────────────────────────────────────────────────────────────
  {
    type: "Rótulo",
    module: "Rótulos",
    department: "embalagem",
    patterns: [/rotulo/, /rotulagem/, /especificacao\s+de\s+rotulo/, /etiqueta\s+de\s+produto/, /arte\s+final\s+de\s+rotulo/],
  },
  {
    type: "Imagem digitalizada",
    module: "Controle de Bombonas",
    department: "embalagem",
    patterns: [/bombona/, /vasilhame/, /controle de embalagem/, /retornavel/],
  },
  {
    type: "Ordem de serviço",
    module: "Controle de Bombonas",
    department: "embalagem",
    patterns: [/ordem de envase/, /ordem de producao/, /apontamento\s+de\s+producao/, /envase\s+de\s+produto/],
    extract: (text) => {
      const fields: ExtractedFields = {};
      const produto = extractors.nameAfter(["produto", "descricao"])(text);
      const data = extractors.date(text);
      if (produto) fields.produto = produto;
      if (data) fields.data = data;
      return fields;
    },
  },

  // ── DOCUMENTOS GERAIS ─────────────────────────────────────────────────────
  {
    type: "Ata de reunião",
    module: "",
    department: "",
    patterns: [/ata de reuniao/, /pauta da reuniao/, /memoria\s+de\s+reuniao/],
  },
  {
    type: "Requerimento / oficial",
    module: "",
    department: "",
    patterns: [/procuracao/, /requerimento/, /oficio\s+(?:n[ºo]|para)/, /correspondencia\s+oficial/],
  },
  {
    type: "Contrato",
    module: "",
    department: "",
    patterns: [/contrato/, /clausula\s+(?:primeira|segunda|terceira)/, /partes\s+contratantes/],
  },
];

const fieldLabels: Record<string, string> = {
  numero: "Número",
  numeroOnu: "Nº ONU",
  valor: "Valor",
  data: "Data",
  vencimento: "Vencimento",
  validade: "Validade",
  competencia: "Competência",
  cnpj: "CNPJ",
  cpf: "CPF",
  placa: "Placa",
  lote: "Lote",
  tipoExame: "Tipo de exame",
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
