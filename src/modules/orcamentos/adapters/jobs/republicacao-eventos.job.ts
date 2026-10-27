import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { mensagemDeErro } from "../../../../common/utils/erro.util";
import { workersHabilitados } from "../../../mensageria/configuracao-mensageria";
import { EventosOrcamentoService } from "../../application/services/eventos-orcamento.service";

@Injectable()
export class RepublicacaoEventosJob {
	private readonly logger = new Logger(RepublicacaoEventosJob.name);
	private executando = false;

	constructor(private readonly eventos: EventosOrcamentoService) {}

	@Interval("republicacao-eventos", 15_000)
	async executar(): Promise<void> {
		if (!workersHabilitados() || this.executando) return;
		this.executando = true;
		try {
			const quantidade = await this.eventos.republicarPendentes();
			if (quantidade > 0) this.logger.log({ event: "billing.eventos.republicados", quantidade });
		} catch (erro) {
			this.logger.error({ event: "billing.eventos.republicacao-falhou", erro: mensagemDeErro(erro) });
		} finally {
			this.executando = false;
		}
	}
}
