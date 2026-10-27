import type { Request } from "express";
import type { AprovarOrcamentoUseCase } from "../application/use-cases/aprovar-orcamento.use-case";
import type { ConsultarOrcamentoClienteUseCase } from "../application/use-cases/consultar-orcamento-cliente.use-case";
import type { ConsultarOrcamentoUseCase } from "../application/use-cases/consultar-orcamento.use-case";
import type { ListarOrcamentosUseCase } from "../application/use-cases/listar-orcamentos.use-case";
import type { RejeitarOrcamentoUseCase } from "../application/use-cases/rejeitar-orcamento.use-case";
import { StatusOrcamento } from "../domain/status-orcamento";
import { OrcamentosClienteController } from "./orcamentos-cliente.controller";
import { OrcamentosController } from "./orcamentos.controller";

const OK = { status: 200, success: true, data: {} };
const cliente = { id: "c-1", nome: "Maria", cpf: "52998224725" };
const req = { id: "req-1", headers: {} } as unknown as Request;

describe("OrcamentosClienteController", () => {
	const consultar = { execute: jest.fn().mockResolvedValue(OK) };
	const aprovar = { execute: jest.fn().mockResolvedValue(OK) };
	const rejeitar = { execute: jest.fn().mockResolvedValue(OK) };
	const controller = new OrcamentosClienteController(
		consultar as unknown as ConsultarOrcamentoClienteUseCase,
		aprovar as unknown as AprovarOrcamentoUseCase,
		rejeitar as unknown as RejeitarOrcamentoUseCase,
	);

	beforeEach(() => jest.clearAllMocks());

	it("consultar repassa número da OS e cliente autenticado", async () => {
		await expect(controller.consultar("OS-1", cliente)).resolves.toBe(OK);
		expect(consultar.execute).toHaveBeenCalledWith("OS-1", "c-1");
	});

	it("aprovar repassa o correlationId da requisição", async () => {
		await controller.aprovar("OS-1", cliente, req);
		expect(aprovar.execute).toHaveBeenCalledWith("OS-1", "c-1", "req-1");
	});

	it("rejeitar repassa o motivo ou null", async () => {
		await controller.rejeitar("OS-1", { motivo: "caro" }, cliente, req);
		await controller.rejeitar("OS-1", {}, cliente, req);
		expect(rejeitar.execute.mock.calls).toEqual([
			["OS-1", "c-1", "caro", "req-1"],
			["OS-1", "c-1", null, "req-1"],
		]);
	});
});

describe("OrcamentosController", () => {
	const listar = { execute: jest.fn().mockResolvedValue(OK) };
	const consultar = { execute: jest.fn().mockResolvedValue(OK) };
	const controller = new OrcamentosController(
		listar as unknown as ListarOrcamentosUseCase,
		consultar as unknown as ConsultarOrcamentoUseCase,
	);

	it("listar repassa o filtro de status", async () => {
		await controller.listar({ status: StatusOrcamento.PAGO });
		await controller.listar({});
		expect(listar.execute.mock.calls).toEqual([[StatusOrcamento.PAGO], [undefined]]);
	});

	it("consultar repassa o número da OS", async () => {
		await controller.consultar("OS-1");
		expect(consultar.execute).toHaveBeenCalledWith("OS-1");
	});
});
