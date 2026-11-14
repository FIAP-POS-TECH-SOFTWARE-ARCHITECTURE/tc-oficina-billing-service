import {
	Body,
	Controller,
	Headers,
	HttpCode,
	Logger,
	Post,
	Query,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { Public } from "../../../common/decorators/public.decorator";
import { executarComContextoLog } from "../../../common/logging/contexto-log";
import { mensagemDeErro } from "../../../common/utils/erro.util";
import { ErroGatewayPagamento } from "../application/ports/gateway-pagamento.port";
import { ConflitoConcorrenciaError } from "../application/ports/orcamentos.gateway";
import { ProcessarNotificacaoPagamentoUseCase } from "../application/use-cases/processar-notificacao-pagamento.use-case";
import { validarAssinaturaMercadoPago } from "./webhook/assinatura-mercado-pago";

const texto = (valor: unknown): string | undefined =>
	typeof valor === "string" || typeof valor === "number" ? String(valor) : undefined;

// A doc de notificações usa `type=order`; a página de status da order cita o tópico `orders_v2`. Os dois são aceitos.
const TIPOS_NOTIFICACAO_ORDER = new Set(["order", "orders_v2"]);

@ApiTags("Webhooks")
@Controller("billing/webhooks")
export class WebhookMercadoPagoController {
	private readonly logger = new Logger(WebhookMercadoPagoController.name);

	constructor(private readonly processar: ProcessarNotificacaoPagamentoUseCase) {}

	@Public()
	@Post("mercado-pago")
	@HttpCode(200)
	@ApiOperation({ summary: "Notificação de order do Mercado Pago (valida x-signature; consulta a order na API)" })
	async receber(
		@Headers("x-signature") assinatura: string | undefined,
		@Headers("x-request-id") requestId: string | undefined,
		// Tipos abertos de propósito: a ValidationPipe só valida classes, e o Mercado Pago envia campos que variam.
		@Query() query: Record<string, unknown>,
		@Body() corpo: Record<string, unknown>,
	) {
		const dados = (corpo?.data ?? {}) as Record<string, unknown>;
		const dataId = texto(query["data.id"]) ?? texto(dados.id);
		const resultado = validarAssinaturaMercadoPago({
			assinatura,
			requestId,
			dataId,
			segredo: process.env.MERCADO_PAGO_WEBHOOK_SECRET ?? "",
			agora: new Date(),
		});
		if (!resultado.valida) {
			this.logger.warn({ event: "billing.webhook.assinatura-invalida", motivo: resultado.motivo, dataId });
			throw new UnauthorizedException("Assinatura do Mercado Pago inválida");
		}

		const tipo = texto(query.type) ?? texto(query.topic) ?? texto(corpo?.type);
		if (!tipo || !TIPOS_NOTIFICACAO_ORDER.has(tipo) || !dataId) {
			this.logger.log({ event: "billing.webhook.ignorado", tipo, dataId });
			return { processado: false };
		}

		const correlationId = requestId?.split(",")[0].trim() || randomUUID();
		return executarComContextoLog({ messageId: correlationId }, async () => {
			try {
				const r = await this.processar.execute(dataId, correlationId);
				this.logger.log({ event: "billing.webhook.processado", pagamentoId: dataId, resultado: r });
				return { processado: true, resultado: r };
			} catch (erro) {
				const temporario = erro instanceof ConflitoConcorrenciaError || (erro instanceof ErroGatewayPagamento && erro.temporario);
				if (!temporario) throw erro;
				this.logger.warn({ event: "billing.webhook.reenvio-solicitado", pagamentoId: dataId, erro: mensagemDeErro(erro) });
				throw new ServiceUnavailableException("Falha temporária; o Mercado Pago reenviará a notificação");
			}
		});
	}
}
