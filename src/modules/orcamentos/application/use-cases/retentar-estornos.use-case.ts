import { Inject, Injectable, Logger } from "@nestjs/common";
import { mensagemDeErro } from "../../../../common/utils/erro.util";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { contextoDoOrcamento } from "../eventos-billing";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EstornoService } from "../services/estorno.service";

@Injectable()
export class RetentarEstornosUseCase {
	private readonly logger = new Logger(RetentarEstornosUseCase.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		private readonly estorno: EstornoService,
	) {}

	async execute(agora = new Date()): Promise<number> {
		const vencidos = (await this.gateway.listarPorStatus(StatusOrcamento.ESTORNO_PENDENTE)).filter(
			(o) => !o.proximaTentativaEstornoEm || new Date(o.proximaTentativaEstornoEm) <= agora,
		);
		for (const orcamento of vencidos) {
			try {
				await this.estorno.estornar(orcamento, contextoDoOrcamento(orcamento, `retentativa-estorno-${orcamento.id}`));
			} catch (erro) {
				this.logger.error({ event: "billing.estorno.retentativa-falhou", orcamentoId: orcamento.id, erro: mensagemDeErro(erro) });
			}
		}
		return vencidos.length;
	}
}
