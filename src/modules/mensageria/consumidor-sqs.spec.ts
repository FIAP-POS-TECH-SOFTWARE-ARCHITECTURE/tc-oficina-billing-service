import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConsumidorSqs } from "./consumidor-sqs";
import { ValidadorContratos } from "./validador-contratos";

const FILA = "http://localhost:4566/000000000000/oficina-teste-billing-comandos";
const EXEMPLO = readFileSync(join(process.cwd(), "contratos", "exemplos", "GerarOrcamento.json"), "utf8");

describe("ConsumidorSqs", () => {
	const sqsMock = mockClient(SQSClient);
	let consumidor: ConsumidorSqs;

	const receber = (...corpos: string[]) =>
		sqsMock.on(ReceiveMessageCommand).resolves({
			Messages: corpos.map((Body, i) => ({ Body, MessageId: `sqs-${i}`, ReceiptHandle: `rh-${i}` })),
		});

	beforeEach(() => {
		sqsMock.reset();
		sqsMock.on(DeleteMessageCommand).resolves({});
		consumidor = new ConsumidorSqs(new SQSClient({ region: "us-east-1" }), new ValidadorContratos());
	});

	afterEach(() => consumidor.onApplicationShutdown());

	it("faz long polling em lote de 10 e apaga a mensagem depois do sucesso", async () => {
		receber(EXEMPLO);
		const manipulador = jest.fn().mockResolvedValue(undefined);

		await expect(consumidor.processarLote(FILA, manipulador)).resolves.toBe(1);

		expect(sqsMock.commandCalls(ReceiveMessageCommand)[0].args[0].input).toMatchObject({
			QueueUrl: FILA,
			MaxNumberOfMessages: 10,
			WaitTimeSeconds: 20,
			MessageAttributeNames: ["All"],
		});
		expect(manipulador).toHaveBeenCalledWith(
			expect.objectContaining({ tipo: "GerarOrcamento", osId: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" }),
		);
		expect(sqsMock.commandCalls(DeleteMessageCommand)[0].args[0].input).toEqual({ QueueUrl: FILA, ReceiptHandle: "rh-0" });
	});

	it("não apaga quando o manipulador falha (volta à fila; 5 falhas → DLQ)", async () => {
		receber(EXEMPLO);
		await consumidor.processarLote(FILA, jest.fn().mockRejectedValue(new Error("DynamoDB fora")), 0);
		expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
	});

	it.each([
		["JSON inválido", "{nao-e-json"],
		["fora do contrato", JSON.stringify({ ...JSON.parse(EXEMPLO), payload: {} })],
	])("mensagem com %s não chega ao manipulador e não é apagada", async (_caso, corpo) => {
		receber(corpo);
		const manipulador = jest.fn();
		await consumidor.processarLote(FILA, manipulador, 0);
		expect(manipulador).not.toHaveBeenCalled();
		expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
	});

	it("fila vazia devolve 0", async () => {
		sqsMock.on(ReceiveMessageCommand).resolves({});
		await expect(consumidor.processarLote(FILA, jest.fn(), 0)).resolves.toBe(0);
	});

	it("iniciar consome em laço até o desligamento", async () => {
		receber(EXEMPLO);
		let avisar!: () => void;
		const chamado = new Promise<void>((resolve) => (avisar = resolve));
		const manipulador = jest.fn(() => {
			avisar();
			return Promise.resolve();
		});

		consumidor.iniciar(FILA, manipulador);
		await chamado;
		await consumidor.onApplicationShutdown();

		expect(manipulador).toHaveBeenCalled();
	});

	it("erro de rede no recebimento não derruba o laço e o desligamento interrompe a espera", async () => {
		sqsMock.on(ReceiveMessageCommand).rejects(new Error("rede"));
		consumidor.iniciar(FILA, jest.fn());
		await new Promise((resolve) => setImmediate(resolve));
		await consumidor.onApplicationShutdown();
		expect(sqsMock.commandCalls(ReceiveMessageCommand).length).toBeGreaterThanOrEqual(1);
	});
});
