import { comandoComMotivo, orcamentoNovo } from "../../../../test/suporte/fabricas";
import { contextoDoComando, contextoDoOrcamento, criarEventoBilling } from "./eventos-billing";

describe("eventos do billing", () => {
	const contexto = { fluxoId: "f-1", osId: "os-1", numeroOs: "OS-1", correlationId: "req-1" };

	it("criarEventoBilling sai com origem billing e o contexto do fluxo", () => {
		const evento = criarEventoBilling(contexto, "OrcamentoCancelado", { orcamentoId: null, motivo: "x" });
		expect(evento).toMatchObject({
			...contexto,
			tipo: "OrcamentoCancelado",
			origem: "billing",
			versao: 1,
			payload: { orcamentoId: null, motivo: "x" },
		});
	});

	it("contextoDoComando mantém o correlationId do comando", () => {
		const comando = comandoComMotivo("CancelarOrcamento");
		expect(contextoDoComando(comando)).toEqual({
			fluxoId: comando.fluxoId,
			osId: comando.osId,
			numeroOs: comando.numeroOs,
			correlationId: comando.correlationId,
		});
	});

	it("contextoDoOrcamento usa o correlationId informado", () => {
		const orcamento = orcamentoNovo();
		expect(contextoDoOrcamento(orcamento, "req-http")).toEqual({
			fluxoId: orcamento.fluxoId,
			osId: orcamento.osId,
			numeroOs: orcamento.numeroOs,
			correlationId: "req-http",
		});
	});
});
