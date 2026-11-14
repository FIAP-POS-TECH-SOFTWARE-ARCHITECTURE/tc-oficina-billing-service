import { Inject, Injectable, Logger } from "@nestjs/common";
import { GATEWAY_PAGAMENTO, type GatewayPagamentoPort } from "../ports/gateway-pagamento.port";
import { RegistrarPagamentoUseCase, type ResultadoRegistroPagamento } from "./registrar-pagamento.use-case";

/** A notificação só traz o id; o estado vale o que a API do provedor responder agora. */
@Injectable()
export class ProcessarNotificacaoPagamentoUseCase {
	private readonly logger = new Logger(ProcessarNotificacaoPagamentoUseCase.name);

	constructor(
		@Inject(GATEWAY_PAGAMENTO) private readonly pagamentos: GatewayPagamentoPort,
		private readonly registrar: RegistrarPagamentoUseCase,
	) {}

	async execute(pagamentoId: string, correlationId: string): Promise<ResultadoRegistroPagamento> {
		const pagamento = await this.pagamentos.consultarPagamento(pagamentoId);
		if (!pagamento) {
			this.logger.warn({ event: "billing.webhook.pagamento-inexistente", pagamentoId });
			return "PAGAMENTO_NAO_ENCONTRADO";
		}
		return this.registrar.execute(pagamento, correlationId);
	}
}
