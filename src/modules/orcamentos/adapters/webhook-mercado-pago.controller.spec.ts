import type { INestApplication } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configurarApp } from "../../../app.setup";
import { ErroGatewayPagamento } from "../application/ports/gateway-pagamento.port";
import { ConflitoConcorrenciaError } from "../application/ports/orcamentos.gateway";
import { ProcessarNotificacaoPagamentoUseCase } from "../application/use-cases/processar-notificacao-pagamento.use-case";
import { gerarAssinaturaMercadoPago } from "./webhook/assinatura-mercado-pago";
import { WebhookMercadoPagoController } from "./webhook-mercado-pago.controller";

const ID = "ORD01ABC123";
const REQUEST_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const URL = "/billing/webhooks/mercado-pago";

// Corpo no formato da doc de notificações de orders, com campos que não declaramos.
const corpo = {
	action: "order.processed",
	api_version: "v1",
	application_id: "123",
	date_created: "2026-10-20T14:00:00.000Z",
	live_mode: false,
	type: "order",
	user_id: "456",
	data: {
		id: ID,
		external_reference: "o1",
		status: "processed",
		status_detail: "accredited",
		total_paid_amount: "300.00",
		transactions: { payments: [{ id: "PAY01", amount: "300.00", status: "processed" }] },
		type: "online",
		version: 3,
	},
	extra: { qualquer: "coisa" },
};

const assinatura = (dataId = ID, segredo = "segredo") =>
	gerarAssinaturaMercadoPago({ dataId, requestId: REQUEST_ID, segredo, ts: String(Date.now()) });

describe("WebhookMercadoPagoController", () => {
	let app: INestApplication;
	const processar = { execute: jest.fn() };
	const segredoOriginal = process.env.MERCADO_PAGO_WEBHOOK_SECRET;

	beforeAll(async () => {
		process.env.MERCADO_PAGO_WEBHOOK_SECRET = "segredo";
		const modulo = await Test.createTestingModule({
			imports: [JwtModule.register({ secret: "s" })],
			controllers: [WebhookMercadoPagoController],
			providers: [{ provide: ProcessarNotificacaoPagamentoUseCase, useValue: processar }],
		}).compile();
		app = modulo.createNestApplication({ logger: false });
		configurarApp(app);
		await app.init();
	});

	afterAll(async () => {
		await app.close();
		if (segredoOriginal === undefined) delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
		else process.env.MERCADO_PAGO_WEBHOOK_SECRET = segredoOriginal;
	});

	beforeEach(() => {
		processar.execute.mockReset();
		processar.execute.mockResolvedValue("CONFIRMADO");
	});

	const enviar = (query: string, cabecalhos: Record<string, string> = {}, body: object = corpo) =>
		request(app.getHttpServer())
			.post(`${URL}${query}`)
			.set({ "x-request-id": REQUEST_ID, "x-signature": assinatura(), ...cabecalhos })
			.send(body);

	it.each(["order", "orders_v2"])("type=%s assinado → processa a order", async (tipo) => {
		const r = await enviar(`?data.id=${ID}&type=${tipo}`);

		expect(r.status).toBe(200);
		expect(r.body.data).toEqual({ processado: true, resultado: "CONFIRMADO" });
		expect(processar.execute).toHaveBeenCalledWith(ID, REQUEST_ID);
	});

	it("sem x-signature → 401", async () => {
		const r = await request(app.getHttpServer()).post(`${URL}?data.id=${ID}&type=order`).set("x-request-id", REQUEST_ID).send(corpo);

		expect(r.status).toBe(401);
		expect(processar.execute).not.toHaveBeenCalled();
	});

	it("assinatura com outro segredo → 401", async () => {
		const r = await enviar(`?data.id=${ID}&type=order`, { "x-signature": assinatura(ID, "outro") });

		expect(r.status).toBe(401);
		expect(processar.execute).not.toHaveBeenCalled();
	});

	it("tipo que não é order → 200 sem processar", async () => {
		const r = await enviar(`?data.id=${ID}&type=merchant_order`);

		expect(r.status).toBe(200);
		expect(r.body.data).toEqual({ processado: false });
		expect(processar.execute).not.toHaveBeenCalled();
	});

	it.each([
		["ErroGatewayPagamento temporário", new ErroGatewayPagamento("x", true), 503],
		["ConflitoConcorrenciaError", new ConflitoConcorrenciaError("o1"), 503],
		["ErroGatewayPagamento definitivo", new ErroGatewayPagamento("x", false), 500],
	])("%s → %p", async (_, erro, esperado) => {
		processar.execute.mockRejectedValue(erro);

		const r = await enviar(`?data.id=${ID}&type=order`);

		expect(r.status).toBe(esperado);
	});

	it("sem data.id na query usa o id do corpo", async () => {
		const r = await enviar("?type=order");

		expect(r.status).toBe(200);
		expect(processar.execute).toHaveBeenCalledWith(ID, REQUEST_ID);
	});

	it("rajada de notificações não esbarra no rate limit", async () => {
		const status = new Set<number>();
		for (let i = 0; i < 150; i++) status.add((await enviar(`?data.id=${ID}&type=merchant_order`)).status);

		expect([...status]).toEqual([200]);
	});
});
