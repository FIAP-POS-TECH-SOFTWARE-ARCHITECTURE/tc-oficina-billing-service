import type { RetentarEstornosUseCase } from "../../application/use-cases/retentar-estornos.use-case";
import { RetentativaEstornosJob } from "./retentativa-estornos.job";

describe("RetentativaEstornosJob", () => {
	const retentar = { execute: jest.fn() };
	const job = new RetentativaEstornosJob(retentar as unknown as RetentarEstornosUseCase);

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.WORKERS_HABILITADOS;
	});

	it.each([0, 2])("retenta os estornos pendentes (%i encontrados)", async (quantidade) => {
		retentar.execute.mockResolvedValue(quantidade);
		await job.executar();
		expect(retentar.execute).toHaveBeenCalledTimes(1);
	});

	it("erro é registrado e não propaga", async () => {
		retentar.execute.mockRejectedValue(new Error("DynamoDB fora"));
		await expect(job.executar()).resolves.toBeUndefined();
	});

	it("ignora disparo enquanto a execução anterior não terminou", async () => {
		let terminar!: (n: number) => void;
		retentar.execute.mockReturnValue(new Promise<number>((resolve) => (terminar = resolve)));

		const primeira = job.executar();
		await job.executar();
		terminar(0);
		await primeira;

		expect(retentar.execute).toHaveBeenCalledTimes(1);
	});

	it("não faz nada com WORKERS_HABILITADOS=false", async () => {
		process.env.WORKERS_HABILITADOS = "false";
		await job.executar();
		expect(retentar.execute).not.toHaveBeenCalled();
	});
});
