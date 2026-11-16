import { defineFeature, type DefineStepFunction, loadFeature } from "jest-cucumber";
import path from "node:path";
import { CLIENTE_ID, comandoComMotivo, comandoGerarOrcamento, OUTRO_CLIENTE_ID } from "../../suporte/fabricas";
import { criarMundoBilling, type MundoBilling } from "../../suporte/mundo-billing";

const feature = loadFeature(path.join(__dirname, "..", "features", "aprovacao-orcamento.feature"));

const CLIENTES: Record<string, string> = { maria: CLIENTE_ID, joao: OUTRO_CLIENTE_ID };

defineFeature(feature, (test) => {
	let mundo: MundoBilling;

	beforeEach(() => {
		mundo = criarMundoBilling();
	});

	const comando = () => {
		if (!mundo.ultimoComando) throw new Error("Nenhum GerarOrcamento entregue no cenário");
		return mundo.ultimoComando;
	};

	const dadoOrcamentoGerado = (given: DefineStepFunction) => {
		given(
			/^que o billing recebeu o comando GerarOrcamento da OS "(.*)" do cliente "(.*)" no valor de (\d+) centavos$/,
			async (numeroOs: string, cliente: string, valor: string) => {
				const base = comandoGerarOrcamento();
				const centavos = Number(valor);
				mundo.ultimoComando = comandoGerarOrcamento({
					numeroOs,
					payload: {
						cliente: { ...base.payload.cliente, id: CLIENTES[cliente] },
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
			},
		);
	};

	const quandoClienteAprova = (when: DefineStepFunction) => {
		when(/^o cliente "(.*)" aprova o orçamento da OS "(.*)"$/, async (cliente: string, numeroOs: string) => {
			mundo.ultimaResposta = await mundo.aprovar.execute(numeroOs, CLIENTES[cliente], "req-bdd");
		});
	};

	const entaoStatus = (then: DefineStepFunction) => {
		then(/^a resposta tem status (\d+)$/, (status: string) => {
			expect(mundo.ultimaResposta?.status).toBe(Number(status));
		});
	};

	const eStatusDoOrcamento = (and: DefineStepFunction) => {
		and(/^o orçamento da OS "(.*)" fica com status "(.*)"$/, async (numeroOs: string, status: string) => {
			expect((await mundo.gateway.buscarPorNumeroOs(numeroOs))?.status).toBe(status);
		});
	};

	test("Cliente aprova o orçamento e recebe o link de pagamento", ({ given, when, then, and }) => {
		dadoOrcamentoGerado(given);
		quandoClienteAprova(when);
		then(/^a resposta tem status (\d+) com link de pagamento$/, (status: string) => {
			expect(mundo.ultimaResposta?.status).toBe(Number(status));
			expect(mundo.ultimaResposta?.data?.linkPagamento).toEqual(expect.any(String));
		});
		eStatusDoOrcamento(and);
		and(/^o evento "(.*)" é publicado com o mesmo link de pagamento$/, (tipo: string) => {
			const [evento] = mundo.publicador.doTipo(tipo);
			expect(evento.payload.linkPagamento).toBe(mundo.ultimaResposta?.data?.linkPagamento);
		});
	});

	test("Cliente rejeita o orçamento", ({ given, when, then, and }) => {
		dadoOrcamentoGerado(given);
		when(
			/^o cliente "(.*)" rejeita o orçamento da OS "(.*)" com o motivo "(.*)"$/,
			async (cliente: string, numeroOs: string, motivo: string) => {
				mundo.ultimaResposta = await mundo.rejeitar.execute(numeroOs, CLIENTES[cliente], motivo, "req-bdd");
			},
		);
		entaoStatus(then);
		eStatusDoOrcamento(and);
		and(/^o evento "(.*)" é publicado com o motivo "(.*)"$/, (tipo: string, motivo: string) => {
			expect(mundo.publicador.doTipo(tipo).map((e) => e.payload.motivo)).toEqual([motivo]);
		});
	});

	test("Cliente tenta aprovar orçamento já cancelado pela oficina", ({ given, and, when, then }) => {
		dadoOrcamentoGerado(given);
		and(/^o orquestrador cancelou o orçamento da OS com o motivo "(.*)"$/, async (motivo: string) => {
			const { osId, fluxoId, numeroOs } = comando();
			await mundo.cancelar.execute(comandoComMotivo("CancelarOrcamento", motivo, { osId, fluxoId, numeroOs }));
		});
		quandoClienteAprova(when);
		entaoStatus(then);
		eStatusDoOrcamento(and);
		and(/^nenhum evento "(.*)" é publicado$/, (tipo: string) => {
			expect(mundo.publicador.doTipo(tipo)).toHaveLength(0);
		});
	});

	test("Outro cliente não consegue aprovar", ({ given, when, then, and }) => {
		dadoOrcamentoGerado(given);
		quandoClienteAprova(when);
		entaoStatus(then);
		eStatusDoOrcamento(and);
	});

	test("Comando GerarOrcamento duplicado não gera segundo orçamento", ({ given, when, then, and }) => {
		dadoOrcamentoGerado(given);
		when("o mesmo comando GerarOrcamento é entregue de novo", async () => {
			await mundo.gerar.execute(comando());
		});
		then(/^existe (\d+) orçamento para a OS$/, (quantidade: string) => {
			expect(mundo.gateway.contarPorOs(comando().osId)).toBe(Number(quantidade));
		});
		and(/^o evento "(.*)" foi publicado (\d+) vez$/, (tipo: string, vezes: string) => {
			expect(mundo.publicador.doTipo(tipo)).toHaveLength(Number(vezes));
		});
	});
});
