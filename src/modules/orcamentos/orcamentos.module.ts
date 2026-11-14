import { Logger, Module } from "@nestjs/common";
import { MensageriaModule } from "../mensageria/mensageria.module";
import { ConsumidorComandosBilling } from "./adapters/consumidor-comandos-billing";
import { GatewayPagamentoSimulado } from "./adapters/gateways/gateway-pagamento.simulado";
import { criarClientesMercadoPago } from "./adapters/gateways/mercado-pago/clientes-mercado-pago";
import { MercadoPagoGateway } from "./adapters/gateways/mercado-pago/mercado-pago.gateway";
import { OrcamentosDynamoDbGateway } from "./adapters/gateways/orcamentos.dynamodb.gateway";
import { RepublicacaoEventosJob } from "./adapters/jobs/republicacao-eventos.job";
import { RetentativaEstornosJob } from "./adapters/jobs/retentativa-estornos.job";
import { OrcamentosClienteController } from "./adapters/orcamentos-cliente.controller";
import { OrcamentosController } from "./adapters/orcamentos.controller";
import { WebhookMercadoPagoController } from "./adapters/webhook-mercado-pago.controller";
import { GATEWAY_PAGAMENTO, type GatewayPagamentoPort } from "./application/ports/gateway-pagamento.port";
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
import { ProcessarNotificacaoPagamentoUseCase } from "./application/use-cases/processar-notificacao-pagamento.use-case";
import { ReconciliarPagamentosUseCase } from "./application/use-cases/reconciliar-pagamentos.use-case";
import { RegistrarPagamentoUseCase } from "./application/use-cases/registrar-pagamento.use-case";
import { RejeitarOrcamentoUseCase } from "./application/use-cases/rejeitar-orcamento.use-case";
import { RetentarEstornosUseCase } from "./application/use-cases/retentar-estornos.use-case";

/** Sem token (dev local, demo sem conta) a cobrança continua simulada; homolog/prod têm o token garantido pelo CD. */
export function criarGatewayPagamento(token = process.env.MERCADO_PAGO_ACCESS_TOKEN): GatewayPagamentoPort {
	if (token) return new MercadoPagoGateway(criarClientesMercadoPago(token));
	new Logger("OrcamentosModule").warn({ event: "billing.pagamento.gateway-simulado", motivo: "MERCADO_PAGO_ACCESS_TOKEN ausente" });
	return new GatewayPagamentoSimulado();
}

@Module({
	imports: [MensageriaModule],
	controllers: [OrcamentosClienteController, OrcamentosController, WebhookMercadoPagoController],
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
		RegistrarPagamentoUseCase,
		ProcessarNotificacaoPagamentoUseCase,
		RetentarEstornosUseCase,
		ReconciliarPagamentosUseCase,
		ConsumidorComandosBilling,
		RepublicacaoEventosJob,
		RetentativaEstornosJob,
		{ provide: ORCAMENTOS_GATEWAY, useClass: OrcamentosDynamoDbGateway },
		{ provide: GATEWAY_PAGAMENTO, useFactory: () => criarGatewayPagamento() },
	],
})
export class OrcamentosModule {}
