import { Logger } from "@nestjs/common";
import { orcamentoPago } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { ValidadorContratos } from "../../../mensageria/validador-contratos";
import { GatewayPagamentoSimulado } from "../../adapters/gateways/gateway-pagamento.simulado";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { contextoDoOrcamento } from "../eventos-billing";
import { atrasoRetentativaEstornoMs, chaveIdempotenciaEstorno, EstornoService } from "./estorno.service";
import { EventosOrcamentoService } from "./eventos-orcamento.service";

const PAGAMENTO_ID = "1234567890";

describe("EstornoService", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let pagamentos: GatewayPagamentoSimulado;
	let servico: EstornoService;

	beforeEach(() => {
		jest.useFakeTimers({ now: new Date("2026-10-20T13:00:00.000Z"), doNotFake: ["nextTick", "setImmediate"] });
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		pagamentos = new GatewayPagamentoSimulado();
		servico = new EstornoService(pagamentos, new EventosOrcamentoService(gateway, publicador));
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};
	const estornar = (orcamento: Orcamento, messageId?: string) =>
		servico.estornar(orcamento, contextoDoOrcamento(orcamento, "req-1"), messageId);

	it("chave de idempotência derivada do orçamento", () => {
		expect(chaveIdempotenciaEstorno("o-1")).toBe("estorno-o-1");
	});

	it("estorna no provedor, grava ESTORNADO e o dedupe do comando na mesma escrita", async () => {
		const orcamento = salvar(orcamentoPago());

		await expect(estornar(orcamento, "m1")).resolves.toBe("ESTORNADO");

		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.ESTORNADO);
		await expect(gateway.mensagemJaProcessada("m1")).resolves.toBe(true);
		expect(publicador.doTipo("PagamentoEstornado")[0]).toMatchObject({
			correlationId: "req-1",
			payload: { orcamentoId: orcamento.id, pagamentoId: PAGAMENTO_ID, valorCentavos: 30000 },
		});
	});

	describe("falha no provedor", () => {
		beforeEach(() => (pagamentos.falharEstornos = true));

		it("grava ESTORNO_PENDENTE com a próxima tentativa e publica EstornoFalhou válido no contrato", async () => {
			const orcamento = salvar(orcamentoPago());

			await expect(estornar(orcamento, "m1")).resolves.toBe("FALHOU");

			const pendente = await gateway.buscarPorId(orcamento.id);
			expect(pendente?.status).toBe(StatusOrcamento.ESTORNO_PENDENTE);
			expect(pendente?.tentativasEstorno).toBe(1);
			expect(pendente?.proximaTentativaEstornoEm).toBe("2026-10-20T13:01:00.000Z");
			await expect(gateway.mensagemJaProcessada("m1")).resolves.toBe(true);

			const [evento] = publicador.doTipo("EstornoFalhou");
			expect(evento.payload).toEqual({
				orcamentoId: orcamento.id,
				pagamentoId: PAGAMENTO_ID,
				motivo: "Estorno recusado (simulado)",
				proximaTentativaEm: "2026-10-20T13:01:00.000Z",
			});
			expect(new ValidadorContratos().validar(evento)).toEqual({ valido: true, erros: [] });
			expect(publicador.doTipo("PagamentoEstornado")).toHaveLength(0);
		});

		it("redelivery do mesmo comando não duplica a falha", async () => {
			const orcamento = salvar(orcamentoPago());

			await estornar(orcamento, "m1");
			await estornar(orcamento, "m1");

			expect(publicador.doTipo("EstornoFalhou")).toHaveLength(1);
			expect((await gateway.buscarPorId(orcamento.id))?.tentativasEstorno).toBe(1);
		});

		it("pagamento já reembolsado no provedor conta como estornado", async () => {
			const orcamento = salvar(orcamentoPago());
			pagamentos.registrarPagamento({
				pagamentoId: PAGAMENTO_ID,
				status: "refunded",
				orcamentoId: orcamento.id,
				valorCentavos: 30000,
				pagoEm: null,
				bruto: {},
			});

			await expect(estornar(orcamento)).resolves.toBe("ESTORNADO");

			expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.ESTORNADO);
			expect(publicador.doTipo("PagamentoEstornado")).toHaveLength(1);
		});

		it("consulta que também falha mantém a falha", async () => {
			const orcamento = salvar(orcamentoPago());
			jest.spyOn(pagamentos, "consultarPagamento").mockRejectedValue(new Error("fora do ar"));

			await expect(estornar(orcamento)).resolves.toBe("FALHOU");
		});

		it("a partir da 5ª falha loga billing.estorno.esgotado", async () => {
			let orcamento = orcamentoPago();
			for (let i = 0; i < 4; i++) orcamento = orcamento.registrarFalhaEstorno("x", new Date(), new Date());
			salvar(orcamento);
			const erro = jest.spyOn(Logger.prototype, "error").mockImplementation();
			const aviso = jest.spyOn(Logger.prototype, "warn").mockImplementation();

			await estornar(orcamento);

			expect(erro).toHaveBeenCalledWith(expect.objectContaining({ event: "billing.estorno.esgotado", tentativa: 5 }));
			expect(aviso).not.toHaveBeenCalledWith(expect.objectContaining({ event: "billing.estorno.falhou" }));
			expect((await gateway.buscarPorId(orcamento.id))?.proximaTentativaEstornoEm).toBe("2026-10-20T14:00:00.000Z");
		});
	});

	it.each([
		[1, 1],
		[2, 5],
		[3, 15],
		[4, 60],
		[5, 60],
		[6, 60],
	])("backoff da tentativa %i: %i min", (tentativa, minutos) => {
		expect(atrasoRetentativaEstornoMs(tentativa)).toBe(minutos * 60_000);
	});
});
