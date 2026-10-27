import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { ORCAMENTO_ID, orcamentoNovo } from "../../../../../test/suporte/fabricas";
import { criarClienteDynamoDb } from "../../../../common/aws/clientes-aws";
import { criarEnvelope } from "../../../mensageria/envelope";
import type { PagamentoExterno } from "../../application/ports/gateway-pagamento.port";
import {
	ConflitoConcorrenciaError,
	MensagemJaProcessadaError,
	OrcamentoJaExisteError,
} from "../../application/ports/orcamentos.gateway";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { OrcamentosDynamoDbGateway } from "./orcamentos.dynamodb.gateway";

const TABELA = "tabela-teste";
const ddbMock = mockClient(DynamoDBDocumentClient);

const evento = criarEnvelope({
	tipo: "OrcamentoGerado",
	origem: "billing",
	fluxoId: "3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8",
	osId: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
	numeroOs: "OS-2026-000123",
	correlationId: "req-1",
	payload: { orcamentoId: ORCAMENTO_ID, valorTotalCentavos: 30000 },
});

const itemDoOrcamento = (orcamento = orcamentoNovo()) => {
	const dados = orcamento.paraDados();
	return {
		pk: `ORCAMENTO#${dados.id}`,
		sk: "ORCAMENTO",
		gsi1pk: `STATUS#${dados.status}`,
		gsi1sk: `${dados.criadoEm}#${dados.id}`,
		tipoItem: "ORCAMENTO",
		...dados,
	};
};

const cancelada = (indiceFalho: number, total: number) =>
	new TransactionCanceledException({
		message: "Transaction cancelled",
		$metadata: {},
		CancellationReasons: Array.from({ length: total }, (_, i) => ({ Code: i === indiceFalho ? "ConditionalCheckFailed" : "None" })),
	});

const itensTransacao = () => ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];

