import { orcamentoPago } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { GatewayPagamentoSimulado } from "../../adapters/gateways/gateway-pagamento.simulado";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { contextoDoOrcamento } from "../eventos-billing";
import { chaveIdempotenciaEstorno, EstornoService } from "./estorno.service";
import { EventosOrcamentoService } from "./eventos-orcamento.service";

describe("EstornoService", () => {
	it("chave de idempotência derivada do orçamento", () => {
		expect(chaveIdempotenciaEstorno("o-1")).toBe("estorno-o-1");
	});

	it("estorna no provedor, grava ESTORNADO e o dedupe do comando na mesma escrita", async () => {
		const gateway = new OrcamentosMemoriaGateway();
		const publicador = new PublicadorMemoria();
		const pagamentos = new GatewayPagamentoSimulado();
		const servico = new EstornoService(pagamentos, new EventosOrcamentoService(gateway, publicador));
		const orcamento = orcamentoPago();
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());

		await servico.estornar(orcamento, contextoDoOrcamento(orcamento, "req-1"), "m1");

		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.ESTORNADO);
		await expect(gateway.mensagemJaProcessada("m1")).resolves.toBe(true);
		expect(publicador.doTipo("PagamentoEstornado")[0]).toMatchObject({
			correlationId: "req-1",
			payload: { orcamentoId: orcamento.id, pagamentoId: "1234567890", valorCentavos: 30000 },
		});
	});
});
