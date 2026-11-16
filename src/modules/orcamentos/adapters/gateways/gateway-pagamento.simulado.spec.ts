import { ErroGatewayPagamento, type PagamentoExterno } from "../../application/ports/gateway-pagamento.port";
import { GatewayPagamentoSimulado } from "./gateway-pagamento.simulado";

const pagamento: PagamentoExterno = {
	pagamentoId: "p-1",
	status: "approved",
	orcamentoId: "o-1",
	valorCentavos: 30000,
	pagoEm: "2026-10-20T14:00:00.000Z",
	bruto: {},
};

describe("GatewayPagamentoSimulado", () => {
	let gateway: GatewayPagamentoSimulado;

	beforeEach(() => (gateway = new GatewayPagamentoSimulado()));

	it("cria cobrança com link simulado por orçamento", async () => {
		await expect(
			gateway.criarCobranca({ orcamentoId: "o-1", numeroOs: "OS-1", itens: [], valorTotalCentavos: 30000, expiraEm: new Date() }),
		).resolves.toEqual({ preferenciaId: "simulada-o-1", linkPagamento: "https://pagamento.simulado.local/checkout/o-1" });
	});

	it("consulta pagamentos registrados por id e por orçamento", async () => {
		gateway.registrarPagamento(pagamento);
		await expect(gateway.consultarPagamento("p-1")).resolves.toEqual(pagamento);
		await expect(gateway.consultarPagamento("p-2")).resolves.toBeNull();
		await expect(gateway.buscarPagamentosPorOrcamento("o-1")).resolves.toEqual([pagamento]);
		await expect(gateway.buscarPagamentosPorOrcamento("o-2")).resolves.toEqual([]);
	});

	it("estorno é idempotente pela chave e marca o pagamento como refunded", async () => {
		gateway.registrarPagamento(pagamento);

		const primeiro = await gateway.estornar("p-1", "estorno-o-1");
		const segundo = await gateway.estornar("p-1", "estorno-o-1");

		expect(segundo).toBe(primeiro);
		expect(primeiro).toEqual({ estornoId: "estorno-p-1", valorCentavos: 30000 });
		expect((await gateway.consultarPagamento("p-1"))?.status).toBe("refunded");
	});

	it("estorno de pagamento desconhecido devolve valor zero", async () => {
		await expect(gateway.estornar("p-9", "estorno-o-9")).resolves.toEqual({ estornoId: "estorno-p-9", valorCentavos: 0 });
	});

	it("falharEstornos simula falha temporária do provedor", async () => {
		gateway.falharEstornos = true;
		const erro = await gateway.estornar("p-1", "k").catch((e: unknown) => e);
		expect(erro).toBeInstanceOf(ErroGatewayPagamento);
		expect(erro).toMatchObject({ temporario: true, statusHttp: 503 });
	});
});