describe("OrcamentosDynamoDbGateway", () => {
	const gateway = new OrcamentosDynamoDbGateway(criarClienteDynamoDb());

	beforeEach(() => {
		ddbMock.reset();
		process.env.DYNAMODB_TABLE = TABELA;
	});

	describe("leituras", () => {
		it("buscarPorId lê com consistência forte e remove as chaves técnicas", async () => {
			ddbMock.on(GetCommand).resolves({ Item: itemDoOrcamento() });

			const orcamento = await gateway.buscarPorId(ORCAMENTO_ID);

			expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toEqual({
				TableName: TABELA,
				Key: { pk: `ORCAMENTO#${ORCAMENTO_ID}`, sk: "ORCAMENTO" },
				ConsistentRead: true,
			});
			const dados = orcamento!.paraDados() as unknown as Record<string, unknown>;
			for (const chave of ["pk", "sk", "gsi1pk", "gsi1sk", "tipoItem"]) expect(dados).not.toHaveProperty(chave);
			expect(dados.id).toBe(ORCAMENTO_ID);
		});

		it("buscarPorId sem item devolve null", async () => {
			ddbMock.on(GetCommand).resolves({});
			await expect(gateway.buscarPorId(ORCAMENTO_ID)).resolves.toBeNull();
		});

		it.each([
			["buscarPorNumeroOs", "NUMERO_OS#OS-2026-000123", "OS-2026-000123"],
			["buscarPorOsId", "OS#9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"],
		] as const)("%s segue o ponteiro até o orçamento", async (metodo, pk, valor) => {
			ddbMock.on(GetCommand, { Key: { pk, sk: "ORCAMENTO" } }).resolves({ Item: { orcamentoId: ORCAMENTO_ID } });
			ddbMock.on(GetCommand, { Key: { pk: `ORCAMENTO#${ORCAMENTO_ID}`, sk: "ORCAMENTO" } }).resolves({ Item: itemDoOrcamento() });

			const orcamento = await gateway[metodo](valor);

			expect(orcamento?.id).toBe(ORCAMENTO_ID);
		});

		it.each(["buscarPorNumeroOs", "buscarPorOsId"] as const)("%s sem ponteiro devolve null com uma leitura só", async (metodo) => {
			ddbMock.on(GetCommand).resolves({});
			await expect(gateway[metodo]("x")).resolves.toBeNull();
			expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
		});

		it("listarPorStatus percorre todas as páginas do gsi1", async () => {
			const chave = { pk: "a", sk: "b" };
			ddbMock
				.on(QueryCommand)
				.resolvesOnce({ Items: [itemDoOrcamento()], LastEvaluatedKey: chave })
				.resolvesOnce({ Items: [itemDoOrcamento()] });

			const lista = await gateway.listarPorStatus(StatusOrcamento.APROVADO);

			expect(lista).toHaveLength(2);
			const chamadas = ddbMock.commandCalls(QueryCommand);
			expect(chamadas[0].args[0].input).toMatchObject({
				TableName: TABELA,
				IndexName: "gsi1",
				KeyConditionExpression: "gsi1pk = :pk",
				ExpressionAttributeValues: { ":pk": "STATUS#APROVADO" },
			});
			expect(chamadas[1].args[0].input.ExclusiveStartKey).toEqual(chave);
		});

		it("listarPorStatus sem itens devolve lista vazia", async () => {
			ddbMock.on(QueryCommand).resolves({});
			await expect(gateway.listarPorStatus(StatusOrcamento.PAGO)).resolves.toEqual([]);
		});

		it("mensagemJaProcessada e notificacaoJaProcessada consultam os itens de dedupe", async () => {
			ddbMock.on(GetCommand, { Key: { pk: "MSG#m1", sk: "MSG" } }).resolves({ Item: { pk: "MSG#m1" } });
			ddbMock.on(GetCommand, { Key: { pk: "WEBHOOK#123#approved", sk: "WEBHOOK" } }).resolves({});

			await expect(gateway.mensagemJaProcessada("m1")).resolves.toBe(true);
			await expect(gateway.notificacaoJaProcessada("123#approved")).resolves.toBe(false);
		});
	});

	describe("criar", () => {
		it("grava dedupe, orçamento, ponteiros, condição do fluxo cancelado e evento na mesma transação", async () => {
			ddbMock.on(TransactWriteCommand).resolves({});
			const orcamento = orcamentoNovo();
			const dados = orcamento.paraDados();

			await gateway.criar(orcamento, { mensagemProcessada: "m1", eventos: [evento] });

			const itens = itensTransacao();
			expect(itens).toHaveLength(6);
			expect(itens[0].Put).toMatchObject({
				TableName: TABELA,
				Item: { pk: "MSG#m1", sk: "MSG" },
				ConditionExpression: "attribute_not_exists(pk)",
			});
			expect(itens[1].Put).toMatchObject({
				Item: {
					pk: `ORCAMENTO#${dados.id}`,
					sk: "ORCAMENTO",
					gsi1pk: "STATUS#AGUARDANDO_APROVACAO",
					gsi1sk: `${dados.criadoEm}#${dados.id}`,
				},
				ConditionExpression: "attribute_not_exists(pk)",
			});
			expect(itens[2].Put).toMatchObject({ Item: { pk: `OS#${dados.osId}`, sk: "ORCAMENTO", orcamentoId: dados.id } });
			expect(itens[3].Put).toMatchObject({ Item: { pk: `NUMERO_OS#${dados.numeroOs}`, sk: "ORCAMENTO", orcamentoId: dados.id } });
			expect(itens[4].ConditionCheck).toEqual({
				TableName: TABELA,
				Key: { pk: `FLUXO_CANCELADO#${dados.fluxoId}`, sk: "FLUXO" },
				ConditionExpression: "attribute_not_exists(pk)",
			});
			expect(itens[5].Put).toMatchObject({
				Item: { pk: `EVENTO#${evento.messageId}`, sk: "EVENTO", eventoPendente: true, gsi1pk: "EVENTO_PENDENTE", envelope: evento },
				ConditionExpression: "attribute_not_exists(pk)",
			});
		});

		it.each([
			[0, MensagemJaProcessadaError],
			[1, OrcamentoJaExisteError],
			[2, OrcamentoJaExisteError],
			[3, OrcamentoJaExisteError],
			[4, ConflitoConcorrenciaError],
		])("falha no item %i vira %p", async (indice, tipoErro) => {
			ddbMock.on(TransactWriteCommand).rejects(cancelada(indice, 6));
			await expect(gateway.criar(orcamentoNovo(), { mensagemProcessada: "m1", eventos: [evento] })).rejects.toBeInstanceOf(tipoErro);
		});

		it("dedupe falho identifica a mensagem", async () => {
			ddbMock.on(TransactWriteCommand).rejects(cancelada(0, 6));
			await expect(gateway.criar(orcamentoNovo(), { mensagemProcessada: "m1", eventos: [evento] })).rejects.toMatchObject({
				chave: "m1",
			});
		});

		it("sem CancellationReasons e com MSG# gravado → mensagem já processada", async () => {
			ddbMock.on(TransactWriteCommand).rejects(new TransactionCanceledException({ message: "x", $metadata: {} }));
			ddbMock.on(GetCommand, { Key: { pk: "MSG#m1", sk: "MSG" } }).resolves({ Item: { pk: "MSG#m1" } });
			await expect(gateway.criar(orcamentoNovo(), { mensagemProcessada: "m1", eventos: [] })).rejects.toBeInstanceOf(
				MensagemJaProcessadaError,
			);
		});

		it("sem CancellationReasons e sem dedupe gravado → orçamento já existe", async () => {
			ddbMock.on(TransactWriteCommand).rejects(new TransactionCanceledException({ message: "x", $metadata: {} }));
			ddbMock.on(GetCommand).resolves({});
			await expect(gateway.criar(orcamentoNovo(), { mensagemProcessada: "m1", eventos: [] })).rejects.toBeInstanceOf(
				OrcamentoJaExisteError,
			);
		});

		it("erro que não é cancelamento de transação é propagado", async () => {
			const erro = Object.assign(new Error("lento"), { name: "ProvisionedThroughputExceededException" });
			ddbMock.on(TransactWriteCommand).rejects(erro);
			await expect(gateway.criar(orcamentoNovo(), { eventos: [] })).rejects.toBe(erro);
		});

		it("CancellationReasons sem ConditionalCheckFailed devolve o próprio erro", async () => {
			const erro = new TransactionCanceledException({
				message: "x",
				$metadata: {},
				CancellationReasons: [{ Code: "TransactionConflict" }],
			});
			ddbMock.on(TransactWriteCommand).rejects(erro);
			await expect(gateway.criar(orcamentoNovo(), { eventos: [] })).rejects.toBe(erro);
		});
	});

	describe("atualizar", () => {
		it("Put condicional na versão anterior com o gsi do novo status", async () => {
			ddbMock.on(TransactWriteCommand).resolves({});
			const aprovado = orcamentoNovo().aprovar(
				{ linkPagamento: "https://x", preferenciaId: "p" },
				new Date(Date.now() + 60_000),
				new Date(),
			);

			await gateway.atualizar(aprovado, 1, { eventos: [evento] });

			const itens = itensTransacao();
			expect(itens).toHaveLength(2);
			expect(itens[0].Put).toMatchObject({
				Item: { pk: `ORCAMENTO#${aprovado.id}`, gsi1pk: "STATUS#APROVADO", versao: 2 },
				ConditionExpression: "versao = :versaoAnterior",
				ExpressionAttributeValues: { ":versaoAnterior": 1 },
			});
		});

		it("falha no item do orçamento → conflito de concorrência", async () => {
			ddbMock.on(TransactWriteCommand).rejects(cancelada(1, 3));
			await expect(gateway.atualizar(orcamentoNovo(), 1, { mensagemProcessada: "m1", eventos: [evento] })).rejects.toBeInstanceOf(
				ConflitoConcorrenciaError,
			);
		});

		it("sem CancellationReasons e sem dedupe gravado → conflito de concorrência", async () => {
			ddbMock.on(TransactWriteCommand).rejects(new TransactionCanceledException({ message: "x", $metadata: {} }));
			ddbMock.on(GetCommand).resolves({});
			await expect(gateway.atualizar(orcamentoNovo(), 1, { mensagemProcessada: "m1", eventos: [] })).rejects.toBeInstanceOf(
				ConflitoConcorrenciaError,
			);
		});
	});

	describe("cancelamento antecipado", () => {
		const cancelamento = { fluxoId: "f-1", osId: "os-1", motivo: "PRAZO_RESPOSTA_SERVICO", canceladoEm: "2026-10-20T13:05:00.000Z" };

		it("grava FLUXO_CANCELADO# condicionado à OS ainda não ter orçamento", async () => {
			ddbMock.on(TransactWriteCommand).resolves({});

			await gateway.registrarCancelamentoAntecipado(cancelamento, { mensagemProcessada: "m1", eventos: [evento] });

			const itens = itensTransacao();
			expect(itens).toHaveLength(4);
			expect(itens[1].Put?.Item).toMatchObject({
				pk: "FLUXO_CANCELADO#f-1",
				sk: "FLUXO",
				osId: "os-1",
				motivo: "PRAZO_RESPOSTA_SERVICO",
			});
			expect(itens[2].ConditionCheck).toMatchObject({
				Key: { pk: "OS#os-1", sk: "ORCAMENTO" },
				ConditionExpression: "attribute_not_exists(pk)",
			});
		});

		it("OS que ganhou orçamento no meio do caminho → conflito", async () => {
			ddbMock.on(TransactWriteCommand).rejects(cancelada(2, 4));
			await expect(
				gateway.registrarCancelamentoAntecipado(cancelamento, { mensagemProcessada: "m1", eventos: [evento] }),
			).rejects.toBeInstanceOf(ConflitoConcorrenciaError);
		});

		it("buscarCancelamentoAntecipado devolve o registro ou null", async () => {
			ddbMock
				.on(GetCommand, { Key: { pk: "FLUXO_CANCELADO#f-1", sk: "FLUXO" } })
				.resolves({ Item: { pk: "FLUXO_CANCELADO#f-1", ...cancelamento } });
			ddbMock.on(GetCommand, { Key: { pk: "FLUXO_CANCELADO#f-2", sk: "FLUXO" } }).resolves({});

			await expect(gateway.buscarCancelamentoAntecipado("f-1")).resolves.toEqual(cancelamento);
			await expect(gateway.buscarCancelamentoAntecipado("f-2")).resolves.toBeNull();
		});
	});

	describe("registrarEfeitos", () => {
		const pagamento: PagamentoExterno = {
			pagamentoId: "123",
			status: "approved",
			orcamentoId: ORCAMENTO_ID,
			valorCentavos: 30000,
			pagoEm: "2026-10-20T14:00:00.000Z",
			bruto: { id: 123 },
		};

		it("grava dedupe de notificação e pagamento", async () => {
			ddbMock.on(TransactWriteCommand).resolves({});

			await gateway.registrarEfeitos({ notificacaoProcessada: "123#approved", pagamentos: [pagamento], eventos: [] });

			const itens = itensTransacao();
			expect(itens).toHaveLength(2);
			expect(itens[0].Put?.Item).toMatchObject({ pk: "WEBHOOK#123#approved", sk: "WEBHOOK" });
			expect(itens[1].Put?.Item).toMatchObject({
				pk: `ORCAMENTO#${ORCAMENTO_ID}`,
				sk: "PAGAMENTO#123",
				tipoItem: "PAGAMENTO",
				status: "approved",
			});
		});

		it("sem nada para gravar não chama o DynamoDB", async () => {
			await gateway.registrarEfeitos({ eventos: [] });
			expect(ddbMock.calls()).toHaveLength(0);
		});

		it("notificação repetida → já processada; sem razões relê o WEBHOOK#", async () => {
			ddbMock
				.on(TransactWriteCommand)
				.rejectsOnce(cancelada(0, 2))
				.rejectsOnce(new TransactionCanceledException({ message: "x", $metadata: {} }));
			ddbMock
				.on(GetCommand, { Key: { pk: "WEBHOOK#123#approved", sk: "WEBHOOK" } })
				.resolves({ Item: { pk: "WEBHOOK#123#approved" } });

			const efeitos = { notificacaoProcessada: "123#approved", pagamentos: [pagamento], eventos: [] };
			await expect(gateway.registrarEfeitos(efeitos)).rejects.toMatchObject({ chave: "123#approved" });
			await expect(gateway.registrarEfeitos(efeitos)).rejects.toBeInstanceOf(MensagemJaProcessadaError);
		});

		it("falha em item que não é dedupe → conflito", async () => {
			ddbMock.on(TransactWriteCommand).rejects(cancelada(1, 2));
			await expect(
				gateway.registrarEfeitos({ notificacaoProcessada: "123#approved", pagamentos: [pagamento], eventos: [] }),
			).rejects.toBeInstanceOf(ConflitoConcorrenciaError);
		});
	});

	describe("outbox", () => {
		it("listarEventosPendentes consulta o índice esparso até o limite de tempo", async () => {
			ddbMock.on(QueryCommand).resolves({ Items: [{ envelope: evento }] });

			const pendentes = await gateway.listarEventosPendentes(new Date("2026-10-20T13:05:10Z"), 50);

			expect(pendentes).toEqual([evento]);
			expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toEqual({
				TableName: TABELA,
				IndexName: "gsi1",
				KeyConditionExpression: "gsi1pk = :p AND gsi1sk < :limite",
				ExpressionAttributeValues: { ":p": "EVENTO_PENDENTE", ":limite": "2026-10-20T13:05:10.000Z" },
				Limit: 50,
			});
		});

		it("listarEventosPendentes sem itens devolve lista vazia", async () => {
			ddbMock.on(QueryCommand).resolves({});
			await expect(gateway.listarEventosPendentes(new Date(), 10)).resolves.toEqual([]);
		});

		it("marcarEventoPublicado tira o evento do índice", async () => {
			ddbMock.on(UpdateCommand).resolves({});

			await gateway.marcarEventoPublicado("m9");

			expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
				TableName: TABELA,
				Key: { pk: "EVENTO#m9", sk: "EVENTO" },
				UpdateExpression: "SET eventoPendente = :falso, publicadoEm = :agora REMOVE gsi1pk, gsi1sk",
				ConditionExpression: "attribute_exists(pk)",
				ExpressionAttributeValues: { ":falso": false, ":agora": expect.any(String) },
			});
		});
	});

	it("sem DYNAMODB_TABLE qualquer operação falha", async () => {
		delete process.env.DYNAMODB_TABLE;
		await expect(gateway.buscarPorId(ORCAMENTO_ID)).rejects.toThrow("DYNAMODB_TABLE não definido");
	});
});
