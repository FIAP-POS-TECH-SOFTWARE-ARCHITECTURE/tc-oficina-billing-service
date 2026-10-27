import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";
import { CLIENTE_SNS, CLIENTE_SQS } from "../../common/aws/clientes-aws";
import { montarAtributos } from "./atributos-mensagem";
import type { EnvelopeMensagem } from "./envelope";
import type { PublicadorMensagensPort } from "./publicador-mensagens.port";

@Injectable()
export class SnsSqsPublicador implements PublicadorMensagensPort {
	constructor(
		@Inject(CLIENTE_SNS) private readonly sns: SNSClient,
		@Inject(CLIENTE_SQS) private readonly sqs: SQSClient,
	) {}

	async enviarComando(fila: string, envelope: EnvelopeMensagem<unknown>): Promise<void> {
		await this.sqs.send(
			new SendMessageCommand({ QueueUrl: fila, MessageBody: JSON.stringify(envelope), MessageAttributes: montarAtributos(envelope) }),
		);
	}

	async publicarEvento(envelope: EnvelopeMensagem<unknown>): Promise<void> {
		const topico = process.env.SNS_EVENTOS_ARN;
		if (!topico) throw new Error("SNS_EVENTOS_ARN não definido");
		await this.sns.send(
			new PublishCommand({ TopicArn: topico, Message: JSON.stringify(envelope), MessageAttributes: montarAtributos(envelope) }),
		);
	}
}
