import { CLIENTE_ID, OUTRO_CLIENTE_ID, orcamentoNovo } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { ConflitoConcorrenciaError } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { RejeitarOrcamentoUseCase } from "./rejeitar-orcamento.use-case";

describe("RejeitarOrcamentoUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let uc: RejeitarOrcamentoUseCase;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		uc = new RejeitarOrcamentoUseCase(gateway, new EventosOrcamentoService(gateway, publicador));
	});

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};

	it("404 sem orçamento", async () => {
		await expect(uc.execute("OS-X", CLIENTE_ID, null, "req-1")).resolves.toMatchObject({ status: 404 });
	});

	it("403 para outro cliente", async () => {
		const orcamento = salvar(orcamentoNovo());
		await expect(uc.execute(orcamento.numeroOs, OUTRO_CLIENTE_ID, null, "req-1")).resolves.toMatchObject({ status: 403 });
		expect(publicador.eventos).toHaveLength(0);
	});

	it("422 para orçamento que não aguarda aprovação", async () => {
		const orcamento = salvar(orcamentoNovo().cancelar("x", new Date()));
		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, null, "req-1")).resolves.toMatchObject({ status: 422 });
	});

	it.each([null, "Valor acima do esperado"])("200 rejeita com motivo %p e publica OrcamentoRejeitado", async (motivo) => {
		const orcamento = salvar(orcamentoNovo());

		const resposta = await uc.execute(orcamento.numeroOs, CLIENTE_ID, motivo, "req-1");

		expect(resposta).toMatchObject({ status: 200, data: { id: orcamento.id, status: StatusOrcamento.REJEITADO } });
		expect(publicador.doTipo("OrcamentoRejeitado")).toEqual([
			expect.objectContaining({ correlationId: "req-1", payload: { orcamentoId: orcamento.id, motivo } }),
		]);
	});

	it("conflito de concorrência → 422 sem evento", async () => {
		const orcamento = salvar(orcamentoNovo());
		jest.spyOn(gateway, "atualizar").mockRejectedValue(new ConflitoConcorrenciaError(orcamento.id));
		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, null, "req-1")).resolves.toMatchObject({ status: 422 });
		expect(publicador.eventos).toHaveLength(0);
	});

	it("outros erros de gravação propagam", async () => {
		const orcamento = salvar(orcamentoNovo());
		jest.spyOn(gateway, "atualizar").mockRejectedValue(new Error("DynamoDB fora"));
		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, null, "req-1")).rejects.toThrow("DynamoDB fora");
	});
});
