import type { EventosOrcamentoService } from "../../application/services/eventos-orcamento.service";
import { RepublicacaoEventosJob } from "./republicacao-eventos.job";

describe("RepublicacaoEventosJob", () => {
	const eventos = { republicarPendentes: jest.fn() };
	const job = new RepublicacaoEventosJob(eventos as unknown as EventosOrcamentoService);

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.WORKERS_HABILITADOS;
	});

	it.each([0, 3])("republica os pendentes (%i encontrados)", async (quantidade) => {
		eventos.republicarPendentes.mockResolvedValue(quantidade);
		await job.executar();
		expect(eventos.republicarPendentes).toHaveBeenCalledTimes(1);
	});

	it("erro é registrado e não propaga", async () => {
		eventos.republicarPendentes.mockRejectedValue(new Error("DynamoDB fora"));
		await expect(job.executar()).resolves.toBeUndefined();
	});

	it("ignora disparo enquanto a execução anterior não terminou", async () => {
		let terminar!: (n: number) => void;
		eventos.republicarPendentes.mockReturnValue(new Promise<number>((resolve) => (terminar = resolve)));

		const primeira = job.executar();
		await job.executar();
		terminar(0);
		await primeira;

		expect(eventos.republicarPendentes).toHaveBeenCalledTimes(1);
	});

	it("não faz nada com WORKERS_HABILITADOS=false", async () => {
		process.env.WORKERS_HABILITADOS = "false";
		await job.executar();
		expect(eventos.republicarPendentes).not.toHaveBeenCalled();
	});
});
