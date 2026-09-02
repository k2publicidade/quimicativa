#!/usr/bin/env node
// Testes do classificador de documentos (app/document-classifier.ts).
// Compila o .ts na hora com esbuild e roda 53 casos reais do fluxo da distribuidora.
// Uso: node scripts/classifier-test.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, ".tmp-test");
mkdirSync(tmp, { recursive: true });
const built = path.join(tmp, "classifier.mjs");

// Compila app/document-classifier.ts -> .mjs (ESM para import fácil)
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "esbuild", "bin", "esbuild"),
    path.join(root, "app", "document-classifier.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${built}`,
    "--log-level=error",
  ],
  { stdio: "inherit" },
);

const { classifyDocument } = await import(`file://${built}`);

// [nome, texto, departamento esperado, módulo esperado]
const cases = [
  // Fiscal / notas
  ['NF ENTRADA', 'DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA\nN 000.123.456\nFORNECEDOR: QUIMICLORO INDUSTRIA QUIMICA LTDA\nCNPJ: 12.345.678/0001-90\nVALOR TOTAL R$ 1.234,56\nDATA EMISSAO 20/08/2026', 'compras', 'Notas Fiscais de Entrada'],
  ['NF SAIDA', 'NOTA FISCAL DE SAIDA\nDANFE\nCLIENTE: SUPERMERCADO BOM PRECO\nVALOR R$ 5.000,00\nDATA 01/09/2026', 'financeiro', 'Notas Fiscais de Saída'],
  // Financeiro
  ['BOLETO', 'BOLETO DE COBRANCA\nVENCIMENTO 15/10/2026\nVALOR DO DOCUMENTO R$ 890,12', 'financeiro', 'Boletos e Recebimentos'],
  ['DUPLICATA', 'DUPLICATA MERCANTIL\nN 00045\nVENCIMENTO 30/11/2026\nVALOR R$ 2.300,00', 'financeiro', 'Boletos e Recebimentos'],
  ['PIX', 'COMPROVANTE DE TRANSFERENCIA\nPIX\nVALOR R$ 150,00\nDATA 25/08/2026', 'financeiro', 'Contas a Pagar'],
  ['DARF', 'DARF - DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS\nPERIODO 08/2026\nVALOR R$ 3.400,00\nVENCIMENTO 20/09/2026', 'financeiro', 'Contas a Pagar'],
  ['DAS', 'DAS - SIMPLES NACIONAL\nVALOR TOTAL R$ 1.890,45\nVENCIMENTO 20/08/2026', 'financeiro', 'Contas a Pagar'],
  ['EXTRATO', 'EXTRATO BANCARIO\nCONTA CORRENTE 12345-6\nPERIODO 01/08/2026 A 31/08/2026', 'financeiro', 'DRE e Relatórios'],
  ['IR', 'DECLARACAO DE AJUSTE ANUAL\nIMPOSTO DE RENDA PESSOA FISICA', 'financeiro', 'DRE e Relatórios'],
  ['SEGURO VEICULO', 'APOLICE DE SEGURO DO VEICULO\nPLACA ABC1D23\nVIGENCIA 01/01/2027\nPREMI0 R$ 2.400,00', 'rh', 'Caminhões – Documentos'],
  ['FINANCIAMENTO', 'CONTRATO DE FINANCIAMENTO DE VEICULO\nVALOR R$ 85.000,00\nVENCIMENTO 10/10/2026', 'financeiro', 'Contas a Pagar'],
  // Vendas
  ['ORCAMENTO', 'ORCAMENTO PARA CLIENTE: SUPERMERCADO BOM PRECO\nVALOR TOTAL R$ 5.432,10\nVALIDADE DA PROPOSTA 30 DIAS', 'vendas', 'Propostas e Orçamentos'],
  ['FICHA CLIENTE', 'FICHA CADASTRAL DE CLIENTE\nEMPRESA: COMERCIAL LIMA LTDA\nCNPJ: 98.765.432/0001-10', 'vendas', 'Clientes'],
  ['CONTRATO COMERCIAL', 'CONTRATO DE REPRESENTACAO COMERCIAL\nCONTRATANTE: QUIMICATIVA DISTRIBUIDORA', 'vendas', 'Clientes'],
  // Compras
  ['PEDIDO', 'PEDIDO DE COMPRA N 9876\nFORNECEDOR: QUIMICLORO\nCOTACAO 45', 'compras', 'Pedidos de Compra'],
  ['CADASTRO FORNECEDOR', 'CADASTRO DE FORNECEDOR\nRAZAO SOCIAL: QUIMICLORO INDUSTRIA\nCNPJ: 12.345.678/0001-90', 'compras', 'Fornecedores'],
  // Produtos / compliance químico
  ['FISPQ', 'FISPQ - FICHA DE INFORMACOES DE SEGURANCA\nNOME DO PRODUTO: SODA CAUSTICA 50%\nNUMERO ONU: 1823\nSECAO 1: IDENTIFICACAO', 'produtos', 'FISPQ'],
  ['COA', 'CERTIFICADO DE ANALISE\nPRODUTO: ACIDO CITRICO ANIDRO\nLOTE: L-2026-045\nDATA 15/08/2026', 'produtos', 'Produtos'],
  ['CONTROLADO', 'REQUERIMENTO DE COMPRA DE PRODUTO CONTROLADO\nPOLICIA FEDERAL\nPRODUTO: ACIDO CLORIDRICO\nN 2026.0042', 'produtos', 'Produtos'],
  ['LICENCA AMBIENTAL', 'LICENCA AMBIENTAL - INEA\nNUMERO INEA-2026-0042\nVALIDADE 15/09/2027', 'produtos', 'Licenças'],
  ['ANVISA', 'REGISTRO DE SANEANTE - ANVISA\nNUMERO 3.1234.5678\nVALIDADE 10/10/2028', 'produtos', 'Licenças'],
  // RH
  ['CONTRATO TRABALHO', 'CONTRATO DE TRABALHO\nEMPREGADO: JOAO DA SILVA\nCPF: 123.456.789-00\nCTPS 123456', 'rh', 'Funcionários'],
  ['ASO', 'ASO - ATESTADO DE SAUDE OCUPACIONAL\nEXAME ADMISSIONAL\nCOLABORADOR: MARIA SOUZA\nDATA 12/08/2026', 'rh', 'Funcionários'],
  ['HOLERITE', 'HOLERITE\nFUNCIONARIO: CARLOS LIMA\nCOMPETENCIA 08/2026\nSALARIO LIQUIDO R$ 3.450,00', 'rh', 'Funcionários'],
  ['TRCT', 'TERMO DE RESCISAO DO CONTRATO DE TRABALHO - TRCT\nFUNCIONARIO: ANA PEREIRA\nVALOR LIQUIDO R$ 5.200,00', 'rh', 'Funcionários'],
  ['CURRICULO', 'CURRICULO\nEXPERIENCIA PROFISSIONAL\nFORMACAO ACADEMICA\nPRETENSAO SALARIAL', 'rh', 'Recrutamento e Seleção'],
  ['PONTO', 'REGISTRO DE PONTO\nFUNCIONARIO: JOAO DA SILVA\nJORNADA 08:00-17:00', 'rh', 'Funcionários'],
  ['NR20', 'CERTIFICADO DE TREINAMENTO NR-20\nLISTA DE PRESENCA\nCURSO DE INFLAMAVEIS', 'rh', 'Funcionários'],
  ['PGR', 'PGR - PROGRAMA DE GERENCIAMENTO DE RISCOS\nLT CAT\nLAUDO TECNICO DAS CONDICOES AMBIENTAIS', 'rh', 'Funcionários'],
  ['EPI', 'TERMO DE ENTREGA DE EPI\nEQUIPAMENTO DE PROTECAO INDIVIDUAL\nLUVA NITRILICA\nCOLABORADOR: MARIA SOUZA', 'rh', 'EPI'],
  ['UNIFORME', 'ENTREGA DE UNIFORME\nCOLABORADOR: CARLOS LIMA', 'rh', 'Uniformes'],
  // Frota
  ['CRLV', 'CRLV DIGITAL\nPLACA ABC1D23\nRENAVAM 12345678901\nLICENCIAMENTO 2026', 'rh', 'Caminhões – Documentos'],
  ['MULTA', 'NOTIFICACAO DE TRANSITO - AUTO DE INFRACAO\nPLACA ABC1D23\nVALOR R$ 293,47\nDATA 10/08/2026', 'rh', 'Caminhões – Documentos'],
  ['MOPP', 'CERTIFICADO DE CURSO MOPP\nANTT\nREGISTRO 123456789\nVALIDADE 20/09/2027', 'rh', 'Caminhões – Documentos'],
  ['OS MANUTENCAO', 'ORDEM DE SERVICO - MANUTENCAO DO VEICULO\nPLACA ABC1D23\nTROCA DE OLEO\nVALOR R$ 480,00', 'rh', 'Caminhões – Manutenção'],
  // Logística
  ['CTE', 'CT-E - CONHECIMENTO DE TRANSPORTE ELETRONICO\nMDF-E\nNOTA FISCAL DE TRANSPORTE\nN 000789', 'logistica', 'Entregas'],
  ['FICHA EMERGENCIA', 'FICHA DE EMERGENCIA\nENVELOPE DE TRANSPORTE\nDDP - DECLARACAO DE CARGA PERIGOSA\nONU 1823', 'logistica', 'Entregas'],
  ['CANHOTO', 'CANHOTO DE ENTREGA\nROMANEIO 88\nRECEBI EM BONS CONDICOES\nDATA 22/08/2026', 'logistica', 'Entregas'],
  ['PALETEIRA', 'CHECK-LIST DE EQUIPAMENTO\nEMPILHADEIRA 02\nINSPECAO DE EQUIPAMENTO', 'logistica', 'Equipamentos de Transporte'],
  // Embalagem
  ['ROTULO', 'ESPECIFICACAO DE ROTULO\nROTULAGEM DO PRODUTO\nARTE FINAL', 'embalagem', 'Rótulos'],
  ['BOMBONA', 'CONTROLE DE BOMBONAS\nVASILHAME RETORNAVEL\nCONTROLE DE EMBALAGEM', 'embalagem', 'Controle de Bombonas'],
  ['ENVASE', 'ORDEM DE ENVASE\nPRODUTO: HIPOCLORITO DE SODIO\nENVASE DE PRODUTO\nDATA 18/08/2026', 'embalagem', 'Controle de Bombonas'],
  // Gerais
  ['ATA', 'ATA DE REUNIAO\nPAUTA DA REUNIAO\nMEMORIA DE REUNIAO', '', ''],
  ['PROCURACAO', 'PROCURACAO\nREQUERIMENTO\nOFICIO', '', ''],
  ['DESCONHECIDO', 'texto aleatorio sem padroes conhecidos aqui', '', ''],
  // Novos grupos do fluxo real
  ['FICHA EMERGENCIA', 'FICHA DE EMERGENCIA\nPRODUTO: HIPOCLORITO DE SODIO\nNUMERO ONU: 1791\nENVELOPE DE TRANSPORTE\nDDP', 'logistica', 'Entregas'],
  ['LAUDO PRODUTO', 'LAUDO TECNICO DO PRODUTO\nPRODUTO: SODA CAUSTICA 50%\nLOTE L-2026-088\nDATA 10/08/2026', 'produtos', 'Produtos'],
  ['CONTA CORRENTE', 'CONTA CHEQUE\nCONTA CORRENTE 12345-6\nSALDO DA CONTA R$ 25.400,00\nLANCAMENTOS EM CONTA', 'financeiro', 'DRE e Relatórios'],
  ['CONTA LUZ', 'CONTA DE LUZ\nCOMPANHIA DE ENERGIA ELETRICA\nFATURA DE ENERGIA\nVENCIMENTO 10/09/2026\nVALOR R$ 1.234,56', 'financeiro', 'Contas a Pagar'],
  ['CONTA AGUA', 'CONTA DE AGUA\nABASTECIMENTO DE AGUA\nFATURA DE CONSUMO\nVENCIMENTO 15/09/2026\nVALOR R$ 456,78', 'financeiro', 'Contas a Pagar'],
  ['CTPS', 'CARTEIRA DE TRABALHO - CTPS\nNOME: JOAO DA SILVA\nNUMERO 1234567\nCPF: 123.456.789-00', 'rh', 'Funcionários'],
  ['CNH', 'CARTEIRA NACIONAL DE HABILITACAO - CNH\nMOTORISTA: CARLOS LIMA\nREGISTRO 09876543210\nVALIDADE 20/09/2028', 'rh', 'Funcionários'],
  ['IDENTIDADE', 'CARTEIRA DE IDENTIDADE\nNOME: MARIA SOUZA\nREGISTRO GERAL 12.345.678-9\nCPF: 111.222.333-44', 'rh', 'Funcionários'],
];

let pass = 0,
  fail = 0;
for (const [name, text, expDept, expModule] of cases) {
  const c = classifyDocument(text, "");
  const ok = c.department === expDept && c.module === expModule;
  if (ok) pass++;
  else {
    fail++;
    console.log(
      `FAIL ${name.padEnd(22)} -> ${c.confidence.padEnd(6)} ${(c.department || "-").padEnd(10)} ${(c.module || "-").padEnd(26)} ${c.documentType.padEnd(26)} | esperado: ${expDept || "-"}/${expModule || "-"} | campos: ${JSON.stringify(c.fields)}`,
    );
  }
}
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
