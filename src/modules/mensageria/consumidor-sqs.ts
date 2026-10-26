import { DeleteMessageCommand, type Message, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Inject, Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { CLIENTE_SQS } from "../../common/aws/clientes-aws";
import { executarComContextoLog } from "../../common/logging/contexto-log";
import { mensagemDeErro } from "../../common/utils/erro.util";
import type { EnvelopeMensagem } from "./envelope";
import { ValidadorContratos } from "./validador-contratos";

export type ManipuladorMensagem = (envelope: EnvelopeMensagem<unknown>) => Promise<void>;

const PAUSA_APOS_ERRO_MS = 5000;

const esperar = (ms: number, sinal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		sinal.addEventListener("abort", () => {
			clearTimeout(timer);
			resolve();
		});
	});

@Injectable()
export class ConsumidorSqs implements OnApplicationShutdown {
	private readonly logger = new Logger(ConsumidorSqs.name);
	private readonly abortador = new AbortController();
	private readonly lacos: Promise<void>[] = [];
	private ativo = false;

	constructor(
		@Inject(CLIENTE_SQS) private readonly sqs: SQSClient,
		private readonly validador: ValidadorContratos,
	) {}

	iniciar(filaUrl: string, manipulador: ManipuladorMensagem): void {
		this.ativo = true;
		this.lacos.push(this.laco(filaUrl, manipulador));
		this.logger.log({ event: "mensageria.consumidor.iniciado", filaUrl });
	}

	async onApplicationShutdown(): Promise<void> {
		this.ativo = false;
		this.abortador.abort();
		await Promise.allSettled(this.lacos);
	}

	async processarLote(filaUrl: string, manipulador: ManipuladorMensagem, esperaSegundos = 20): Promise<number> {
		const resposta = await this.sqs.send(
			new ReceiveMessageCommand({
				QueueUrl: filaUrl,
				MaxNumberOfMessages: 10,
				WaitTimeSeconds: esperaSegundos,
				MessageAttributeNames: ["All"],
				MessageSystemAttributeNames: ["ApproximateReceiveCount"],
			}),
			{ abortSignal: this.abortador.signal },
		);
		const mensagens = resposta.Messages ?? [];
		for (const mensagem of mensagens) await this.processarMensagem(filaUrl, mensagem, manipulador);
		return mensagens.length;
	}

	private async laco(filaUrl: string, manipulador: ManipuladorMensagem): Promise<void> {
		while (this.ativo) {
			try {
				await this.processarLote(filaUrl, manipulador);
			} catch (erro) {
				if (!this.ativo) break;
				this.logger.error({ event: "mensageria.receber.falhou", filaUrl, erro: mensagemDeErro(erro) });
				await esperar(PAUSA_APOS_ERRO_MS, this.abortador.signal);
			}
		}
	}

	private async processarMensagem(filaUrl: string, mensagem: Message, manipulador: ManipuladorMensagem): Promise<void> {
		let corpo: unknown;
		try {
			corpo = JSON.parse(mensagem.Body ?? "");
		} catch {
			this.logger.error({ event: "mensageria.mensagem.json-invalido", sqsMessageId: mensagem.MessageId });
			return;
		}

		const validacao = this.validador.validar(corpo);
		if (!validacao.valido) {
			// Não apaga: após maxReceiveCount a mensagem vai para a DLQ (monitorada), sem perder o comando.
			this.logger.error({ event: "mensageria.mensagem.fora-do-contrato", sqsMessageId: mensagem.MessageId, erros: validacao.erros });
			return;
		}

		const envelope = corpo as EnvelopeMensagem<unknown>;
		const campos = { fluxoId: envelope.fluxoId, osId: envelope.osId, messageId: envelope.messageId, tipo: envelope.tipo };
		await executarComContextoLog(campos, async () => {
			try {
				await manipulador(envelope);
				await this.sqs.send(new DeleteMessageCommand({ QueueUrl: filaUrl, ReceiptHandle: mensagem.ReceiptHandle }));
				this.logger.log({ event: "mensageria.mensagem.processada" });
			} catch (erro) {
				this.logger.error({
					event: "mensageria.mensagem.falhou",
					recebimentos: mensagem.Attributes?.ApproximateReceiveCount,
					erro: mensagemDeErro(erro),
				});
			}
		});
	}
}
