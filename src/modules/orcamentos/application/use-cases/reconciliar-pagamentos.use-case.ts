import { Inject, Injectable } from "@nestjs/common";
import { SR } from "../../../../common/utils/service-response.util";
import { GATEWAY_PAGAMENTO, type GatewayPagamentoPort } from "../ports/gateway-pagamento.port";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { RegistrarPagamentoUseCase, type ResultadoRegistroPagamento } from "./registrar-pagamento.use-case";

/** Para webhook perdido: busca no provedor tudo o que foi cobrado pelo orçamento e aplica as mesmas regras da notificação. */
@Injectable()
export class ReconciliarPagamentosUseCase {
	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		@Inject(GATEWAY_PAGAMENTO) private readonly pagamentos: GatewayPagamentoPort,
		private readonly registrar: RegistrarPagamentoUseCase,
	) {}

	async execute(numeroOs: string, correlationId: string) {
		const orcamento = await this.gateway.buscarPorNumeroOs(numeroOs);
		if (!orcamento) return SR.notFound(undefined, "Orçamento não encontrado");

		const encontrados = await this.pagamentos.buscarPagamentosPorOrcamento(orcamento.id);
		const resultados: { pagamentoId: string; resultado: ResultadoRegistroPagamento }[] = [];
		for (const pagamento of encontrados)
			resultados.push({ pagamentoId: pagamento.pagamentoId, resultado: await this.registrar.execute(pagamento, correlationId) });

		const atual = (await this.gateway.buscarPorId(orcamento.id)) ?? orcamento;
		return SR.ok(
			{ orcamentoId: orcamento.id, status: atual.status, pagamentosEncontrados: encontrados.length, resultados },
			"Reconciliação concluída",
		);
	}
}
