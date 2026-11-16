import { ORCAMENTO_ID, orcamentoNovo, orcamentoPago } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { GatewayPagamentoSimulado } from "../../adapters/gateways/gateway-pagamento.simulado";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { ErroGatewayPagamento, type PagamentoExterno } from "../ports/gateway-pagamento.port";
import { ConflitoConcorrenciaError } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { ProcessarNotificacaoPagamentoUseCase } from "./processar-notificacao-pagamento.use-case";
import { RegistrarPagamentoUseCase } from "./registrar-pagamento.use-case";

const PAGAMENTO_ID = "ORD01TESTE9001";
const CORRELATION_ID = "corr-1";

const pagamento = (sobrescrever: Partial<PagamentoExterno> = {}): PagamentoExterno => ({
	pagamentoId: PAGAMENTO_ID,
	status: "approved",
	orcamentoId: ORCAMENTO_ID,
	valorCentavos: 30000,
	pagoEm: "2026-10-20T14:00:00.000Z",
	bruto: { id: PAGAMENTO_ID },
	...sobrescrever,
});

const aprovado = () =>
	orcamentoNovo().aprovar(
		{ linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" },
		new Date(Date.now() + 3_600_000),
		new Date(),
	);

describe("RegistrarPagamentoUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let pagamentos: GatewayPagamentoSimulado;
	let registrar: RegistrarPagamentoUseCase;
	let processar: ProcessarNotificacaoPagamentoUseCase;
	let estornar: jest.SpyInstance;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		pagamentos = new GatewayPagamentoSimulado();
		estornar = jest.spyOn(pagamentos, "estornar");
		registrar = new RegistrarPagamentoUseCase(gateway, pagamentos, new EventosOrcamentoService(gateway, publicador));
		processar = new ProcessarNotificacaoPagamentoUseCase(pagamentos, registrar);
	});

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};
	const status = async () => (await gateway.buscarPorId(ORCAMENTO_ID))?.status;
	const confirmados = () => publicador.doTipo("PagamentoConfirmado").map((e) => e.payload);

	it("pagamento aprovado confirma o orçamento e emite PagamentoConfirmado", async () => {
		salvar(aprovado());

		await expect(registrar.execute(pagamento(), CORRELATION_ID)).resolves.toBe("CONFIRMADO");

		const orcamento = await gateway.buscarPorId(ORCAMENTO_ID);
		expect(orcamento?.status).toBe(StatusOrcamento.PAGO);
		expect(orcamento?.pagamentoId).toBe(PAGAMENTO_ID);
		expect(orcamento?.pagamentoAtrasado).toBe(false);
		expect(confirmados()).toEqual([
			{ orcamentoId: ORCAMENTO_ID, pagamentoId: PAGAMENTO_ID, valorCentavos: 30000, pagoEm: "2026-10-20T14:00:00.000Z" },
		]);
		expect(publicador.doTipo("PagamentoConfirmado")[0].correlationId).toBe(CORRELATION_ID);
		expect(gateway.chaves.has(`WEBHOOK#${PAGAMENTO_ID}#approved`)).toBe(true);
		expect(gateway.pagamentos.get(PAGAMENTO_ID)).toEqual(pagamento());
		expect(estornar).not.toHaveBeenCalled();
	});

	it.each(["refunded", "created/created", "canceled/canceled", "failed/rejected", "processed/partially_refunded"])(
		"status %p → NAO_APROVADO sem gravar nada",
		async (s) => {
			salvar(aprovado());

			await expect(registrar.execute(pagamento({ status: s }), CORRELATION_ID)).resolves.toBe("NAO_APROVADO");

			expect(await status()).toBe(StatusOrcamento.APROVADO);
			expect(gateway.chaves.size).toBe(0);
			expect(publicador.eventos).toHaveLength(0);
		},
	);

	it.each([null, "outro-orcamento"])("external_reference %p sem orçamento → SEM_ORCAMENTO", async (orcamentoId) => {
		salvar(aprovado());

		await expect(registrar.execute(pagamento({ orcamentoId }), CORRELATION_ID)).resolves.toBe("SEM_ORCAMENTO");

		expect(gateway.chaves.size).toBe(0);
		expect(estornar).not.toHaveBeenCalled();
	});

	it("mesma notificação duas vezes → JA_REGISTRADO e um único PagamentoConfirmado", async () => {
		salvar(aprovado());

		await registrar.execute(pagamento(), CORRELATION_ID);
		await expect(registrar.execute(pagamento(), CORRELATION_ID)).resolves.toBe("JA_REGISTRADO");

		expect(confirmados()).toHaveLength(1);
	});

	it("chave já processada sem o orçamento ter o pagamento → JA_REGISTRADO", async () => {
		salvar(aprovado());
		gateway.chaves.add(`WEBHOOK#${PAGAMENTO_ID}#approved`);

		await expect(registrar.execute(pagamento(), CORRELATION_ID)).resolves.toBe("JA_REGISTRADO");

		expect(await status()).toBe(StatusOrcamento.APROVADO);
		expect(estornar).not.toHaveBeenCalled();
	});

	it("orçamento com outro pagamento → estorna o novo e grava sem evento", async () => {
		salvar(orcamentoPago("ORD01ANTERIOR"));

		await expect(registrar.execute(pagamento(), CORRELATION_ID)).resolves.toBe("ESTORNADO_DUPLICADO");

		expect(estornar).toHaveBeenCalledWith(PAGAMENTO_ID, `estorno-duplicado-${PAGAMENTO_ID}`);
		const orcamento = await gateway.buscarPorId(ORCAMENTO_ID);
		expect(orcamento?.pagamentoId).toBe("ORD01ANTERIOR");
		expect(gateway.chaves.has(`WEBHOOK#${PAGAMENTO_ID}#approved`)).toBe(true);
		expect(gateway.pagamentos.get(PAGAMENTO_ID)).toMatchObject({ pagamentoId: PAGAMENTO_ID, bruto: { id: PAGAMENTO_ID } });
		expect(publicador.eventos).toHaveLength(0);
	});

	it("valor diferente do orçamento → estorna e mantém APROVADO", async () => {
		salvar(aprovado());

		await expect(registrar.execute(pagamento({ valorCentavos: 29999 }), CORRELATION_ID)).resolves.toBe("ESTORNADO_VALOR_DIVERGENTE");

		expect(estornar).toHaveBeenCalledWith(PAGAMENTO_ID, `estorno-divergente-${PAGAMENTO_ID}`);
		expect(await status()).toBe(StatusOrcamento.APROVADO);
		expect(gateway.chaves.has(`WEBHOOK#${PAGAMENTO_ID}#approved`)).toBe(true);
		expect(publicador.eventos).toHaveLength(0);
	});

	it.each([
		["AGUARDANDO_APROVACAO", () => orcamentoNovo()],
		["REJEITADO", () => orcamentoNovo().rejeitar(null, new Date())],
	])("orçamento %s → estorna como não aplicável", async (esperado, criar) => {
		salvar(criar());

		await expect(registrar.execute(pagamento(), CORRELATION_ID)).resolves.toBe("ESTORNADO_NAO_APLICAVEL");

		expect(estornar).toHaveBeenCalledWith(PAGAMENTO_ID, `estorno-nao-aplicavel-${PAGAMENTO_ID}`);
		expect(await status()).toBe(esperado);
		expect(publicador.eventos).toHaveLength(0);
	});

	it("orçamento cancelado → confirma como atrasado para o orquestrador estornar", async () => {
		salvar(aprovado().cancelar("PRAZO_PAGAMENTO_EXPIRADO", new Date()));

		await expect(registrar.execute(pagamento(), CORRELATION_ID)).resolves.toBe("CONFIRMADO_ATRASADO");

		const orcamento = await gateway.buscarPorId(ORCAMENTO_ID);
		expect(orcamento?.status).toBe(StatusOrcamento.PAGO);
		expect(orcamento?.pagamentoAtrasado).toBe(true);
		expect(confirmados()).toHaveLength(1);
		expect(estornar).not.toHaveBeenCalled();
	});

	it("falha no estorno direto propaga sem gravar a notificação", async () => {
		salvar(aprovado());
		pagamentos.falharEstornos = true;

		await expect(registrar.execute(pagamento({ valorCentavos: 1 }), CORRELATION_ID)).rejects.toBeInstanceOf(ErroGatewayPagamento);

		expect(gateway.chaves.size).toBe(0);
	});

	it("conflito de concorrência propaga", async () => {
		salvar(aprovado());
		jest.spyOn(gateway, "atualizar").mockRejectedValue(new ConflitoConcorrenciaError(ORCAMENTO_ID));

		await expect(registrar.execute(pagamento(), CORRELATION_ID)).rejects.toBeInstanceOf(ConflitoConcorrenciaError);
	});

	describe("ProcessarNotificacaoPagamentoUseCase", () => {
		it("consulta o pagamento na API e registra", async () => {
			salvar(aprovado());
			pagamentos.registrarPagamento(pagamento());

			await expect(processar.execute(PAGAMENTO_ID, CORRELATION_ID)).resolves.toBe("CONFIRMADO");

			expect(await status()).toBe(StatusOrcamento.PAGO);
		});

		it("corpo diz processed, mas a API diz created → NAO_APROVADO", async () => {
			salvar(aprovado());
			pagamentos.registrarPagamento(pagamento({ status: "created/created" }));

			await expect(processar.execute(PAGAMENTO_ID, CORRELATION_ID)).resolves.toBe("NAO_APROVADO");

			expect(await status()).toBe(StatusOrcamento.APROVADO);
			expect(publicador.eventos).toHaveLength(0);
		});

		it("pagamento inexistente na API → PAGAMENTO_NAO_ENCONTRADO", async () => {
			salvar(aprovado());

			await expect(processar.execute("ORD01NAOEXISTE", CORRELATION_ID)).resolves.toBe("PAGAMENTO_NAO_ENCONTRADO");

			expect(await status()).toBe(StatusOrcamento.APROVADO);
		});
	});
});
