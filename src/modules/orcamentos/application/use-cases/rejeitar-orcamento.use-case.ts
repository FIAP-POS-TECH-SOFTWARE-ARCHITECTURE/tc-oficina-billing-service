import { Inject, Injectable, Logger } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { podeTransicionar } from "../../domain/fluxo-estados-orcamento";
import { type OrcamentoResponseDto, paraOrcamentoResponse } from "../../dto/orcamento-response.dto";
import { contextoDoOrcamento, criarEventoBilling } from "../eventos-billing";
import { ConflitoConcorrenciaError, ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";

@Injectable()
export class RejeitarOrcamentoUseCase {
	private readonly logger = new Logger(RejeitarOrcamentoUseCase.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async execute(
		numeroOs: string,
		clienteId: string,
		motivo: string | null,
		correlationId: string,
	): Promise<IServiceResponse<OrcamentoResponseDto>> {
		const orcamento = await this.gateway.buscarPorNumeroOs(numeroOs);
		if (!orcamento) return SR.notFound(undefined, "Orçamento não encontrado");
		if (!orcamento.pertenceAoCliente(clienteId)) return SR.forbidden(undefined, "Orçamento não pertence ao cliente autenticado");
		if (!podeTransicionar(orcamento.status, "rejeitar"))
			return SR.unprocessableEntity(undefined, `Não é possível rejeitar orçamento no status ${orcamento.status}`);

		const rejeitado = orcamento.rejeitar(motivo, new Date());
		const evento = criarEventoBilling(contextoDoOrcamento(orcamento, correlationId), "OrcamentoRejeitado", {
			orcamentoId: orcamento.id,
			motivo,
		});
		try {
			await this.eventos.atualizar(rejeitado, orcamento.versao, { eventos: [evento] });
		} catch (erro) {
			if (!(erro instanceof ConflitoConcorrenciaError)) throw erro;
			return SR.unprocessableEntity(undefined, "Orçamento foi alterado durante a rejeição (ex.: cancelado pela oficina)");
		}
		this.logger.log({
			event: "billing.orcamento.rejeitado",
			orcamentoId: orcamento.id,
			fluxoId: orcamento.fluxoId,
			osId: orcamento.osId,
		});
		return SR.ok(paraOrcamentoResponse(rejeitado), "Orçamento rejeitado");
	}
}
