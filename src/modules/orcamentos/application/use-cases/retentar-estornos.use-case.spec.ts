import { orcamentoNovo, orcamentoPago } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import type { Orcamento } from "../../domain/orcamento.entity";
import { ConflitoConcorrenciaError } from "../ports/orcamentos.gateway";
import type { EstornoService } from "../services/estorno.service";
import { RetentarEstornosUseCase } from "./retentar-estornos.use-case";

const agora = new Date("2026-10-20T13:00:00.000Z");

const pendente = (id: string, proximaTentativaEm: Date): Orcamento =>
	orcamentoNovo({ id, osId: `os-${id}`, numeroOs: `OS-${id}` })
		.aprovar({ linkPagamento: "https://x", preferenciaId: "p" }, new Date(agora.getTime() + 3_600_000), agora)
		.confirmarPagamento({ pagamentoId: `pag-${id}`, valorCentavos: 30000, pagoEm: agora }, agora)
		.registrarFalhaEstorno("fora do ar", proximaTentativaEm, agora);

describe("RetentarEstornosUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	const estorno = { estornar: jest.fn() };
	let uc: RetentarEstornosUseCase;

	beforeEach(() => {
		jest.clearAllMocks();
		estorno.estornar.mockResolvedValue("ESTORNADO");
		gateway = new OrcamentosMemoriaGateway();
		uc = new RetentarEstornosUseCase(gateway, estorno as unknown as EstornoService);
	});

	const salvar = (...orcamentos: Orcamento[]) => orcamentos.forEach((o) => gateway.orcamentos.set(o.id, o.paraDados()));
	const tentados = () => estorno.estornar.mock.calls.map(([o]) => (o as Orcamento).id);

	it("tenta só os pendentes com a próxima tentativa vencida", async () => {
		salvar(
			pendente("vencido", new Date(agora.getTime() - 1000)),
			pendente("futuro", new Date(agora.getTime() + 60_000)),
			orcamentoPago(),
		);

		await expect(uc.execute(agora)).resolves.toBe(1);

		expect(tentados()).toEqual(["vencido"]);
		expect(estorno.estornar.mock.calls[0][1]).toMatchObject({ correlationId: "retentativa-estorno-vencido" });
		expect(estorno.estornar.mock.calls[0][2]).toBeUndefined();
	});

	it("erro num orçamento não interrompe os outros", async () => {
		salvar(pendente("a", agora), pendente("b", agora));
		estorno.estornar.mockRejectedValueOnce(new ConflitoConcorrenciaError("a"));

		await expect(uc.execute(agora)).resolves.toBe(2);

		expect(tentados()).toEqual(["a", "b"]);
	});

	it("sem pendentes não faz nada", async () => {
		await expect(uc.execute(agora)).resolves.toBe(0);
		expect(estorno.estornar).not.toHaveBeenCalled();
	});
});
