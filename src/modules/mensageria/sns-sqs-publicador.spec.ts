import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { criarEnvelope } from "./envelope";
import { SnsSqsPublicador } from "./sns-sqs-publicador";

describe("SnsSqsPublicador", () => {
	const snsMock = mockClient(SNSClient);
	const sqsMock = mockClient(SQSClient);
	const publicador = new SnsSqsPublicador(new SNSClient({ region: "us-east-1" }), new SQSClient({ region: "us-east-1" }));
	const envelope = criarEnvelope({
		tipo: "OrcamentoCancelado",
		origem: "billing",
		fluxoId: "f",
		osId: "o",
		numeroOs: "OS-1",
		correlationId: "c",
		payload: { orcamentoId: null, motivo: "x" },
	});

	beforeEach(() => {
		snsMock.reset();
		sqsMock.reset();
		process.env.SNS_EVENTOS_ARN = "arn:aws:sns:us-east-1:000000000000:oficina-teste-eventos";
	});

	it("publica evento no tópico com corpo JSON e atributos tipo/origem", async () => {
		snsMock.on(PublishCommand).resolves({ MessageId: "sns-1" });
		await publicador.publicarEvento(envelope);
		expect(snsMock.commandCalls(PublishCommand)[0].args[0].input).toEqual({
			TopicArn: "arn:aws:sns:us-east-1:000000000000:oficina-teste-eventos",
			Message: JSON.stringify(envelope),
			MessageAttributes: {
				tipo: { DataType: "String", StringValue: "OrcamentoCancelado" },
				origem: { DataType: "String", StringValue: "billing" },
			},
		});
	});

	it("falha explicitamente sem SNS_EVENTOS_ARN", async () => {
		delete process.env.SNS_EVENTOS_ARN;
		await expect(publicador.publicarEvento(envelope)).rejects.toThrow("SNS_EVENTOS_ARN");
	});

	it("envia comando para a fila informada", async () => {
		sqsMock.on(SendMessageCommand).resolves({ MessageId: "sqs-1" });
		await publicador.enviarComando("http://fila", envelope);
		expect(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input).toMatchObject({
			QueueUrl: "http://fila",
			MessageBody: JSON.stringify(envelope),
		});
	});
});
