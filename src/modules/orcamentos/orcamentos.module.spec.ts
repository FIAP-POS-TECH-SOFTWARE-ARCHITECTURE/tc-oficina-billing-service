import { GatewayPagamentoSimulado } from "./adapters/gateways/gateway-pagamento.simulado";
import { MercadoPagoGateway } from "./adapters/gateways/mercado-pago/mercado-pago.gateway";
import { criarGatewayPagamento } from "./orcamentos.module";

describe("criarGatewayPagamento", () => {
	it("com access token usa o Mercado Pago", () => {
		expect(criarGatewayPagamento("TEST-x")).toBeInstanceOf(MercadoPagoGateway);
	});

	it.each(["", undefined])("sem access token (%p) continua simulado", (token) => {
		expect(criarGatewayPagamento(token)).toBeInstanceOf(GatewayPagamentoSimulado);
	});
});
