import { Inject, Injectable } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { type OrcamentoResponseDto, paraOrcamentoResponse } from "../../dto/orcamento-response.dto";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";

@Injectable()
export class ListarOrcamentosUseCase {
	constructor(@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort) {}

	async execute(status?: StatusOrcamento): Promise<IServiceResponse<OrcamentoResponseDto[]>> {
		const listas = status
			? [await this.gateway.listarPorStatus(status)]
			: await Promise.all(Object.values(StatusOrcamento).map((s) => this.gateway.listarPorStatus(s)));
		const orcamentos = listas.flat().sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
		return SR.ok(orcamentos.map(paraOrcamentoResponse));
	}
}
