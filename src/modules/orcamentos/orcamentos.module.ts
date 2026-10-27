import { Module } from "@nestjs/common";
import { MensageriaModule } from "../mensageria/mensageria.module";
import { ConsumidorComandosBilling } from "./adapters/consumidor-comandos-billing";
import { GatewayPagamentoSimulado } from "./adapters/gateways/gateway-pagamento.simulado";
import { OrcamentosDynamoDbGateway } from "./adapters/gateways/orcamentos.dynamodb.gateway";
import { RepublicacaoEventosJob } from "./adapters/jobs/republicacao-eventos.job";
import { OrcamentosClienteController } from "./adapters/orcamentos-cliente.controller";
import { OrcamentosController } from "./adapters/orcamentos.controller";
import { GATEWAY_PAGAMENTO } from "./application/ports/gateway-pagamento.port";
import { ORCAMENTOS_GATEWAY } from "./application/ports/orcamentos.gateway";
import { EstornoService } from "./application/services/estorno.service";
import { EventosOrcamentoService } from "./application/services/eventos-orcamento.service";
import { AprovarOrcamentoUseCase } from "./application/use-cases/aprovar-orcamento.use-case";
import { CancelarOrcamentoUseCase } from "./application/use-cases/cancelar-orcamento.use-case";
import { ConsultarOrcamentoClienteUseCase } from "./application/use-cases/consultar-orcamento-cliente.use-case";
import { ConsultarOrcamentoUseCase } from "./application/use-cases/consultar-orcamento.use-case";
import { EstornarPagamentoUseCase } from "./application/use-cases/estornar-pagamento.use-case";
import { GerarOrcamentoUseCase } from "./application/use-cases/gerar-orcamento.use-case";
import { ListarOrcamentosUseCase } from "./application/use-cases/listar-orcamentos.use-case";
import { RejeitarOrcamentoUseCase } from "./application/use-cases/rejeitar-orcamento.use-case";

@Module({
	imports: [MensageriaModule],
	controllers: [OrcamentosClienteController, OrcamentosController],
	providers: [
		EventosOrcamentoService,
		EstornoService,
		GerarOrcamentoUseCase,
		CancelarOrcamentoUseCase,
		EstornarPagamentoUseCase,
		AprovarOrcamentoUseCase,
		RejeitarOrcamentoUseCase,
		ConsultarOrcamentoClienteUseCase,
		ConsultarOrcamentoUseCase,
		ListarOrcamentosUseCase,
		ConsumidorComandosBilling,
		RepublicacaoEventosJob,
		{ provide: ORCAMENTOS_GATEWAY, useClass: OrcamentosDynamoDbGateway },
		{ provide: GATEWAY_PAGAMENTO, useClass: GatewayPagamentoSimulado },
	],
})
export class OrcamentosModule {}
