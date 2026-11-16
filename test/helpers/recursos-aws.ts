import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateTopicCommand, SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import {
	CreateQueueCommand,
	DeleteMessageBatchCommand,
	GetQueueAttributesCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { setTimeout as esperar } from "node:timers/promises";
import type { EnvelopeMensagem } from "../../src/modules/mensageria/envelope";

export interface RecursosBilling {
	tabela: string;
	topicoArn: string;
	filaComandosUrl: string;
	dlqComandosUrl: string;
	filaOrquestradorUrl: string;
}

/** Cria no emulador os mesmos recursos de homolog/prod (tabela da infra de dados, tópico e filas do contrato) e aponta o app para eles. */
export async function criarRecursosBilling(prefixo: string): Promise<RecursosBilling> {
	const dynamo = new DynamoDBClient({});
	const sns = new SNSClient({});
	const sqs = new SQSClient({});
	try {
		const tabela = `${prefixo}-billing`;
		await dynamo.send(
			new CreateTableCommand({
				TableName: tabela,
				BillingMode: "PAY_PER_REQUEST",
				AttributeDefinitions: [
					{ AttributeName: "pk", AttributeType: "S" },
					{ AttributeName: "sk", AttributeType: "S" },
					{ AttributeName: "gsi1pk", AttributeType: "S" },
					{ AttributeName: "gsi1sk", AttributeType: "S" },
				],
				KeySchema: [
					{ AttributeName: "pk", KeyType: "HASH" },
					{ AttributeName: "sk", KeyType: "RANGE" },
				],
				GlobalSecondaryIndexes: [
					{
						IndexName: "gsi1",
						KeySchema: [
							{ AttributeName: "gsi1pk", KeyType: "HASH" },
							{ AttributeName: "gsi1sk", KeyType: "RANGE" },
						],
						Projection: { ProjectionType: "ALL" },
					},
				],
			}),
		);

		const arnDaFila = async (url: string) =>
			(await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }))).Attributes!.QueueArn!;

		const dlq = await sqs.send(new CreateQueueCommand({ QueueName: `${prefixo}-billing-comandos-dlq` }));
		const comandos = await sqs.send(
			new CreateQueueCommand({
				QueueName: `${prefixo}-billing-comandos`,
				Attributes: {
					VisibilityTimeout: "5",
					RedrivePolicy: JSON.stringify({ deadLetterTargetArn: await arnDaFila(dlq.QueueUrl!), maxReceiveCount: 5 }),
				},
			}),
		);

		const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: `${prefixo}-eventos` }));
		const orquestrador = await sqs.send(new CreateQueueCommand({ QueueName: `${prefixo}-os-orquestrador-eventos` }));
		await sns.send(
			new SubscribeCommand({
				TopicArn,
				Protocol: "sqs",
				Endpoint: await arnDaFila(orquestrador.QueueUrl!),
				Attributes: {
					RawMessageDelivery: "true",
					FilterPolicyScope: "MessageAttributes",
					FilterPolicy: JSON.stringify({ origem: ["billing", "execution"] }),
				},
			}),
		);

		const recursos = {
			tabela,
			topicoArn: TopicArn!,
			filaComandosUrl: comandos.QueueUrl!,
			dlqComandosUrl: dlq.QueueUrl!,
			filaOrquestradorUrl: orquestrador.QueueUrl!,
		};
		process.env.DYNAMODB_TABLE = recursos.tabela;
		process.env.SNS_EVENTOS_ARN = recursos.topicoArn;
		process.env.SQS_BILLING_COMANDOS_URL = recursos.filaComandosUrl;
		return recursos;
	} finally {
		dynamo.destroy();
		sns.destroy();
		sqs.destroy();
	}
}

export interface EventoRecebido {
	envelope: EnvelopeMensagem<any>;
	atributos: Record<string, string | undefined>;
}

type FiltroEvento = (evento: EventoRecebido) => boolean;

/** Lê a fila do orquestrador (o que o os-service receberia) e acumula os eventos com os MessageAttributes. */
export class ColetorEventos {
	private readonly recebidos: EventoRecebido[] = [];

	constructor(
		private readonly sqs: SQSClient,
		private readonly filaUrl: string,
	) {}

	async aguardar(filtro: FiltroEvento, timeoutMs = 20_000): Promise<EventoRecebido> {
		const limite = Date.now() + timeoutMs;
		for (;;) {
			const achado = this.recebidos.find(filtro);
			if (achado) return achado;
			if (Date.now() > limite) throw new Error(`Evento esperado não chegou em ${timeoutMs}ms`);
			await this.ler();
		}
	}

	/** Falha se algum evento novo (chegado a partir de agora) casar com o filtro durante a janela. */
	async nenhumEm(filtro: FiltroEvento, janelaMs: number): Promise<void> {
		const inicio = this.recebidos.length;
		const limite = Date.now() + janelaMs;
		while (Date.now() < limite) await this.ler();
		const indevidos = this.recebidos.slice(inicio).filter(filtro);
		if (indevidos.length > 0) throw new Error(`Eventos inesperados: ${indevidos.map((e) => e.envelope.tipo).join(", ")}`);
	}

	private async ler(): Promise<void> {
		const r = await this.sqs.send(
			new ReceiveMessageCommand({
				QueueUrl: this.filaUrl,
				MaxNumberOfMessages: 10,
				WaitTimeSeconds: 1,
				MessageAttributeNames: ["All"],
			}),
		);
		const mensagens = r.Messages ?? [];
		if (mensagens.length === 0) {
			await esperar(200);
			return;
		}
		for (const m of mensagens) {
			const atributos = Object.fromEntries(Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [k, v.StringValue]));
			this.recebidos.push({ envelope: JSON.parse(m.Body!) as EnvelopeMensagem<any>, atributos });
		}
		await this.sqs.send(
			new DeleteMessageBatchCommand({
				QueueUrl: this.filaUrl,
				Entries: mensagens.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle! })),
			}),
		);
	}
}
