import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { mensagemDeErro } from "../../../../common/utils/erro.util";
import { workersHabilitados } from "../../../mensageria/configuracao-mensageria";
import { RetentarEstornosUseCase } from "../../application/use-cases/retentar-estornos.use-case";

@Injectable()
export class RetentativaEstornosJob {
	private readonly logger = new Logger(RetentativaEstornosJob.name);
	private executando = false;

	constructor(private readonly retentar: RetentarEstornosUseCase) {}

	@Interval("retentativa-estornos", 60_000)
	async executar(): Promise<void> {
		if (!workersHabilitados() || this.executando) return;
		this.executando = true;
		try {
			const quantidade = await this.retentar.execute();
			if (quantidade > 0) this.logger.log({ event: "billing.estorno.retentativas", quantidade });
		} catch (erro) {
			this.logger.error({ event: "billing.estorno.retentativas-falharam", erro: mensagemDeErro(erro) });
		} finally {
			this.executando = false;
		}
	}
}
