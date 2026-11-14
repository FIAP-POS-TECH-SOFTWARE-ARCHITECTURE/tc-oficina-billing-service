import { ORCAMENTO_ID, orcamentoNovo } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { GatewayPagamentoSimulado } from "../../adapters/gateways/gateway-pagamento.simulado";
import { StatusOrcamento } from "../../domain/status-orcamento";
import type { PagamentoExterno } from "../ports/gateway-pagamento.port";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { ReconciliarPagamentosUseCase } from "./reconciliar-pagamentos.use-case";
import { RegistrarPagamentoUseCase } from "./registrar-pagamento.use-case";

const pagamento = (pagamentoId: string, status: string): PagamentoExterno => ({
	pagamentoId,
	status,
	orcamentoId: ORCAMENTO_ID,
	valorCentavos: 30000,
	pagoEm: "2026-10-20T14:00:00.000Z",
	bruto: {},
});

describe("ReconciliarPagamentosUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let pagamentos: GatewayPagamentoSimulado;
	let uc: ReconciliarPagamentosUseCase;
	let numeroOs: string;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		pagamentos = new GatewayPagamentoSimulado();
		const eventos = new EventosOrcamentoService(gateway, new PublicadorMemoria());
		uc = new ReconciliarPagamentosUseCase(gateway, pagamentos, new RegistrarPagamentoUseCase(gateway, pagamentos, eventos));
		const orcamento = orcamentoNovo().aprovar(
			{ linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" },
			new Date(Date.now() + 3_600_000),
			new Date(),
		);
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		numeroOs = orcamento.numeroOs;
	});

	it("orçamento inexistente → 404", async () => {
		await expect(uc.execute("OS-NAO-EXISTE", "req-1")).resolves.toMatchObject({ status: 404, success: false });
	});

	it("sem pagamentos no provedor → lista vazia e status inalterado", async () => {
		await expect(uc.execute(numeroOs, "req-1")).resolves.toMatchObject({
			status: 200,
			data: { orcamentoId: ORCAMENTO_ID, status: StatusOrcamento.APROVADO, pagamentosEncontrados: 0, resultados: [] },
		});
	});

	it("pagamento aprovado é registrado; rodar de novo não duplica", async () => {
		pagamentos.registrarPagamento(pagamento("ORD01A", "approved"));

		await expect(uc.execute(numeroOs, "req-1")).resolves.toMatchObject({
			data: {
				status: StatusOrcamento.PAGO,
				pagamentosEncontrados: 1,
				resultados: [{ pagamentoId: "ORD01A", resultado: "CONFIRMADO" }],
			},
		});
		await expect(uc.execute(numeroOs, "req-2")).resolves.toMatchObject({
			data: { status: StatusOrcamento.PAGO, resultados: [{ pagamentoId: "ORD01A", resultado: "JA_REGISTRADO" }] },
		});
	});

	it("order pendente e aprovada → só a aprovada confirma", async () => {
		pagamentos.registrarPagamento(pagamento("ORD01PENDENTE", "created/created"));
		pagamentos.registrarPagamento(pagamento("ORD01APROVADA", "approved"));

		const r = await uc.execute(numeroOs, "req-1");

		expect(r).toMatchObject({
			data: {
				status: StatusOrcamento.PAGO,
				pagamentosEncontrados: 2,
				resultados: [
					{ pagamentoId: "ORD01PENDENTE", resultado: "NAO_APROVADO" },
					{ pagamentoId: "ORD01APROVADA", resultado: "CONFIRMADO" },
				],
			},
		});
		expect((await gateway.buscarPorId(ORCAMENTO_ID))?.pagamentoId).toBe("ORD01APROVADA");
	});
});
