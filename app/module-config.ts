export type FieldConfig = {
  key: string;
  label: string;
  type: "text" | "date" | "number" | "select";
  placeholder?: string;
  options?: string[];
  samples: string[];
  required: boolean;
};
export type ModuleConfig = {
  singular: string;
  titleLabel: string;
  descriptionLabel: string;
  statuses: { value: string; label: string }[];
  fields: FieldConfig[];
  samples: string[];
  kpis: [string, string, string];
  guidance: string;
};

const f = (
  key: string,
  label: string,
  type: FieldConfig["type"],
  samples: string[],
  options?: string[],
): FieldConfig => ({
  key,
  label,
  type,
  samples,
  options,
  required: true,
  placeholder: `Informe ${label.toLowerCase()}`,
});
const standard = [
  { value: "active", label: "Ativo" },
  { value: "pending", label: "Pendente" },
  { value: "completed", label: "Concluído" },
  { value: "archived", label: "Arquivado" },
];
const workflow = (labels: string[]) =>
  labels.map((label, i) => ({
    value:
      ["draft", "review", "approved", "completed", "cancelled"][i] ??
      `step_${i}`,
    label,
  }));

export const moduleConfigs: Record<string, ModuleConfig> = {
  Funcionários: {
    singular: "funcionário",
    titleLabel: "Nome completo",
    descriptionLabel: "Observações e informações contratuais",
    statuses: [
      { value: "active", label: "Ativo" },
      { value: "vacation", label: "Em férias" },
      { value: "leave", label: "Afastado" },
      { value: "archived", label: "Desligado" },
    ],
    fields: [
      f("role", "Cargo", "text", [
        "Motorista",
        "Auxiliar de produção",
        "Analista financeiro",
      ]),
      f(
        "department",
        "Setor",
        "select",
        ["Logística", "Embalagem", "Financeiro"],
        ["RH", "Logística", "Embalagem", "Vendas", "Compras", "Financeiro"],
      ),
      f("admissionDate", "Data de admissão", "date", [
        "2023-04-10",
        "2024-02-19",
        "2022-08-01",
      ]),
      f(
        "contractType",
        "Contrato",
        "select",
        ["CLT", "CLT", "PJ"],
        ["CLT", "PJ", "Temporário", "Estágio"],
      ),
    ],
    samples: [
      "Carlos Henrique Souza",
      "Aline Ferreira Lima",
      "Marcos Paulo Alves",
    ],
    kpis: ["Colaboradores", "Afastamentos", "Admissões no mês"],
    guidance:
      "Acompanhe vínculo, função, documentos e histórico do colaborador.",
  },
  EPI: {
    singular: "entrega de EPI",
    titleLabel: "Colaborador",
    descriptionLabel: "Observações da entrega",
    statuses: [
      { value: "pending", label: "Aguardando assinatura" },
      { value: "active", label: "Entregue" },
      { value: "completed", label: "Assinado" },
      { value: "expired", label: "Vencido" },
    ],
    fields: [
      f("equipment", "EPI entregue", "text", [
        "Luva nitrílica",
        "Respirador semifacial",
        "Óculos de proteção",
      ]),
      f("ca", "Número do CA", "text", ["CA 39012", "CA 41132", "CA 18072"]),
      f("deliveryDate", "Data de entrega", "date", [
        "2026-08-18",
        "2026-08-20",
        "2026-08-22",
      ]),
      f("quantity", "Quantidade", "number", ["2", "1", "1"]),
    ],
    samples: [
      "João Batista — Luvas",
      "Renata Moura — Respirador",
      "Paulo Reis — Óculos",
    ],
    kpis: ["Entregas no mês", "Sem assinatura", "Reposições próximas"],
    guidance:
      "Registre entrega, Certificado de Aprovação e aceite do colaborador.",
  },
  Uniformes: {
    singular: "entrega de uniforme",
    titleLabel: "Colaborador",
    descriptionLabel: "Observações de uso ou reposição",
    statuses: [
      { value: "active", label: "Entregue" },
      { value: "pending", label: "Reposição solicitada" },
      { value: "review", label: "Em conferência" },
      { value: "completed", label: "Devolvido" },
    ],
    fields: [
      f(
        "item",
        "Peça",
        "select",
        ["Calça operacional", "Camisa manga longa", "Bota de segurança"],
        ["Camisa", "Calça", "Jaleco", "Bota", "Jaqueta"],
      ),
      f(
        "size",
        "Tamanho",
        "select",
        ["42", "M", "41"],
        ["PP", "P", "M", "G", "GG", "XGG", "38", "40", "41", "42", "43", "44"],
      ),
      f("deliveryDate", "Data de entrega", "date", [
        "2026-08-02",
        "2026-08-12",
        "2026-08-16",
      ]),
      f("quantity", "Quantidade", "number", ["2", "3", "1"]),
    ],
    samples: [
      "André Luiz — Kit operacional",
      "Marta Silva — Camisas",
      "Diego Ramos — Bota",
    ],
    kpis: ["Itens entregues", "Reposições", "Custo no mês"],
    guidance: "Controle tamanhos, entregas, devoluções e ciclos de reposição.",
  },
  "Caminhões – Documentos": {
    singular: "documento de veículo",
    titleLabel: "Veículo / placa",
    descriptionLabel: "Observações do documento",
    statuses: [
      { value: "active", label: "Válido" },
      { value: "pending", label: "A vencer" },
      { value: "expired", label: "Vencido" },
      { value: "review", label: "Em renovação" },
    ],
    fields: [
      f(
        "documentType",
        "Documento",
        "select",
        ["CRLV", "Seguro", "Licenciamento"],
        ["CRLV", "Seguro", "Licenciamento", "ANTT", "Tacógrafo"],
      ),
      f("plate", "Placa", "text", ["ABC-1D23", "EFG-4H56", "IJK-7L89"]),
      f("expiryDate", "Validade", "date", [
        "2027-02-28",
        "2026-09-12",
        "2026-11-30",
      ]),
      f("insurer", "Órgão / seguradora", "text", [
        "DETRAN-SP",
        "Porto Seguro",
        "DETRAN-SP",
      ]),
    ],
    samples: [
      "Volvo VM 270 — ABC-1D23",
      "Mercedes Atego — EFG-4H56",
      "VW Delivery — IJK-7L89",
    ],
    kpis: ["Veículos regulares", "A vencer em 30 dias", "Documentos vencidos"],
    guidance: "Centralize CRLV, seguro, licenciamento e alertas de validade.",
  },
  "Caminhões – Manutenção": {
    singular: "ordem de manutenção",
    titleLabel: "Veículo / serviço",
    descriptionLabel: "Diagnóstico e serviço realizado",
    statuses: [
      { value: "pending", label: "Agendada" },
      { value: "active", label: "Em manutenção" },
      { value: "completed", label: "Concluída" },
      { value: "cancelled", label: "Cancelada" },
    ],
    fields: [
      f("plate", "Placa", "text", ["ABC-1D23", "EFG-4H56", "IJK-7L89"]),
      f(
        "serviceType",
        "Tipo de manutenção",
        "select",
        ["Preventiva", "Corretiva", "Preventiva"],
        ["Preventiva", "Corretiva", "Inspeção", "Pneus"],
      ),
      f("mileage", "Quilometragem", "number", ["128450", "96320", "74110"]),
      f("supplier", "Oficina", "text", [
        "Diesel Center",
        "Oficina São Jorge",
        "Truck Service",
      ]),
    ],
    samples: [
      "ABC-1D23 — Revisão de 130 mil km",
      "EFG-4H56 — Sistema de freios",
      "IJK-7L89 — Troca de óleo",
    ],
    kpis: ["Manutenções no mês", "Veículos parados", "Custo acumulado"],
    guidance:
      "Acompanhe agenda, quilometragem, oficina, custos e notas do serviço.",
  },
  "Licenças da Empresa": {
    singular: "licença",
    titleLabel: "Nome da licença",
    descriptionLabel: "Exigências, condicionantes e observações",
    statuses: [
      { value: "active", label: "Vigente" },
      { value: "pending", label: "A vencer" },
      { value: "review", label: "Em renovação" },
      { value: "expired", label: "Vencida" },
    ],
    fields: [
      f(
        "licenseType",
        "Tipo",
        "select",
        ["Licença ambiental", "Alvará de funcionamento", "SIPROQUIM"],
        [
          "Alvará",
          "Licença ambiental",
          "SIPROQUIM",
          "AVCB",
          "Vigilância Sanitária",
        ],
      ),
      f("agency", "Órgão emissor", "text", [
        "CETESB",
        "Prefeitura Municipal",
        "Polícia Federal",
      ]),
      f("number", "Número", "text", ["LA-2024/0812", "ALV-98231", "SPQ-55391"]),
      f("expiryDate", "Validade", "date", [
        "2026-09-05",
        "2027-01-20",
        "2026-12-15",
      ]),
    ],
    samples: [
      "Licença Ambiental de Operação",
      "Alvará de Funcionamento",
      "Certificado SIPROQUIM",
    ],
    kpis: ["Licenças vigentes", "A vencer", "Em renovação"],
    guidance:
      "Monitore validades, protocolos, órgãos emissores e condicionantes legais.",
  },
  "Recrutamento e Seleção": {
    singular: "candidato",
    titleLabel: "Candidato / vaga",
    descriptionLabel: "Parecer e observações da seleção",
    statuses: workflow([
      "Triagem",
      "Entrevista",
      "Aprovado",
      "Contratado",
      "Reprovado",
    ]),
    fields: [
      f("position", "Vaga", "text", [
        "Motorista categoria D",
        "Auxiliar de produção",
        "Consultor comercial",
      ]),
      f(
        "source",
        "Origem",
        "select",
        ["Indicação", "LinkedIn", "Banco de talentos"],
        ["Indicação", "LinkedIn", "Indeed", "Banco de talentos", "Agência"],
      ),
      f("interviewDate", "Entrevista", "date", [
        "2026-09-02",
        "2026-09-04",
        "2026-09-05",
      ]),
      f("salaryExpectation", "Pretensão salarial", "number", [
        "4200",
        "2400",
        "3800",
      ]),
    ],
    samples: [
      "Roberto Lima — Motorista",
      "Juliana Costa — Auxiliar",
      "Thiago Martins — Comercial",
    ],
    kpis: ["Candidatos ativos", "Entrevistas agendadas", "Vagas abertas"],
    guidance:
      "Conduza candidatos por triagem, entrevistas, avaliação e contratação.",
  },
  Rotas: {
    singular: "rota",
    titleLabel: "Identificação da rota",
    descriptionLabel: "Paradas, restrições e instruções",
    statuses: [
      { value: "draft", label: "Planejada" },
      { value: "active", label: "Em andamento" },
      { value: "completed", label: "Concluída" },
      { value: "cancelled", label: "Cancelada" },
    ],
    fields: [
      f("driver", "Motorista", "text", [
        "Carlos Henrique",
        "Roberto Lima",
        "João Batista",
      ]),
      f("vehicle", "Veículo / placa", "text", [
        "ABC-1D23",
        "EFG-4H56",
        "IJK-7L89",
      ]),
      f("destination", "Destino principal", "text", [
        "Campinas - SP",
        "Sorocaba - SP",
        "São José dos Campos - SP",
      ]),
      f("departureDate", "Saída prevista", "date", [
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
      ]),
    ],
    samples: [
      "Rota 284 — Campinas",
      "Rota 285 — Sorocaba",
      "Rota 286 — Vale do Paraíba",
    ],
    kpis: ["Rotas programadas", "Em trânsito", "Km planejados"],
    guidance:
      "Organize motorista, veículo, destinos, sequência de paradas e horários.",
  },
  Entregas: {
    singular: "entrega",
    titleLabel: "Cliente / pedido",
    descriptionLabel: "Ocorrências e instruções da entrega",
    statuses: [
      { value: "pending", label: "Aguardando saída" },
      { value: "active", label: "Em rota" },
      { value: "completed", label: "Entregue" },
      { value: "failed", label: "Ocorrência" },
    ],
    fields: [
      f("order", "Pedido", "text", ["PED-9821", "PED-9825", "PED-9830"]),
      f("customer", "Cliente", "text", [
        "Indústria Norte Ltda.",
        "Química Brasil S.A.",
        "Grupo Horizonte",
      ]),
      f("driver", "Motorista", "text", [
        "Carlos Henrique",
        "Roberto Lima",
        "João Batista",
      ]),
      f("deliveryDate", "Previsão de entrega", "date", [
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
      ]),
    ],
    samples: [
      "Indústria Norte — PED-9821",
      "Química Brasil — PED-9825",
      "Grupo Horizonte — PED-9830",
    ],
    kpis: ["Entregas hoje", "No prazo", "Com ocorrência"],
    guidance:
      "Acompanhe saída, localização, canhoto, comprovante e ocorrências.",
  },
  "Equipamentos de Transporte": {
    singular: "equipamento",
    titleLabel: "Equipamento / patrimônio",
    descriptionLabel: "Condição e histórico operacional",
    statuses: [
      { value: "active", label: "Disponível" },
      { value: "in_use", label: "Em uso" },
      { value: "pending", label: "Em manutenção" },
      { value: "archived", label: "Baixado" },
    ],
    fields: [
      f(
        "equipmentType",
        "Tipo",
        "select",
        ["Bomba pneumática", "Paleteira manual", "Carrinho plataforma"],
        ["Carrinho", "Bomba", "Paleteira", "Empilhadeira"],
      ),
      f("assetTag", "Patrimônio", "text", ["PAT-0032", "PAT-0048", "PAT-0061"]),
      f("location", "Localização", "text", [
        "Caminhão 03",
        "Expedição",
        "Armazém B",
      ]),
      f("lastMaintenance", "Última manutenção", "date", [
        "2026-07-10",
        "2026-06-22",
        "2026-08-03",
      ]),
    ],
    samples: [
      "Bomba pneumática — PAT-0032",
      "Paleteira — PAT-0048",
      "Carrinho — PAT-0061",
    ],
    kpis: ["Equipamentos ativos", "Em manutenção", "Inspeções próximas"],
    guidance:
      "Controle patrimônio, disponibilidade, localização e manutenção preventiva.",
  },
  Rótulos: {
    singular: "rótulo",
    titleLabel: "Produto / versão",
    descriptionLabel: "Instruções e observações da arte",
    statuses: workflow([
      "Rascunho",
      "Em revisão",
      "Aprovado",
      "Publicado",
      "Cancelado",
    ]),
    fields: [
      f("product", "Produto", "text", [
        "Hipoclorito 12%",
        "Ácido muriático",
        "Detergente alcalino",
      ]),
      f("version", "Versão", "text", ["v4.2", "v2.1", "v1.8"]),
      f(
        "packageSize",
        "Embalagem",
        "select",
        ["Bombona 50 L", "Bombona 20 L", "Galão 5 L"],
        ["Galão 5 L", "Bombona 20 L", "Bombona 50 L", "IBC 1.000 L"],
      ),
      f("responsible", "Responsável técnico", "text", [
        "Dra. Ana Rocha",
        "Dr. Lucas Mendes",
        "Dra. Ana Rocha",
      ]),
    ],
    samples: [
      "Hipoclorito 12% — v4.2",
      "Ácido Muriático — v2.1",
      "Detergente Alcalino — v1.8",
    ],
    kpis: ["Artes vigentes", "Em aprovação", "Revisões necessárias"],
    guidance:
      "Gerencie versões, embalagens, textos legais e aprovação das artes.",
  },
  "Controle de Bombonas": {
    singular: "movimentação de bombona",
    titleLabel: "Lote / movimentação",
    descriptionLabel: "Origem, destino e observações",
    statuses: [
      { value: "active", label: "Em estoque" },
      { value: "in_use", label: "Em uso" },
      { value: "pending", label: "Aguardando retorno" },
      { value: "completed", label: "Retornada" },
    ],
    fields: [
      f(
        "containerType",
        "Tipo / capacidade",
        "select",
        ["Bombona 50 L", "Bombona 20 L", "IBC 1.000 L"],
        ["Bombona 20 L", "Bombona 50 L", "Tambor 200 L", "IBC 1.000 L"],
      ),
      f("batch", "Lote", "text", ["BOM-2608-14", "BOM-2608-19", "IBC-2608-03"]),
      f("quantity", "Quantidade", "number", ["48", "120", "6"]),
      f("location", "Localização / cliente", "text", [
        "Armazém A",
        "Cliente Alfa",
        "Pátio externo",
      ]),
    ],
    samples: [
      "Lote BOM-2608-14",
      "Saída para Cliente Alfa",
      "Retorno IBC-2608-03",
    ],
    kpis: ["Em estoque", "Com clientes", "Aguardando retorno"],
    guidance:
      "Rastreie entradas, saídas, retornos, lotes e saldo por capacidade.",
  },
  "Estoque de Embalagem": {
    singular: "item de embalagem",
    titleLabel: "Material",
    descriptionLabel: "Especificação e observações de consumo",
    statuses: [
      { value: "active", label: "Estoque normal" },
      { value: "pending", label: "Estoque baixo" },
      { value: "critical", label: "Crítico" },
      { value: "archived", label: "Inativo" },
    ],
    fields: [
      f("sku", "Código / SKU", "text", [
        "EMB-B50-AZ",
        "EMB-TAM-50",
        "EMB-ROT-HIP",
      ]),
      f(
        "unit",
        "Unidade",
        "select",
        ["un", "un", "milheiro"],
        ["un", "kg", "rolo", "milheiro"],
      ),
      f("stock", "Saldo atual", "number", ["326", "510", "18"]),
      f("minimumStock", "Estoque mínimo", "number", ["150", "200", "20"]),
    ],
    samples: [
      "Bombona azul 50 L",
      "Tampa lacre 50 L",
      "Rótulo Hipoclorito 12%",
    ],
    kpis: ["Itens controlados", "Abaixo do mínimo", "Valor em estoque"],
    guidance:
      "Acompanhe saldo, consumo, estoque mínimo e necessidade de compra.",
  },
  Clientes: {
    singular: "cliente",
    titleLabel: "Razão social / nome",
    descriptionLabel: "Perfil, histórico e observações comerciais",
    statuses: [
      { value: "active", label: "Ativo" },
      { value: "prospect", label: "Prospect" },
      { value: "pending", label: "Inadimplente" },
      { value: "archived", label: "Inativo" },
    ],
    fields: [
      f("document", "CNPJ / CPF", "text", [
        "12.345.678/0001-90",
        "98.765.432/0001-10",
        "45.321.987/0001-55",
      ]),
      f(
        "segment",
        "Segmento",
        "select",
        ["Indústria", "Distribuidor", "Agronegócio"],
        ["Indústria", "Distribuidor", "Varejo", "Agronegócio", "Serviços"],
      ),
      f("contact", "Contato principal", "text", [
        "Mariana — Compras",
        "Eduardo — Diretor",
        "Rafael — Suprimentos",
      ]),
      f("city", "Cidade / UF", "text", [
        "Campinas / SP",
        "Sorocaba / SP",
        "Goiânia / GO",
      ]),
    ],
    samples: [
      "Indústria Norte Ltda.",
      "Química Brasil S.A.",
      "Grupo Horizonte",
    ],
    kpis: ["Clientes ativos", "Novos no mês", "Com pendência"],
    guidance:
      "Centralize cadastro, contatos, histórico comercial e situação do relacionamento.",
  },
  "Propostas e Orçamentos": {
    singular: "proposta",
    titleLabel: "Cliente / proposta",
    descriptionLabel: "Escopo, condições e observações da negociação",
    statuses: [
      { value: "draft", label: "Rascunho" },
      { value: "review", label: "Em negociação" },
      { value: "approved", label: "Aprovada" },
      { value: "cancelled", label: "Perdida" },
    ],
    fields: [
      f("customer", "Cliente", "text", [
        "Grupo Horizonte",
        "Indústria Norte",
        "Rede Branca",
      ]),
      f("proposalNumber", "Número", "text", [
        "PROP-0348",
        "PROP-0351",
        "PROP-0354",
      ]),
      f("value", "Valor (R$)", "number", ["42500", "18750", "96300"]),
      f("validUntil", "Validade", "date", [
        "2026-09-15",
        "2026-09-18",
        "2026-09-22",
      ]),
    ],
    samples: [
      "Grupo Horizonte — PROP-0348",
      "Indústria Norte — PROP-0351",
      "Rede Branca — PROP-0354",
    ],
    kpis: ["Pipeline aberto", "Taxa de conversão", "Aprovações no mês"],
    guidance:
      "Gerencie versões, valores, validade, etapa comercial e decisão do cliente.",
  },
  "Pesquisa de Satisfação": {
    singular: "resposta de satisfação",
    titleLabel: "Cliente / pesquisa",
    descriptionLabel: "Comentário e plano de ação",
    statuses: [
      { value: "pending", label: "Aguardando resposta" },
      { value: "active", label: "Respondida" },
      { value: "review", label: "Requer retorno" },
      { value: "completed", label: "Tratada" },
    ],
    fields: [
      f("customer", "Cliente", "text", [
        "Indústria Norte",
        "Química Brasil",
        "Grupo Horizonte",
      ]),
      f("score", "Nota NPS", "number", ["10", "7", "4"]),
      f("surveyDate", "Data da pesquisa", "date", [
        "2026-08-20",
        "2026-08-21",
        "2026-08-22",
      ]),
      f("contact", "Respondente", "text", [
        "Mariana Lopes",
        "Eduardo Souza",
        "Rafael Dias",
      ]),
    ],
    samples: [
      "Indústria Norte — Pós-entrega",
      "Química Brasil — Atendimento",
      "Grupo Horizonte — Qualidade",
    ],
    kpis: ["NPS atual", "Respostas no mês", "Retornos pendentes"],
    guidance:
      "Meça NPS, registre comentários e acompanhe tratativas de insatisfação.",
  },
  Fornecedores: {
    singular: "fornecedor",
    titleLabel: "Razão social",
    descriptionLabel: "Escopo de fornecimento e observações",
    statuses: [
      { value: "active", label: "Homologado" },
      { value: "review", label: "Em avaliação" },
      { value: "pending", label: "Documentação pendente" },
      { value: "archived", label: "Bloqueado" },
    ],
    fields: [
      f("document", "CNPJ", "text", [
        "11.222.333/0001-44",
        "55.666.777/0001-88",
        "22.333.444/0001-99",
      ]),
      f(
        "category",
        "Categoria",
        "select",
        ["Embalagens", "Manutenção", "Matéria-prima"],
        ["Matéria-prima", "Embalagens", "Logística", "Serviços", "Manutenção"],
      ),
      f("contact", "Contato", "text", [
        "Sandra — Comercial",
        "Paulo — Oficina",
        "Luiz — Vendas",
      ]),
      f("rating", "Avaliação (0-5)", "number", ["4.8", "4.2", "4.5"]),
    ],
    samples: [
      "Embalagens São Paulo",
      "Diesel Center Serviços",
      "Química Sul Insumos",
    ],
    kpis: ["Homologados", "Em avaliação", "Nota média"],
    guidance:
      "Controle homologação, categorias, documentos, desempenho e contatos.",
  },
  "Pedidos de Compra": {
    singular: "pedido de compra",
    titleLabel: "Fornecedor / pedido",
    descriptionLabel: "Justificativa, condições e observações",
    statuses: [
      { value: "draft", label: "Solicitado" },
      { value: "review", label: "Em aprovação" },
      { value: "approved", label: "Aprovado" },
      { value: "completed", label: "Recebido" },
      { value: "cancelled", label: "Cancelado" },
    ],
    fields: [
      f("supplier", "Fornecedor", "text", [
        "Embalagens São Paulo",
        "Química Sul",
        "Diesel Center",
      ]),
      f("orderNumber", "Número do pedido", "text", [
        "PC-002184",
        "PC-002190",
        "PC-002193",
      ]),
      f("value", "Valor (R$)", "number", ["7890", "24800", "4350"]),
      f("expectedDate", "Entrega prevista", "date", [
        "2026-09-06",
        "2026-09-10",
        "2026-09-04",
      ]),
    ],
    samples: [
      "Embalagens SP — PC-002184",
      "Química Sul — PC-002190",
      "Diesel Center — PC-002193",
    ],
    kpis: ["Pedidos abertos", "Aguardando aprovação", "Compras no mês"],
    guidance:
      "Acompanhe solicitação, aprovação, fornecedor, valor e recebimento.",
  },
  "Notas Fiscais de Entrada": {
    singular: "nota fiscal de entrada",
    titleLabel: "Fornecedor / nota",
    descriptionLabel: "Itens, divergências e observações fiscais",
    statuses: [
      { value: "pending", label: "Aguardando conferência" },
      { value: "review", label: "Com divergência" },
      { value: "approved", label: "Conferida" },
      { value: "completed", label: "Lançada" },
    ],
    fields: [
      f("supplier", "Fornecedor", "text", [
        "Embalagens São Paulo",
        "Química Sul",
        "Diesel Center",
      ]),
      f("invoiceNumber", "Número da NF", "text", [
        "NF 18273",
        "NF 92881",
        "NFS 4812",
      ]),
      f("value", "Valor (R$)", "number", ["7890", "24800", "4350"]),
      f("issueDate", "Emissão", "date", [
        "2026-08-26",
        "2026-08-27",
        "2026-08-28",
      ]),
    ],
    samples: [
      "Embalagens SP — NF 18273",
      "Química Sul — NF 92881",
      "Diesel Center — NFS 4812",
    ],
    kpis: ["Notas no mês", "A conferir", "Com divergência"],
    guidance:
      "Confira fornecedor, valores, pedido vinculado, tributos e recebimento.",
  },
  "Notas Fiscais de Saída": {
    singular: "nota fiscal de saída",
    titleLabel: "Cliente / nota",
    descriptionLabel: "Produtos, transporte e observações fiscais",
    statuses: [
      { value: "draft", label: "Em digitação" },
      { value: "approved", label: "Autorizada" },
      { value: "completed", label: "Entregue" },
      { value: "cancelled", label: "Cancelada" },
    ],
    fields: [
      f("customer", "Cliente", "text", [
        "Indústria Norte",
        "Química Brasil",
        "Grupo Horizonte",
      ]),
      f("invoiceNumber", "Número da NF", "text", [
        "NF-008741",
        "NF-008746",
        "NF-008752",
      ]),
      f("value", "Valor (R$)", "number", ["18420", "32780", "12950"]),
      f("issueDate", "Emissão", "date", [
        "2026-08-26",
        "2026-08-27",
        "2026-08-28",
      ]),
    ],
    samples: [
      "Indústria Norte — NF-008741",
      "Química Brasil — NF-008746",
      "Grupo Horizonte — NF-008752",
    ],
    kpis: ["Faturado no mês", "Notas emitidas", "Cancelamentos"],
    guidance:
      "Acompanhe emissão, autorização, cliente, valores e vínculo com entrega.",
  },
  "Boletos e Recebimentos": {
    singular: "título a receber",
    titleLabel: "Cliente / título",
    descriptionLabel: "Condições, cobrança e observações",
    statuses: [
      { value: "pending", label: "Em aberto" },
      { value: "overdue", label: "Em atraso" },
      { value: "completed", label: "Recebido" },
      { value: "review", label: "Em negociação" },
    ],
    fields: [
      f("customer", "Cliente", "text", [
        "Indústria Norte",
        "Química Brasil",
        "Grupo Horizonte",
      ]),
      f("documentNumber", "Documento", "text", [
        "BOL-98411",
        "BOL-98422",
        "PIX-8841",
      ]),
      f("value", "Valor (R$)", "number", ["18420", "32780", "12950"]),
      f(
        "paymentMethod",
        "Forma de pagamento",
        "select",
        ["Boleto", "Boleto", "PIX"],
        ["Boleto", "PIX", "Transferência", "Cartão"],
      ),
    ],
    samples: [
      "Indústria Norte — BOL-98411",
      "Química Brasil — BOL-98422",
      "Grupo Horizonte — PIX-8841",
    ],
    kpis: ["A receber", "Em atraso", "Recebido no mês"],
    guidance: "Controle vencimentos, baixas, atrasos, cobranças e conciliação.",
  },
  "Contas a Pagar": {
    singular: "conta a pagar",
    titleLabel: "Fornecedor / despesa",
    descriptionLabel: "Centro de custo, justificativa e observações",
    statuses: [
      { value: "review", label: "Aguardando aprovação" },
      { value: "pending", label: "Agendada" },
      { value: "completed", label: "Paga" },
      { value: "overdue", label: "Em atraso" },
    ],
    fields: [
      f("supplier", "Fornecedor / favorecido", "text", [
        "Química Sul",
        "Energia Paulista",
        "Diesel Center",
      ]),
      f("documentNumber", "Documento", "text", [
        "NF 92881",
        "FAT 2608-11",
        "NFS 4812",
      ]),
      f("value", "Valor (R$)", "number", ["24800", "9820", "4350"]),
      f(
        "costCenter",
        "Centro de custo",
        "select",
        ["Produção", "Administrativo", "Frota"],
        ["Produção", "Administrativo", "Frota", "Comercial", "Logística"],
      ),
    ],
    samples: [
      "Química Sul — Matéria-prima",
      "Energia Paulista — Agosto",
      "Diesel Center — Manutenção",
    ],
    kpis: ["A pagar", "Vence esta semana", "Aguardando aprovação"],
    guidance:
      "Organize fornecedor, vencimento, centro de custo, aprovação e pagamento.",
  },
  "DRE e Relatórios": {
    singular: "relatório gerencial",
    titleLabel: "Período / relatório",
    descriptionLabel: "Análise, premissas e comentários executivos",
    statuses: [
      { value: "draft", label: "Em preparação" },
      { value: "review", label: "Em revisão" },
      { value: "approved", label: "Fechado" },
      { value: "archived", label: "Arquivado" },
    ],
    fields: [
      f("period", "Competência", "text", [
        "Agosto/2026",
        "Julho/2026",
        "2º trimestre/2026",
      ]),
      f("revenue", "Receita (R$)", "number", ["487250", "433500", "1298800"]),
      f("expenses", "Despesas (R$)", "number", ["366900", "339200", "978400"]),
      f("margin", "Margem (%)", "number", ["24.7", "21.8", "24.6"]),
    ],
    samples: [
      "DRE — Agosto/2026",
      "DRE — Julho/2026",
      "Análise — 2º trimestre",
    ],
    kpis: ["Receita líquida", "Margem operacional", "Resultado do período"],
    guidance:
      "Consolide receitas, custos, despesas, margens e comentários da gestão.",
  },
};

export function getModuleConfig(name: string): ModuleConfig {
  return (
    moduleConfigs[name] ?? {
      singular: "registro",
      titleLabel: "Título",
      descriptionLabel: "Descrição e observações",
      statuses: standard,
      fields: [],
      samples: [
        `Controle — ${name}`,
        `Revisão — ${name}`,
        `Acompanhamento — ${name}`,
      ],
      kpis: ["Registros", "Pendentes", "Concluídos"],
      guidance: "Consulte e atualize as informações deste módulo.",
    }
  );
}
