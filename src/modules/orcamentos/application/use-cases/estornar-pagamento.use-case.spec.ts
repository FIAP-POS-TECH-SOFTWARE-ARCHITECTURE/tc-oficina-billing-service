import { comandoComMotivo, orcamentoNovo, orcamentoPago } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { GatewayPagamentoSimulado } from "../../adapters/gateways/gateway-pagamento.simulado";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { EstornoService } from "../services/estorno.service";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { EstornarPagamentoUseCase } from "./estornar-pagamento.use-case";

describe("EstornarPagamentoUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let pagamentos: GatewayPagamentoSimulado;
	let uc: EstornarPagamentoUseCase;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		pagamentos = new GatewayPagamentoSimulado();
		const eventos = new EventosOrcamentoService(gateway, publicador);
		uc = new EstornarPagamentoUseCase(gateway, eventos, new EstornoService(pagamentos, eventos));
	});

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};
	const estornados = () => publicador.doTipo("PagamentoEstornado").map((e) => e.payload);

	it("sem orçamento responde estorno vazio", async () => {
		await uc.execute(comandoComMotivo("EstornarPagamento"));
		expect(estornados()).toEqual([{ orcamentoId: null, pagamentoId: null, valorCentavos: 0 }]);
	});

	it("orçamento sem pagamento responde estorno vazio com o orcamentoId", async () => {
		const orcamento = salvar(orcamentoNovo());
		await uc.execute(comandoComMotivo("EstornarPagamento"));
		expect(estornados()).toEqual([{ orcamentoId: orcamento.id, pagamentoId: null, valorCentavos: 0 }]);
	});

	it("orçamento pago: estorna com chave idempotente, muda para ESTORNADO e publica o valor", async () => {
		const orcamento = salvar(orcamentoPago());
		const estornar = jest.spyOn(pagamentos, "estornar");

		await uc.execute(comandoComMotivo("EstornarPagamento"));

		expect(estornar).toHaveBeenCalledWith("1234567890", `estorno-${orcamento.id}`);
		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.ESTORNADO);
		expect(estornados()).toEqual([{ orcamentoId: orcamento.id, pagamentoId: "1234567890", valorCentavos: 30000 }]);
	});

	it("já estornado reemite o evento sem chamar o provedor", async () => {
		const orcamento = salvar(orcamentoPago().estornar(new Date()));
		const estornar = jest.spyOn(pagamentos, "estornar");

		await uc.execute(comandoComMotivo("EstornarPagamento"));

		expect(estornar).not.toHaveBeenCalled();
		expect(estornados()).toEqual([{ orcamentoId: orcamento.id, pagamentoId: "1234567890", valorCentavos: 30000 }]);
	});

	it("falha do provedor deixa o estorno pendente e publica EstornoFalhou", async () => {
		const orcamento = salvar(orcamentoPago());
		pagamentos.falharEstornos = true;

		await expect(uc.execute(comandoComMotivo("EstornarPagamento"))).resolves.toBeUndefined();

		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.ESTORNO_PENDENTE);
		expect(estornados()).toEqual([]);
		expect(publicador.doTipo("EstornoFalhou")).toHaveLength(1);
	});

	it("comando com estorno pendente tenta de novo na hora", async () => {
		const orcamento = salvar(orcamentoPago().registrarFalhaEstorno("fora do ar", new Date(Date.now() + 60_000), new Date()));

		await uc.execute(comandoComMotivo("EstornarPagamento"));

		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.ESTORNADO);
		expect(estornados()).toEqual([{ orcamentoId: orcamento.id, pagamentoId: "1234567890", valorCentavos: 30000 }]);
	});

	it("comando duplicado não faz nada", async () => {
		salvar(orcamentoPago());
		const comando = comandoComMotivo("EstornarPagamento");

		await uc.execute(comando);
		await uc.execute(comando);

		expect(estornados()).toHaveLength(1);
	});
});
