import { SNSClient } from "@aws-sdk/client-sns";
import { GetQueueAttributesCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configurarApp } from "../../src/app.setup";
import { SnsSqsPublicador } from "../../src/modules/mensageria/sns-sqs-publicador";
import { GatewayPagamentoSimulado } from "../../src/modules/orcamentos/adapters/gateways/gateway-pagamento.simulado";
import { GATEWAY_PAGAMENTO } from "../../src/modules/orcamentos/application/ports/gateway-pagamento.port";
import { configurarAmbienteAws, iniciarMiniStack, type MiniStackIniciado } from "../helpers/ministack";
import { ColetorEventos, criarRecursosBilling, type EventoRecebido, type RecursosBilling } from "../helpers/recursos-aws";
import { CLIENTE_ID, comandoComMotivo, comandoGerarOrcamento } from "../suporte/fabricas";

const SEGREDO = "segredo-integracao";

/** Ids próprios por caso: cada OS tem fluxo, número e mensagens independentes. */
const novaOs = () => {
	const id = randomUUID();
	return { osId: id, fluxoId: randomUUID(), numeroOs: `OS-INT-${id.slice(0, 8)}` };
};

describe("billing consumindo comandos do orquestrador pelo emulador", () => {
	let ministack: MiniStackIniciado;
	let recursos: RecursosBilling;
	let app: INestApplication;
	let sqs: SQSClient;
	let sns: SNSClient;
	let publicador: SnsSqsPublicador;
	let coletor: ColetorEventos;
	let tokenCliente: string;
	let tokenAtendente: string;

	const doTipo = (tipo: string, osId: string) => (e: EventoRecebido) => e.envelope.tipo === tipo && e.envelope.osId === osId;

	beforeAll(async () => {
		ministack = await iniciarMiniStack();
		configurarAmbienteAws(ministack.endpoint);
		recursos = await criarRecursosBilling("oficina-int");
		process.env.JWT_SECRET = SEGREDO;
		delete process.env.WORKERS_HABILITADOS;

		const modulo = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(GATEWAY_PAGAMENTO)
			.useClass(GatewayPagamentoSimulado)
			.compile();
		app = modulo.createNestApplication();
		configurarApp(app);
		await app.init();

		sqs = new SQSClient({});
		sns = new SNSClient({});
		publicador = new SnsSqsPublicador(sns, sqs);
		coletor = new ColetorEventos(sqs, recursos.filaOrquestradorUrl);
		const jwt = new JwtService({ secret: SEGREDO });
		tokenCliente = await jwt.signAsync({ sub: CLIENTE_ID, nome: "Maria Souza", cpf: "52998224725", type: "cliente" });
		tokenAtendente = await jwt.signAsync({ sub: randomUUID(), email: "atendente@oficina.local", role: "ATENDENTE" });
	});

	afterAll(async () => {
		await app?.close();
		sqs?.destroy();
		sns?.destroy();
		await ministack?.container.stop();
	});

	describe("geração e aprovação", () => {
		const os = novaOs();
		const gerar = comandoGerarOrcamento({ ...os, correlationId: "req-int-1" });

		it("GerarOrcamento → OrcamentoGerado na fila do orquestrador com tipo, origem e correlationId", async () => {
			await publicador.enviarComando(recursos.filaComandosUrl, gerar);

			const gerado = await coletor.aguardar(doTipo("OrcamentoGerado", os.osId), 30_000);

			expect(gerado.atributos).toMatchObject({ tipo: "OrcamentoGerado", origem: "billing" });
			expect(gerado.envelope).toMatchObject({
				correlationId: "req-int-1",
				fluxoId: os.fluxoId,
				payload: { valorTotalCentavos: 30000 },
			});
		});

		it("reenvio do mesmo comando não gera segundo evento", async () => {
			await publicador.enviarComando(recursos.filaComandosUrl, gerar);
			await coletor.nenhumEm(doTipo("OrcamentoGerado", os.osId), 8_000);
		});

		it("cliente dono aprova, recebe o link e a oficina vê o orçamento aprovado", async () => {
			const resposta = await request(app.getHttpServer())
				.post(`/billing/cliente/orcamentos/${os.numeroOs}/aprovar`)
				.set("authorization", `Bearer ${tokenCliente}`)
				.expect(200);
			expect(resposta.body.data.linkPagamento).toMatch(/^https:\/\/pagamento\.simulado\.local\/checkout\//);

			const aprovado = await coletor.aguardar(doTipo("OrcamentoAprovado", os.osId));
			expect(aprovado.envelope.payload.linkPagamento).toBe(resposta.body.data.linkPagamento);

			const lista = await request(app.getHttpServer())
				.get("/billing/orcamentos?status=APROVADO")
				.set("authorization", `Bearer ${tokenAtendente}`)
				.expect(200);
			expect(lista.body.data.map((o: { numeroOs: string }) => o.numeroOs)).toContain(os.numeroOs);
		});
	});

	it("orçamento cancelado pelo orquestrador não pode mais ser aprovado", async () => {
		const os = novaOs();
		await publicador.enviarComando(recursos.filaComandosUrl, comandoGerarOrcamento(os));
		await coletor.aguardar(doTipo("OrcamentoGerado", os.osId), 30_000);

		await publicador.enviarComando(recursos.filaComandosUrl, comandoComMotivo("CancelarOrcamento", "PRAZO_APROVACAO_EXPIRADO", os));
		const cancelado = await coletor.aguardar(doTipo("OrcamentoCancelado", os.osId), 30_000);
		expect(cancelado.envelope.payload.orcamentoId).not.toBeNull();

		await request(app.getHttpServer())
			.post(`/billing/cliente/orcamentos/${os.numeroOs}/aprovar`)
			.set("authorization", `Bearer ${tokenCliente}`)
			.expect(422);
	});

	it("cancelamento antes da geração: nada é criado e o cancelamento é reemitido", async () => {
		const os = novaOs();
		await publicador.enviarComando(recursos.filaComandosUrl, comandoComMotivo("CancelarOrcamento", "PRAZO_RESPOSTA_SERVICO", os));
		const antecipado = await coletor.aguardar(doTipo("OrcamentoCancelado", os.osId), 30_000);
		expect(antecipado.envelope.payload).toEqual({ orcamentoId: null, motivo: "PRAZO_RESPOSTA_SERVICO" });

		await publicador.enviarComando(recursos.filaComandosUrl, comandoGerarOrcamento(os));
		const reemitido = await coletor.aguardar(
			(e) => doTipo("OrcamentoCancelado", os.osId)(e) && e.envelope.messageId !== antecipado.envelope.messageId,
			30_000,
		);
		expect(reemitido.envelope.payload).toEqual({ orcamentoId: null, motivo: "PRAZO_RESPOSTA_SERVICO" });

		await request(app.getHttpServer())
			.get(`/billing/orcamentos/${os.numeroOs}`)
			.set("authorization", `Bearer ${tokenAtendente}`)
			.expect(404);
	});

	it("mensagem fora do contrato não gera evento e vai para a DLQ após 5 recebimentos", async () => {
		const os = novaOs();
		const invalido = { ...comandoGerarOrcamento(os), payload: {} };
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: recursos.filaComandosUrl,
				MessageBody: JSON.stringify(invalido),
				MessageAttributes: {
					tipo: { DataType: "String", StringValue: "GerarOrcamento" },
					origem: { DataType: "String", StringValue: "os" },
				},
			}),
		);

		const limite = Date.now() + 60_000;
		let naDlq = 0;
		while (Date.now() < limite && naDlq < 1) {
			await esperar(2_000);
			const r = await sqs.send(
				new GetQueueAttributesCommand({ QueueUrl: recursos.dlqComandosUrl, AttributeNames: ["ApproximateNumberOfMessages"] }),
			);
			naDlq = Number(r.Attributes?.ApproximateNumberOfMessages ?? 0);
		}

		expect(naDlq).toBe(1);
		await coletor.nenhumEm((e) => e.envelope.osId === os.osId, 2_000);
	});
});
