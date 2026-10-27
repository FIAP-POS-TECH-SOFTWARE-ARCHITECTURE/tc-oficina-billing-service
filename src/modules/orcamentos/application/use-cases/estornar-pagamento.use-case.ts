import { Inject, Injectable } from "@nestjs/common";
import type { EnvelopeMensagem } from "../../../mensageria/envelope";
import { StatusOrcamento } from "../../domain/status-orcamento";
import type { PayloadComMotivo } from "../comandos-billing";
import { contextoDoComando, criarEventoBilling } from "../eventos-billing";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EstornoService } from "../services/estorno.service";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";

@Injectable()
export class EstornarPagamentoUseCase {
	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		private readonly eventos: EventosOrcamentoService,
		private readonly estorno: EstornoService,
	) {}

	async execute(comando: EnvelopeMensagem<PayloadComMotivo>): Promise<void> {
		if (await this.gateway.mensagemJaProcessada(comando.messageId)) return;
		const contexto = contextoDoComando(comando);
		const orcamento = await this.gateway.buscarPorOsId(comando.osId);

		if (!orcamento?.possuiPagamento() || orcamento.status === StatusOrcamento.ESTORNADO) {
			const payload =
				orcamento?.status === StatusOrcamento.ESTORNADO
					? { orcamentoId: orcamento.id, pagamentoId: orcamento.pagamentoId, valorCentavos: orcamento.valorPagoCentavos ?? 0 }
					: { orcamentoId: orcamento?.id ?? null, pagamentoId: null, valorCentavos: 0 };
			await this.eventos.registrar({
				mensagemProcessada: comando.messageId,
				eventos: [criarEventoBilling(contexto, "PagamentoEstornado", payload)],
			});
			return;
		}

		await this.estorno.estornar(orcamento, contexto, comando.messageId);
	}
}
