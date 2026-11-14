import { defineFeature, type DefineStepFunction, loadFeature } from "jest-cucumber";
import path from "node:path";
import { CLIENTE_ID, comandoComMotivo, comandoGerarOrcamento } from "../../suporte/fabricas";
import { criarMundoBilling, type MundoBilling } from "../../suporte/mundo-billing";

const feature = loadFeature(path.join(__dirname, "..", "features", "pagamento.feature"));

defineFeature(feature, (test) => {
	let mundo: MundoBilling;

	beforeEach(() => {
		mundo = criarMundoBilling();
	});

	const comando = () => {
		if (!mundo.ultimoComando) throw new Error("Nenhum GerarOrcamento entregue no cenário");
		return mundo.ultimoComando;
	};
	const orcamento = async () => {
		const atual = await mundo.gateway.buscarPorOsId(comando().osId);
		if (!atual) throw new Error("Orçamento não encontrado");
		return atual;
	};

	const gerarEAprovar = async (centavos: number, numeroOs?: string) => {
		const base = comandoGerarOrcamento();
		mundo.ultimoComando = comandoGerarOrcamento({
			...(numeroOs ? { numeroOs } : {}),
			payload: {
				cliente: { ...base.payload.cliente, id: CLIENTE_ID },
				itens: [
					{
						tipo: "SERVICO",
						referenciaId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
						descricao: "Revisão completa",
						quantidade: 1,
						precoUnitarioCentavos: centavos,
					},
				],
				valorTotalCentavos: centavos,
			},
		});
		await mundo.gerar.execute(mundo.ultimoComando);
		await mundo.aprovar.execute(mundo.ultimoComando.numeroOs, CLIENTE_ID, "bdd");
	};

	const registrarNoMercadoPago = async (pagamentoId: string, status: string, valorCentavos: number) => {
		mundo.pagamentos.registrarPagamento({
			pagamentoId,
			status,
			orcamentoId: (await orcamento()).id,
			valorCentavos,
			pagoEm: new Date().toISOString(),
			bruto: {},
		});
	};

	const dadoOrcamentoAprovado = (given: DefineStepFunction) => {
		given(/^um orçamento aprovado de (\d+) centavos da OS "(.*)"$/, (valor: string, numeroOs: string) =>
			gerarEAprovar(Number(valor), numeroOs),
		);
	};

	const eMercadoPagoRegistrou = (and: DefineStepFunction) => {
		and(
			/^o Mercado Pago registrou o pagamento "(.*)" como "(.*)" no valor de (\d+) centavos$/,
			(pagamentoId: string, status: string, valor: string) => registrarNoMercadoPago(pagamentoId, status, Number(valor)),
		);
	};

	const quandoChegaNotificacao = (when: DefineStepFunction) => {
		when(/^chega a notificação do pagamento "(.*)"$/, async (pagamentoId: string) => {
			await mundo.processarNotificacao.execute(pagamentoId, "bdd");
		});
	};

	const entaoStatus = (then: DefineStepFunction) => {
		then(/^o orçamento fica com status "(.*)"$/, async (status: string) => {
			expect((await orcamento()).status).toBe(status);
		});
	};

	const eConfirmadoUmaVez = (and: DefineStepFunction) => {
		and(/^o evento "(.*)" é publicado (\d+) vez com o pagamento "(.*)"$/, (tipo: string, vezes: string, pagamentoId: string) => {
			const eventos = mundo.publicador.doTipo(tipo);
			expect(eventos).toHaveLength(Number(vezes));
			expect(eventos.every((e) => e.payload.pagamentoId === pagamentoId)).toBe(true);
		});
	};

	const eNenhumEvento = (and: DefineStepFunction) => {
		and(/^nenhum evento "(.*)" é publicado$/, (tipo: string) => {
			expect(mundo.publicador.doTipo(tipo)).toHaveLength(0);
		});
	};

	const quandoPedeEstorno = (when: DefineStepFunction) => {
		when("o orquestrador pede o estorno do pagamento", async () => {
			const { osId, fluxoId, numeroOs } = comando();
			await mundo.estornar.execute(comandoComMotivo("EstornarPagamento", "REPARO_INVIAVEL", { osId, fluxoId, numeroOs }));
		});
	};

	const eEstornadoComValor = (and: DefineStepFunction) => {
		and(/^o evento "PagamentoEstornado" é publicado com valor (\d+)$/, (valor: string) => {
			expect(mundo.publicador.doTipo("PagamentoEstornado").map((e) => e.payload.valorCentavos)).toEqual([Number(valor)]);
		});
	};

	test("Pagamento aprovado confirma o orçamento", ({ given, and, when, then }) => {
		dadoOrcamentoAprovado(given);
		eMercadoPagoRegistrou(and);
		quandoChegaNotificacao(when);
		entaoStatus(then);
		eConfirmadoUmaVez(and);
	});

	test("Notificação repetida não confirma duas vezes", ({ given, and, when, then }) => {
		dadoOrcamentoAprovado(given);
		eMercadoPagoRegistrou(and);
		quandoChegaNotificacao(when);
		quandoChegaNotificacao(and);
		eConfirmadoUmaVez(then);
	});

	test("Pagamento pendente não confirma nada", ({ given, and, when, then }) => {
		dadoOrcamentoAprovado(given);
		eMercadoPagoRegistrou(and);
		quandoChegaNotificacao(when);
		entaoStatus(then);
		eNenhumEvento(and);
	});

	test("Pagamento que chega depois do cancelamento é confirmado para a saga estornar", ({ given, and, when, then }) => {
		dadoOrcamentoAprovado(given);
		and(/^o orquestrador cancelou o orçamento com o motivo "(.*)"$/, async (motivo: string) => {
			const { osId, fluxoId, numeroOs } = comando();
			await mundo.cancelar.execute(comandoComMotivo("CancelarOrcamento", motivo, { osId, fluxoId, numeroOs }));
		});
		eMercadoPagoRegistrou(and);
		quandoChegaNotificacao(when);
		entaoStatus(then);
		eConfirmadoUmaVez(and);
		quandoPedeEstorno(when);
		entaoStatus(then);
		eEstornadoComValor(and);
	});

	test("Estorno falha e é retentado", ({ given, and, when, then }) => {
		given(/^um orçamento pago de (\d+) centavos com o pagamento "(.*)"$/, async (valor: string, pagamentoId: string) => {
			await gerarEAprovar(Number(valor));
			await registrarNoMercadoPago(pagamentoId, "approved", Number(valor));
			await mundo.processarNotificacao.execute(pagamentoId, "bdd");
		});
		and("o Mercado Pago está recusando estornos", () => {
			mundo.pagamentos.falharEstornos = true;
		});
		quandoPedeEstorno(when);
		entaoStatus(then);
		and(/^o evento "EstornoFalhou" é publicado com próxima tentativa em (\d+) minuto$/, (minutos: string) => {
			const [evento] = mundo.publicador.doTipo("EstornoFalhou");
			const atraso = Date.parse(evento.payload.proximaTentativaEm) - Date.parse(evento.ocorridoEm);
			expect(Math.abs(atraso - Number(minutos) * 60_000)).toBeLessThan(1_000);
		});
		when("o Mercado Pago volta a aceitar estornos", () => {
			mundo.pagamentos.falharEstornos = false;
		});
		and(/^a retentativa de estornos roda (\d+) minutos depois$/, async (minutos: string) => {
			await mundo.retentarEstornos.execute(new Date(Date.now() + Number(minutos) * 60_000));
		});
		entaoStatus(then);
		eEstornadoComValor(and);
	});

	test("Pagamento com valor diferente do orçamento é estornado direto", ({ given, and, when, then }) => {
		dadoOrcamentoAprovado(given);
		eMercadoPagoRegistrou(and);
		quandoChegaNotificacao(when);
		entaoStatus(then);
		and(/^o pagamento "(.*)" foi estornado no Mercado Pago$/, async (pagamentoId: string) => {
			expect((await mundo.pagamentos.consultarPagamento(pagamentoId))?.status).toBe("refunded");
		});
		eNenhumEvento(and);
	});
});
