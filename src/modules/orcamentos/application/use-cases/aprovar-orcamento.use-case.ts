import { Inject, Injectable, Logger } from "@nestjs/common";
import type { IServiceResponse } from "semantic-response";
import { SR } from "../../../../common/utils/service-response.util";
import { podeTransicionar } from "../../domain/fluxo-estados-orcamento";
import type { AprovacaoResponseDto } from "../../dto/aprovacao-response.dto";
import { contextoDoOrcamento, criarEventoBilling } from "../eventos-billing";
import { GATEWAY_PAGAMENTO, type GatewayPagamentoPort } from "../ports/gateway-pagamento.port";
import { ConflitoConcorrenciaError, ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";

@Injectable()
export class AprovarOrcamentoUseCase {
	private readonly logger = new Logger(AprovarOrcamentoUseCase.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		@Inject(GATEWAY_PAGAMENTO) private readonly pagamentos: GatewayPagamentoPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async execute(numeroOs: string, clienteId: string, correlationId: string): Promise<IServiceResponse<AprovacaoResponseDto>> {
		const orcamento = await this.gateway.buscarPorNumeroOs(numeroOs);
		if (!orcamento) return SR.notFound(undefined, "Orçamento não encontrado");
		if (!orcamento.pertenceAoCliente(clienteId)) return SR.forbidden(undefined, "Orçamento não pertence ao cliente autenticado");
		if (!podeTransicionar(orcamento.status, "aprovar"))
			return SR.unprocessableEntity(undefined, `Não é possível aprovar orçamento no status ${orcamento.status}`);

		const agora = new Date();
		if (orcamento.prazoAprovacaoExpirado(agora)) return SR.unprocessableEntity(undefined, "Prazo de aprovação expirado");

		const prazoPagamentoEm = new Date(agora.getTime() + orcamento.prazoPagamentoMinutos * 60_000);
		const cobranca = await this.pagamentos.criarCobranca({
			orcamentoId: orcamento.id,
			numeroOs: orcamento.numeroOs,
			itens: orcamento.itens.map(({ referenciaId, descricao, quantidade, precoUnitarioCentavos }) => ({
				referenciaId,
				descricao,
				quantidade,
				precoUnitarioCentavos,
			})),
			valorTotalCentavos: orcamento.valorTotalCentavos,
			expiraEm: prazoPagamentoEm,
		});

		const resposta = { linkPagamento: cobranca.linkPagamento, prazoPagamentoEm: prazoPagamentoEm.toISOString() };
		const evento = criarEventoBilling(contextoDoOrcamento(orcamento, correlationId), "OrcamentoAprovado", {
			orcamentoId: orcamento.id,
			...resposta,
		});
		try {
			await this.eventos.atualizar(orcamento.aprovar(cobranca, prazoPagamentoEm, agora), orcamento.versao, { eventos: [evento] });
		} catch (erro) {
			if (!(erro instanceof ConflitoConcorrenciaError)) throw erro;
			// A preferência criada expira sozinha no prazo; nenhum evento de aprovação sai.
			return SR.unprocessableEntity(undefined, "Orçamento foi alterado durante a aprovação (ex.: cancelado pela oficina)");
		}
		this.logger.log({
			event: "billing.orcamento.aprovado",
			orcamentoId: orcamento.id,
			fluxoId: orcamento.fluxoId,
			osId: orcamento.osId,
		});
		return SR.ok(resposta, "Orçamento aprovado");
	}
}
