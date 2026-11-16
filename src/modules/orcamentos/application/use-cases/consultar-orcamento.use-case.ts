import { Inject, Injectable } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { type OrcamentoResponseDto, paraOrcamentoResponse } from "../../dto/orcamento-response.dto";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";

@Injectable()
export class ConsultarOrcamentoUseCase {
	constructor(@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort) {}

	async execute(numeroOs: string): Promise<IServiceResponse<OrcamentoResponseDto>> {
		const orcamento = await this.gateway.buscarPorNumeroOs(numeroOs);
		if (!orcamento) return SR.notFound(undefined, "Orçamento não encontrado");
		return SR.ok(paraOrcamentoResponse(orcamento));
	}
}
