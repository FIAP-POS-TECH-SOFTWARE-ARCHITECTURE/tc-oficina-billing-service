import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Orcamento } from "../../domain/orcamento.entity";
import { type ContextoFluxo, criarEventoBilling } from "../eventos-billing";
import { GATEWAY_PAGAMENTO, type GatewayPagamentoPort } from "../ports/gateway-pagamento.port";
import { EventosOrcamentoService } from "./eventos-orcamento.service";

export const chaveIdempotenciaEstorno = (orcamentoId: string): string => `estorno-${orcamentoId}`;

@Injectable()
export class EstornoService {
	private readonly logger = new Logger(EstornoService.name);

	constructor(
		@Inject(GATEWAY_PAGAMENTO) private readonly pagamentos: GatewayPagamentoPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async estornar(orcamento: Orcamento, contexto: ContextoFluxo, mensagemProcessada?: string): Promise<void> {
		const pagamentoId = orcamento.pagamentoId as string;
		await this.pagamentos.estornar(pagamentoId, chaveIdempotenciaEstorno(orcamento.id));
		const evento = criarEventoBilling(contexto, "PagamentoEstornado", {
			orcamentoId: orcamento.id,
			pagamentoId,
			valorCentavos: orcamento.valorPagoCentavos ?? 0,
		});
		await this.eventos.atualizar(orcamento.estornar(new Date()), orcamento.versao, { mensagemProcessada, eventos: [evento] });
		this.logger.log({ event: "billing.pagamento.estornado", orcamentoId: orcamento.id, pagamentoId });
	}
}
