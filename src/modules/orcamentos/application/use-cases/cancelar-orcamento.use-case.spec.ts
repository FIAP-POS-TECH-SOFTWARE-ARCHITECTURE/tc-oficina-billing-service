import { comandoComMotivo, comandoGerarOrcamento, orcamentoNovo, orcamentoPago } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { CancelarOrcamentoUseCase } from "./cancelar-orcamento.use-case";
import { GerarOrcamentoUseCase } from "./gerar-orcamento.use-case";

const COBRANCA = { linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" };

describe("CancelarOrcamentoUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let uc: CancelarOrcamentoUseCase;
	let gerar: GerarOrcamentoUseCase;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		const eventos = new EventosOrcamentoService(gateway, publicador);
		uc = new CancelarOrcamentoUseCase(gateway, eventos);
		gerar = new GerarOrcamentoUseCase(gateway, eventos);
	});

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};

	it("sem orçamento: registra o cancelamento antecipado e o GerarOrcamento seguinte não cria nada", async () => {
		const cancelar = comandoComMotivo("CancelarOrcamento", "PRAZO_RESPOSTA_SERVICO");

		await uc.execute(cancelar);
		await gerar.execute(comandoGerarOrcamento());

		expect(gateway.cancelamentos.get(cancelar.fluxoId)).toMatchObject({ osId: cancelar.osId, motivo: "PRAZO_RESPOSTA_SERVICO" });
		expect(gateway.contarPorOs(cancelar.osId)).toBe(0);
		expect(publicador.doTipo("OrcamentoCancelado").map((e) => e.payload)).toEqual([
			{ orcamentoId: null, motivo: "PRAZO_RESPOSTA_SERVICO" },
			{ orcamentoId: null, motivo: "PRAZO_RESPOSTA_SERVICO" },
		]);
	});

	it.each([
		["AGUARDANDO_APROVACAO", () => orcamentoNovo()],
		["APROVADO", () => orcamentoNovo().aprovar(COBRANCA, new Date(Date.now() + 60_000), new Date())],
	])("%s → CANCELADO com evento", async (_status, montar) => {
		const orcamento = salvar(montar());

		await uc.execute(comandoComMotivo("CancelarOrcamento"));

		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.CANCELADO);
		expect(publicador.doTipo("OrcamentoCancelado").map((e) => e.payload)).toEqual([
			{ orcamentoId: orcamento.id, motivo: "PRAZO_PAGAMENTO_EXPIRADO" },
		]);
	});

	it.each([
		["CANCELADO", () => orcamentoNovo().cancelar("antes", new Date())],
		["REJEITADO", () => orcamentoNovo().rejeitar(null, new Date())],
	])("%s mantém o status e reemite o evento", async (status, montar) => {
		const orcamento = salvar(montar());

		await uc.execute(comandoComMotivo("CancelarOrcamento"));

		const atual = await gateway.buscarPorId(orcamento.id);
		expect(atual?.status).toBe(status);
		expect(atual?.versao).toBe(orcamento.versao);
		expect(publicador.doTipo("OrcamentoCancelado")).toHaveLength(1);
	});

	it("PAGO mantém o status, grava o cancelamento e publica o evento", async () => {
		const orcamento = salvar(orcamentoPago());

		await uc.execute(comandoComMotivo("CancelarOrcamento", "PRAZO_REPARO"));

		const atual = await gateway.buscarPorId(orcamento.id);
		expect(atual?.status).toBe(StatusOrcamento.PAGO);
		expect(atual?.canceladoEm).not.toBeNull();
		expect(publicador.doTipo("OrcamentoCancelado").map((e) => e.payload)).toEqual([
			{ orcamentoId: orcamento.id, motivo: "PRAZO_REPARO" },
		]);
	});

	it("comando duplicado não faz nada", async () => {
		salvar(orcamentoNovo());
		const comando = comandoComMotivo("CancelarOrcamento");

		await uc.execute(comando);
		await uc.execute(comando);

		expect(publicador.doTipo("OrcamentoCancelado")).toHaveLength(1);
	});
});
