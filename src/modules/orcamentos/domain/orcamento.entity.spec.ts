import { CLIENTE_ID, OUTRO_CLIENTE_ID, orcamentoNovo, orcamentoPago } from "../../../../test/suporte/fabricas";
import { Orcamento, TransicaoInvalidaError, ValorTotalInconsistenteError } from "./orcamento.entity";
import { StatusOrcamento } from "./status-orcamento";

const COBRANCA = { linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" };
const agora = () => new Date("2026-10-20T14:00:00.000Z");
const depois = (minutos: number) => new Date(agora().getTime() + minutos * 60_000);

describe("Orcamento", () => {
	it("criar inicia aguardando aprovação na versão 1, sem campos opcionais e com cópia dos itens", () => {
		const dados = orcamentoNovo({}, agora()).paraDados();

		expect(dados.status).toBe(StatusOrcamento.AGUARDANDO_APROVACAO);
		expect(dados.versao).toBe(1);
		expect(dados.tentativasEstorno).toBe(0);
		expect(dados).toMatchObject({
			aprovadoEm: null,
			prazoPagamentoEm: null,
			linkPagamento: null,
			preferenciaId: null,
			rejeitadoEm: null,
			motivoRejeicao: null,
			canceladoEm: null,
			motivoCancelamento: null,
			pagamentoId: null,
			valorPagoCentavos: null,
			pagoEm: null,
			pagamentoAtrasado: false,
			estornadoEm: null,
			proximaTentativaEstornoEm: null,
			ultimoErroEstorno: null,
			criadoEm: agora().toISOString(),
		});

		const itens = [
			{ tipo: "SERVICO" as const, referenciaId: "r1", descricao: "Servico", quantidade: 1, precoUnitarioCentavos: 30000 },
		];
		const copia = orcamentoNovo({ itens }, agora());
		itens[0].quantidade = 99;
		itens.push({ ...itens[0] });
		expect(copia.paraDados().itens).toEqual([
			{ tipo: "SERVICO", referenciaId: "r1", descricao: "Servico", quantidade: 1, precoUnitarioCentavos: 30000 },
		]);
	});

	it("criar recusa valor total diferente da soma dos itens", () => {
		let capturado: unknown;
		try {
			orcamentoNovo({ valorTotalCentavos: 29999 });
		} catch (erro) {
			capturado = erro;
		}
		expect(capturado).toBeInstanceOf(ValorTotalInconsistenteError);
		expect(capturado).toMatchObject({ informado: 29999, calculado: 30000 });
	});

	it("criar recusa soma que deixa de ser inteiro seguro", () => {
		const itens = [
			{
				tipo: "SERVICO" as const,
				referenciaId: "r1",
				descricao: "Caro",
				quantidade: 1,
				precoUnitarioCentavos: Number.MAX_SAFE_INTEGER,
			},
			{ tipo: "INSUMO" as const, referenciaId: "r2", descricao: "Mais", quantidade: 1, precoUnitarioCentavos: 10 },
		];
		expect(() => orcamentoNovo({ itens, valorTotalCentavos: Number.MAX_SAFE_INTEGER })).toThrow(ValorTotalInconsistenteError);
	});

	it("aprovar devolve nova instância aprovada com cobrança e mantém a original", () => {
		const original = orcamentoNovo({}, agora());
		const dados = original.aprovar(COBRANCA, depois(60), depois(1)).paraDados();

		expect(dados.status).toBe(StatusOrcamento.APROVADO);
		expect(dados.versao).toBe(2);
		expect(dados.linkPagamento).toBe(COBRANCA.linkPagamento);
		expect(dados.preferenciaId).toBe("pref-1");
		expect(dados.aprovadoEm).toBe(depois(1).toISOString());
		expect(dados.prazoPagamentoEm).toBe(depois(60).toISOString());
		expect(original.status).toBe(StatusOrcamento.AGUARDANDO_APROVACAO);
		expect(original.versao).toBe(1);
	});

	it("aprovar orçamento já aprovado é transição inválida", () => {
		const aprovado = orcamentoNovo().aprovar(COBRANCA, depois(60), agora());
		expect(() => aprovado.aprovar(COBRANCA, depois(60), agora())).toThrow(TransicaoInvalidaError);
		expect(() => aprovado.aprovar(COBRANCA, depois(60), agora())).toThrow(/aprovar.*APROVADO/);
	});

	it.each([null, "caro"])("rejeitar com motivo %p", (motivo) => {
		const dados = orcamentoNovo().rejeitar(motivo, agora()).paraDados();
		expect(dados.status).toBe(StatusOrcamento.REJEITADO);
		expect(dados.motivoRejeicao).toBe(motivo);
		expect(dados.rejeitadoEm).toBe(agora().toISOString());
	});

	it("cancelar orçamento aprovado grava data e motivo", () => {
		const cancelado = orcamentoNovo().aprovar(COBRANCA, depois(60), agora()).cancelar("PRAZO_PAGAMENTO_EXPIRADO", depois(5));
		expect(cancelado.status).toBe(StatusOrcamento.CANCELADO);
		expect(cancelado.canceladoEm).toBe(depois(5).toISOString());
		expect(cancelado.paraDados().motivoCancelamento).toBe("PRAZO_PAGAMENTO_EXPIRADO");
	});

	it("confirmarPagamento de aprovado não é atrasado; de cancelado é atrasado e preserva o cancelamento", () => {
		const pagamento = { pagamentoId: "p1", valorCentavos: 30000, pagoEm: depois(10) };
		const aprovado = orcamentoNovo().aprovar(COBRANCA, depois(60), agora());

		const pago = aprovado.confirmarPagamento(pagamento, depois(10));
		expect(pago.status).toBe(StatusOrcamento.PAGO);
		expect(pago.pagamentoAtrasado).toBe(false);
		expect(pago.pagamentoId).toBe("p1");
		expect(pago.valorPagoCentavos).toBe(30000);

		const pagoAtrasado = aprovado.cancelar("PRAZO_PAGAMENTO_EXPIRADO", depois(5)).confirmarPagamento(pagamento, depois(10));
		expect(pagoAtrasado.status).toBe(StatusOrcamento.PAGO);
		expect(pagoAtrasado.pagamentoAtrasado).toBe(true);
		expect(pagoAtrasado.canceladoEm).toBe(depois(5).toISOString());
	});

	it("estornar de pago e falhas de estorno acumulando tentativas", () => {
		const estornado = orcamentoPago().estornar(agora());
		expect(estornado.status).toBe(StatusOrcamento.ESTORNADO);
		expect(estornado.paraDados().estornadoEm).toBe(agora().toISOString());

		const pendente = orcamentoPago()
			.registrarFalhaEstorno("timeout", depois(5), agora())
			.registrarFalhaEstorno("503", depois(15), depois(5));
		expect(pendente.status).toBe(StatusOrcamento.ESTORNO_PENDENTE);
		expect(pendente.tentativasEstorno).toBe(2);
		expect(pendente.proximaTentativaEstornoEm).toBe(depois(15).toISOString());
		expect(pendente.paraDados().ultimoErroEstorno).toBe("503");
	});

	it("registrarCancelamentoSemMudarStatus grava uma vez só em orçamento com pagamento", () => {
		const pago = orcamentoPago();
		const marcado = pago.registrarCancelamentoSemMudarStatus("PRAZO_REPARO", agora());
		expect(marcado.status).toBe(StatusOrcamento.PAGO);
		expect(marcado.canceladoEm).toBe(agora().toISOString());
		expect(marcado.versao).toBe(pago.versao + 1);
		expect(marcado.registrarCancelamentoSemMudarStatus("outro", depois(1))).toBe(marcado);

		const rejeitado = orcamentoNovo().rejeitar(null, agora());
		expect(rejeitado.registrarCancelamentoSemMudarStatus("x", agora())).toBe(rejeitado);
	});

	it("consultas de dono, atividade, pagamento e prazo de aprovação", () => {
		const novo = orcamentoNovo({ prazoAprovacaoEm: depois(60).toISOString() }, agora());
		expect(novo.pertenceAoCliente(CLIENTE_ID)).toBe(true);
		expect(novo.pertenceAoCliente(OUTRO_CLIENTE_ID)).toBe(false);
		expect(novo.possuiPagamento()).toBe(false);
		expect(orcamentoPago().possuiPagamento()).toBe(true);
		expect(novo.prazoAprovacaoExpirado(depois(30))).toBe(false);
		expect(novo.prazoAprovacaoExpirado(depois(61))).toBe(true);

		const ativos = [novo, novo.aprovar(COBRANCA, depois(120), agora()), orcamentoPago()];
		const inativos = [
			novo.rejeitar(null, agora()),
			novo.cancelar("x", agora()),
			orcamentoPago().estornar(agora()),
			orcamentoPago().registrarFalhaEstorno("e", depois(5), agora()),
		];
		expect(ativos.map((o) => o.estaAtivo())).toEqual([true, true, true]);
		expect(inativos.map((o) => o.estaAtivo())).toEqual([false, false, false, false]);
	});

	it("restaurar a partir dos dados devolve instância equivalente", () => {
		const original = orcamentoPago();
		const restaurado = Orcamento.restaurar(original.paraDados());
		expect(restaurado.paraDados()).toEqual(original.paraDados());
		expect(restaurado).not.toBe(original);
	});

	it("getters expõem os mesmos valores dos dados, com itens copiados", () => {
		const orcamento = orcamentoNovo({}, agora()).aprovar(COBRANCA, depois(60), agora());
		const dados = orcamento.paraDados();
		expect({
			id: orcamento.id,
			osId: orcamento.osId,
			numeroOs: orcamento.numeroOs,
			fluxoId: orcamento.fluxoId,
			criadoEm: orcamento.criadoEm,
			valorTotalCentavos: orcamento.valorTotalCentavos,
			prazoPagamentoMinutos: orcamento.prazoPagamentoMinutos,
			linkPagamento: orcamento.linkPagamento,
			prazoPagamentoEm: orcamento.prazoPagamentoEm,
		}).toEqual({
			id: dados.id,
			osId: dados.osId,
			numeroOs: dados.numeroOs,
			fluxoId: dados.fluxoId,
			criadoEm: dados.criadoEm,
			valorTotalCentavos: dados.valorTotalCentavos,
			prazoPagamentoMinutos: dados.prazoPagamentoMinutos,
			linkPagamento: dados.linkPagamento,
			prazoPagamentoEm: dados.prazoPagamentoEm,
		});
		const itens = orcamento.itens;
		itens[0].quantidade = 50;
		expect(orcamento.itens).toEqual(dados.itens);
	});
});
