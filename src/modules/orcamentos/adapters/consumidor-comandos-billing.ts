import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { workersHabilitados } from "../../mensageria/configuracao-mensageria";
import { ConsumidorSqs } from "../../mensageria/consumidor-sqs";
import type { EnvelopeMensagem } from "../../mensageria/envelope";
import type { GerarOrcamentoPayload, PayloadComMotivo } from "../application/comandos-billing";
import { CancelarOrcamentoUseCase } from "../application/use-cases/cancelar-orcamento.use-case";
import { EstornarPagamentoUseCase } from "../application/use-cases/estornar-pagamento.use-case";
import { GerarOrcamentoUseCase } from "../application/use-cases/gerar-orcamento.use-case";

@Injectable()
export class ConsumidorComandosBilling implements OnApplicationBootstrap {
	private readonly logger = new Logger(ConsumidorComandosBilling.name);

	constructor(
		private readonly consumidor: ConsumidorSqs,
		private readonly gerar: GerarOrcamentoUseCase,
		private readonly cancelar: CancelarOrcamentoUseCase,
		private readonly estornar: EstornarPagamentoUseCase,
	) {}

	onApplicationBootstrap(): void {
		const fila = process.env.SQS_BILLING_COMANDOS_URL;
		if (!workersHabilitados() || !fila) {
			this.logger.warn({ event: "billing.consumidor.desligado", workers: workersHabilitados(), filaDefinida: Boolean(fila) });
			return;
		}
		this.consumidor.iniciar(fila, (envelope) => this.despachar(envelope));
	}

	despachar(envelope: EnvelopeMensagem<unknown>): Promise<void> {
		switch (envelope.tipo) {
			case "GerarOrcamento":
				return this.gerar.execute(envelope as EnvelopeMensagem<GerarOrcamentoPayload>);
			case "CancelarOrcamento":
				return this.cancelar.execute(envelope as EnvelopeMensagem<PayloadComMotivo>);
			case "EstornarPagamento":
				return this.estornar.execute(envelope as EnvelopeMensagem<PayloadComMotivo>);
			default:
				return Promise.reject(new Error(`Tipo de comando não suportado pelo billing: ${envelope.tipo}`));
		}
	}
}
