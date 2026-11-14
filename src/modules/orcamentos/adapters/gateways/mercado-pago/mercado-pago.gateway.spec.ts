import { type DadosCobranca, ErroGatewayPagamento } from "../../../application/ports/gateway-pagamento.port";
import { MercadoPagoGateway } from "./mercado-pago.gateway";

const agora = new Date("2026-10-20T13:00:00.000Z");
const DIA_MS = 24 * 60 * 60_000;

const erroHttp = (status: number | undefined, mensagem = "falhou") => Object.assign(new Error(mensagem), { status });
const erro409 = (codigo: string) => erroHttp(409, `{"errors":[{"code":"${codigo}"}],"status":409}`);

const dados = (sobrescrever: Partial<DadosCobranca> = {}): DadosCobranca => ({
	orcamentoId: "o1",
	numeroOs: "OS-1",
	itens: [
		{ referenciaId: "peca-1", descricao: "Filtro de óleo", quantidade: 3, precoUnitarioCentavos: 3333 },
		{ referenciaId: "servico-1", descricao: "x".repeat(300), quantidade: 1, precoUnitarioCentavos: 1 },
	],
	valorTotalCentavos: 10000,
	expiraEm: new Date(agora.getTime() + 30 * 60_000),
	...sobrescrever,
});

const order = {
	id: "ORD01ABC",
	status: "processed",
	status_detail: "accredited",
	external_reference: "o1",
	total_amount: "99.99",
	total_paid_amount: "99.99",
	created_date: "2026-10-20T12:00:00.000Z",
	last_updated_date: "2026-10-20T12:05:00.000Z",
	checkout_url: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=x",
	transactions: {
		payments: [
			{ id: "PAY01", status: "processed", status_detail: "accredited", paid_amount: "99.99", payment_method: { id: "master" } },
		],
	},
	api_response: { status: 200, headers: {} },
};

