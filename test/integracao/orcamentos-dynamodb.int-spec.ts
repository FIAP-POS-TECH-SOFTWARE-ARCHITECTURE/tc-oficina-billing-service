import { DynamoDBDocumentClient, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { criarClienteDynamoDb } from "../../src/common/aws/clientes-aws";
import { criarEnvelope } from "../../src/modules/mensageria/envelope";
import { OrcamentosDynamoDbGateway } from "../../src/modules/orcamentos/adapters/gateways/orcamentos.dynamodb.gateway";
import {
	ConflitoConcorrenciaError,
	MensagemJaProcessadaError,
	OrcamentoJaExisteError,
} from "../../src/modules/orcamentos/application/ports/orcamentos.gateway";
import { StatusOrcamento } from "../../src/modules/orcamentos/domain/status-orcamento";
import { configurarAmbienteAws, iniciarMiniStack, type MiniStackIniciado } from "../helpers/ministack";
import { criarRecursosBilling } from "../helpers/recursos-aws";
import { orcamentoNovo } from "../suporte/fabricas";

const COBRANCA = { linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" };

/** Orçamento de uma OS nova (ids próprios) para os casos não interferirem entre si. */
const orcamentoDeOsNova = () => {
	const sufixo = randomUUID();
	return orcamentoNovo({ id: randomUUID(), osId: randomUUID(), fluxoId: randomUUID(), numeroOs: `OS-INT-${sufixo.slice(0, 8)}` });
};

const eventoDe = (osId: string) =>
	criarEnvelope({
		tipo: "OrcamentoGerado",
		origem: "billing",
		fluxoId: randomUUID(),
		osId,
		numeroOs: "OS-X",
		correlationId: "req-int",
		payload: { orcamentoId: randomUUID(), valorTotalCentavos: 30000 },
	});

describe("OrcamentosDynamoDbGateway contra o emulador", () => {
	let ministack: MiniStackIniciado;
	let db: DynamoDBDocumentClient;
	let gateway: OrcamentosDynamoDbGateway;

	beforeAll(async () => {
		ministack = await iniciarMiniStack();
		configurarAmbienteAws(ministack.endpoint);
		await criarRecursosBilling("oficina-int");
		db = criarClienteDynamoDb();
		gateway = new OrcamentosDynamoDbGateway(db);
	});

	afterAll(async () => {
		db?.destroy();
		await ministack?.container.stop();
	});

	it("transação com condição falha é cancelada inteira (registro do comportamento do emulador)", async () => {
		const TableName = process.env.DYNAMODB_TABLE!;
		const pk = `TESTE#${randomUUID()}`;
		await db.send(new PutCommand({ TableName, Item: { pk, sk: "X" } }));

		const erro = await db
			.send(
				new TransactWriteCommand({
					TransactItems: [
						{ Put: { TableName, Item: { pk: `${pk}-novo`, sk: "X" } } },
						{ Put: { TableName, Item: { pk, sk: "X" }, ConditionExpression: "attribute_not_exists(pk)" } },
					],
				}),
			)
			.then(
				() => null,
				(e: unknown) => e as { name?: string; CancellationReasons?: { Code?: string }[] },
			);

		expect(erro?.name).toBe("TransactionCanceledException");
		console.info(`CancellationReasons do emulador: ${JSON.stringify(erro?.CancellationReasons ?? null)}`);
	});

	it("criar grava orçamento, ponteiros e evento pendente", async () => {
		const orcamento = orcamentoDeOsNova();
		const evento = eventoDe(orcamento.osId);

		await gateway.criar(orcamento, { mensagemProcessada: randomUUID(), eventos: [evento] });

		const porId = await gateway.buscarPorId(orcamento.id);
		expect(porId?.paraDados()).toEqual(orcamento.paraDados());
		expect((await gateway.buscarPorOsId(orcamento.osId))?.paraDados()).toEqual(orcamento.paraDados());
		expect((await gateway.buscarPorNumeroOs(orcamento.numeroOs))?.paraDados()).toEqual(orcamento.paraDados());
		const pendentes = await gateway.listarEventosPendentes(new Date(Date.now() + 60_000), 50);
		expect(pendentes.map((e) => e.messageId)).toContain(evento.messageId);
	});

	it("mesmo messageId é duplicata; outro messageId para a mesma OS é orçamento existente", async () => {
		const orcamento = orcamentoDeOsNova();
		const messageId = randomUUID();
		await gateway.criar(orcamento, { mensagemProcessada: messageId, eventos: [] });

		await expect(gateway.criar(orcamento, { mensagemProcessada: messageId, eventos: [] })).rejects.toBeInstanceOf(
			MensagemJaProcessadaError,
		);
		const outro = orcamentoNovo({ id: randomUUID(), osId: orcamento.osId, fluxoId: orcamento.fluxoId, numeroOs: orcamento.numeroOs });
		await expect(gateway.criar(outro, { mensagemProcessada: randomUUID(), eventos: [] })).rejects.toBeInstanceOf(
			OrcamentoJaExisteError,
		);

		const aguardando = await gateway.listarPorStatus(StatusOrcamento.AGUARDANDO_APROVACAO);
		expect(aguardando.filter((o) => o.osId === orcamento.osId)).toHaveLength(1);
	});

	it("atualizar exige a versão lida e move o orçamento no índice de status", async () => {
		const orcamento = orcamentoDeOsNova();
		await gateway.criar(orcamento, { eventos: [] });
		const aprovado = orcamento.aprovar(COBRANCA, new Date(Date.now() + 3_600_000), new Date());

		await expect(gateway.atualizar(aprovado, 7, { eventos: [] })).rejects.toBeInstanceOf(ConflitoConcorrenciaError);
		await gateway.atualizar(aprovado, orcamento.versao, { eventos: [] });

		const aprovados = await gateway.listarPorStatus(StatusOrcamento.APROVADO);
		const aguardando = await gateway.listarPorStatus(StatusOrcamento.AGUARDANDO_APROVACAO);
		expect(aprovados.map((o) => o.id)).toContain(orcamento.id);
		expect(aguardando.map((o) => o.id)).not.toContain(orcamento.id);
	});

	it("cancelamento antecipado e criação do mesmo fluxo se excluem", async () => {
		const comOrcamento = orcamentoDeOsNova();
		await gateway.criar(comOrcamento, { eventos: [] });
		const cancelamento = (o: typeof comOrcamento) => ({
			fluxoId: o.fluxoId,
			osId: o.osId,
			motivo: "PRAZO",
			canceladoEm: new Date().toISOString(),
		});

		await expect(gateway.registrarCancelamentoAntecipado(cancelamento(comOrcamento), { eventos: [] })).rejects.toBeInstanceOf(
			ConflitoConcorrenciaError,
		);

		const semOrcamento = orcamentoDeOsNova();
		await gateway.registrarCancelamentoAntecipado(cancelamento(semOrcamento), { eventos: [] });
		await expect(gateway.buscarCancelamentoAntecipado(semOrcamento.fluxoId)).resolves.toMatchObject({ osId: semOrcamento.osId });
		await expect(gateway.criar(semOrcamento, { eventos: [] })).rejects.toBeInstanceOf(ConflitoConcorrenciaError);
	});

	it("marcarEventoPublicado tira o evento da lista de pendentes", async () => {
		const evento = eventoDe(randomUUID());
		await gateway.registrarEfeitos({ eventos: [evento] });
		const pendentes = () => gateway.listarEventosPendentes(new Date(Date.now() + 60_000), 100);
		expect((await pendentes()).map((e) => e.messageId)).toContain(evento.messageId);

		await gateway.marcarEventoPublicado(evento.messageId);

		expect((await pendentes()).map((e) => e.messageId)).not.toContain(evento.messageId);
	});
});
