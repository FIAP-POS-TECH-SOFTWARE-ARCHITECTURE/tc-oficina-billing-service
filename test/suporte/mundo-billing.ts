import type { IServiceResponse } from "semantic-response";
import type { EnvelopeMensagem } from "../../src/modules/mensageria/envelope";
import { GatewayPagamentoSimulado } from "../../src/modules/orcamentos/adapters/gateways/gateway-pagamento.simulado";
import type { GerarOrcamentoPayload } from "../../src/modules/orcamentos/application/comandos-billing";
import { EstornoService } from "../../src/modules/orcamentos/application/services/estorno.service";
import { EventosOrcamentoService } from "../../src/modules/orcamentos/application/services/eventos-orcamento.service";
import { AprovarOrcamentoUseCase } from "../../src/modules/orcamentos/application/use-cases/aprovar-orcamento.use-case";
import { CancelarOrcamentoUseCase } from "../../src/modules/orcamentos/application/use-cases/cancelar-orcamento.use-case";
import { ConsultarOrcamentoClienteUseCase } from "../../src/modules/orcamentos/application/use-cases/consultar-orcamento-cliente.use-case";
import { EstornarPagamentoUseCase } from "../../src/modules/orcamentos/application/use-cases/estornar-pagamento.use-case";
import { GerarOrcamentoUseCase } from "../../src/modules/orcamentos/application/use-cases/gerar-orcamento.use-case";
import { RejeitarOrcamentoUseCase } from "../../src/modules/orcamentos/application/use-cases/rejeitar-orcamento.use-case";
import { OrcamentosMemoriaGateway } from "./orcamentos-memoria.gateway";
import { PublicadorMemoria } from "./publicador-memoria";

/** Billing inteiro em memória, com os mesmos use cases do app: usado pelos cenários BDD. */
export function criarMundoBilling() {
	const gateway = new OrcamentosMemoriaGateway();
	const publicador = new PublicadorMemoria();
	const pagamentos = new GatewayPagamentoSimulado();
	const eventos = new EventosOrcamentoService(gateway, publicador);
	const estorno = new EstornoService(pagamentos, eventos);

	return {
		gateway,
		publicador,
		pagamentos,
		eventos,
		estorno,
		gerar: new GerarOrcamentoUseCase(gateway, eventos),
		cancelar: new CancelarOrcamentoUseCase(gateway, eventos),
		estornar: new EstornarPagamentoUseCase(gateway, eventos, estorno),
		aprovar: new AprovarOrcamentoUseCase(gateway, pagamentos, eventos),
		rejeitar: new RejeitarOrcamentoUseCase(gateway, eventos),
		consultarCliente: new ConsultarOrcamentoClienteUseCase(gateway),
		/** Resposta da última chamada HTTP simulada. */
		ultimaResposta: undefined as IServiceResponse<any> | undefined,
		/** Último comando GerarOrcamento entregue. */
		ultimoComando: undefined as EnvelopeMensagem<GerarOrcamentoPayload> | undefined,
	};
}

export type MundoBilling = ReturnType<typeof criarMundoBilling>;