describe("MercadoPagoGateway", () => {
	let mp: { orders: Record<"create" | "get" | "search" | "refund", jest.Mock> };
	let gateway: MercadoPagoGateway;
	const urlOriginal = process.env.MERCADO_PAGO_NOTIFICATION_URL;

	beforeEach(() => {
		mp = { orders: { create: jest.fn(), get: jest.fn(), search: jest.fn(), refund: jest.fn() } };
		gateway = new MercadoPagoGateway(mp, () => agora);
		delete process.env.MERCADO_PAGO_NOTIFICATION_URL;
	});

	afterAll(() => {
		if (urlOriginal === undefined) delete process.env.MERCADO_PAGO_NOTIFICATION_URL;
		else process.env.MERCADO_PAGO_NOTIFICATION_URL = urlOriginal;
	});

	describe("criarCobranca", () => {
		it("cria a order do checkout pro e devolve id e link", async () => {
			process.env.MERCADO_PAGO_NOTIFICATION_URL = "https://api.exemplo/webhook";
			mp.orders.create.mockResolvedValue({ id: "ORD01ABC", checkout_url: "https://mp/checkout" });

			await expect(gateway.criarCobranca(dados())).resolves.toEqual({
				preferenciaId: "ORD01ABC",
				linkPagamento: "https://mp/checkout",
			});

			const { body, requestOptions } = mp.orders.create.mock.calls[0][0];
			expect(requestOptions).toEqual({ idempotencyKey: "order-o1" });
			expect(body).toMatchObject({
				type: "online",
				processing_mode: "manual",
				capture_mode: "automatic",
				external_reference: "o1",
				total_amount: "100.00",
				expiration_time: "PT1800S",
				items: [
					{ external_code: "peca-1", title: "Filtro de óleo", quantity: 3, unit_price: "33.33" },
					{ external_code: "servico-1", title: "x".repeat(256), quantity: 1, unit_price: "0.01" },
				],
				config: {
					payment_method: { not_allowed_types: ["ticket", "atm"], max_installments: 1 },
					online: { retries: { allowed: true }, callback_url: "https://api.exemplo/webhook" },
				},
			});
		});

		it("omite callback_url quando a variável está vazia", async () => {
			process.env.MERCADO_PAGO_NOTIFICATION_URL = "";
			mp.orders.create.mockResolvedValue({ id: "ORD01ABC", checkout_url: "https://mp/checkout" });

			await gateway.criarCobranca(dados());

			expect(mp.orders.create.mock.calls[0][0].body.config.online).not.toHaveProperty("callback_url");
		});

		it.each([{ checkout_url: "https://mp/checkout" }, { id: "ORD01ABC" }])(
			"resposta incompleta (%p) → erro não temporário",
			async (resposta) => {
				mp.orders.create.mockResolvedValue(resposta);

				await expect(gateway.criarCobranca(dados())).rejects.toMatchObject({ temporario: false });
			},
		);

		it("soma dos itens diferente do total → erro não temporário sem chamar a API", async () => {
			const erro = await gateway.criarCobranca(dados({ valorTotalCentavos: 9999 })).catch((e: unknown) => e);

			expect(erro).toBeInstanceOf(ErroGatewayPagamento);
			expect(erro).toMatchObject({ temporario: false });
			expect(mp.orders.create).not.toHaveBeenCalled();
		});

		it("prazo vencido → erro não temporário sem chamar a API", async () => {
			const erro = await gateway.criarCobranca(dados({ expiraEm: new Date(agora.getTime() - 1000) })).catch((e: unknown) => e);

			expect(erro).toBeInstanceOf(ErroGatewayPagamento);
			expect(erro).toMatchObject({ temporario: false });
			expect(mp.orders.create).not.toHaveBeenCalled();
		});

		describe("retentativa com a mesma chave de idempotência", () => {
			beforeEach(() => mp.orders.create.mockRejectedValue(erro409("idempotency_key_already_used")));

			it("reaproveita a order já criada para o orçamento", async () => {
				mp.orders.search.mockResolvedValue({ data: [{ ...order, status: "created", status_detail: "created" }] });
				mp.orders.get.mockResolvedValue({ id: "ORD01ABC", checkout_url: "https://mp/checkout" });

				await expect(gateway.criarCobranca(dados())).resolves.toEqual({
					preferenciaId: "ORD01ABC",
					linkPagamento: "https://mp/checkout",
				});

				expect(mp.orders.search.mock.calls[0][0].options).toMatchObject({
					external_reference: "o1",
					sort_by: "created_date",
					sort_order: "desc",
				});
				expect(mp.orders.get).toHaveBeenCalledWith({ id: "ORD01ABC", requestOptions: { timeout: 5000, maxRetries: 1 } });
			});

			it("busca ainda vazia → erro temporário", async () => {
				mp.orders.search.mockResolvedValue({ data: [] });

				await expect(gateway.criarCobranca(dados())).rejects.toMatchObject({ temporario: true });
				expect(mp.orders.get).not.toHaveBeenCalled();
			});

			it("order existente sem checkout_url → erro temporário", async () => {
				mp.orders.search.mockResolvedValue({ data: [order] });
				mp.orders.get.mockResolvedValue({ id: "ORD01ABC" });

				await expect(gateway.criarCobranca(dados())).rejects.toMatchObject({ temporario: true });
			});
		});

		it("409 com outro código → erro não temporário sem buscar", async () => {
			mp.orders.create.mockRejectedValue(erro409("cannot_refund_order"));

			await expect(gateway.criarCobranca(dados())).rejects.toMatchObject({ temporario: false, statusHttp: 409 });
			expect(mp.orders.search).not.toHaveBeenCalled();
		});
	});

	describe("consultarPagamento", () => {
		it("mapeia a order aprovada", async () => {
			mp.orders.get.mockResolvedValue(order);

			const pagamento = await gateway.consultarPagamento("ORD01ABC");

			expect(mp.orders.get).toHaveBeenCalledWith({ id: "ORD01ABC", requestOptions: { timeout: 5000, maxRetries: 1 } });
			expect(pagamento).toMatchObject({
				pagamentoId: "ORD01ABC",
				status: "approved",
				orcamentoId: "o1",
				valorCentavos: 9999,
				pagoEm: "2026-10-20T12:05:00.000Z",
			});
			expect(pagamento?.bruto).not.toHaveProperty("api_response");
			expect(pagamento?.bruto).toMatchObject({
				pagamentos: [
					{ id: "PAY01", status: "processed", status_detail: "accredited", paid_amount: "99.99", payment_method: "master" },
				],
			});
		});

		it("order não aprovada não tem pagoEm e sem external_reference vira null", async () => {
			mp.orders.get.mockResolvedValue({
				id: "ORD01ABC",
				status: "created",
				status_detail: "created",
				last_updated_date: "2026-10-20T12:05:00.000Z",
			});

			await expect(gateway.consultarPagamento("ORD01ABC")).resolves.toMatchObject({
				status: "created/created",
				orcamentoId: null,
				valorCentavos: 0,
				pagoEm: null,
			});
		});

		it("404 → null", async () => {
			mp.orders.get.mockRejectedValue(erroHttp(404));

			await expect(gateway.consultarPagamento("ORD01XYZ")).resolves.toBeNull();
		});

		it("400 (id mal formado) → erro não temporário", async () => {
			mp.orders.get.mockRejectedValue(erroHttp(400, "invalid_path_param"));

			await expect(gateway.consultarPagamento("x")).rejects.toMatchObject({ temporario: false, statusHttp: 400 });
		});
	});

	describe("buscarPagamentosPorOrcamento", () => {
		it("busca nos últimos 28 dias, mais recente primeiro", async () => {
			mp.orders.search.mockResolvedValue({ data: [order] });

			const pagamentos = await gateway.buscarPagamentosPorOrcamento("o1");

			expect(mp.orders.search).toHaveBeenCalledWith({
				options: {
					begin_date: new Date(agora.getTime() - 28 * DIA_MS).toISOString(),
					end_date: agora.toISOString(),
					external_reference: "o1",
					sort_by: "created_date",
					sort_order: "desc",
				},
			});
			expect(pagamentos).toHaveLength(1);
			expect(pagamentos[0]).toMatchObject({ pagamentoId: "ORD01ABC", status: "approved" });
		});

		it("sem data → lista vazia", async () => {
			mp.orders.search.mockResolvedValue({});

			await expect(gateway.buscarPagamentosPorOrcamento("o1")).resolves.toEqual([]);
		});
	});

	describe("estornar", () => {
		it("reembolso total idempotente pela chave", async () => {
			mp.orders.refund.mockResolvedValue({
				id: "ORD01ABC",
				status: "refunded",
				transactions: {
					refunds: [
						{ id: "REF01A", status: "processed", amount: "50.00" },
						{ id: "REF01B", status: "processed", amount: "49.99" },
					],
				},
			});

			await expect(gateway.estornar("ORD01ABC", "estorno-o1")).resolves.toEqual({ estornoId: "REF01B", valorCentavos: 9999 });
			expect(mp.orders.refund).toHaveBeenCalledWith({ id: "ORD01ABC", requestOptions: { idempotencyKey: "estorno-o1" } });
		});

		it("sem refunds → estorno vazio", async () => {
			mp.orders.refund.mockResolvedValue({ id: "ORD01ABC" });

			await expect(gateway.estornar("ORD01ABC", "estorno-o1")).resolves.toEqual({ estornoId: "", valorCentavos: 0 });
		});
	});

	describe("tradução de erros", () => {
		it.each([
			[500, true],
			[429, true],
			[undefined, true],
			[400, false],
			[409, false],
		])("HTTP %p → temporario %p", async (status, temporario) => {
			mp.orders.refund.mockRejectedValue(erroHttp(status, "detalhe"));

			const erro = await gateway.estornar("ORD01ABC", "estorno-o1").catch((e: unknown) => e);

			expect(erro).toBeInstanceOf(ErroGatewayPagamento);
			expect(erro).toMatchObject({ temporario });
			expect((erro as Error).message).toContain("reembolsar order");
			if (status) expect((erro as Error).message).toContain(`HTTP ${status}`);
		});
	});
});
