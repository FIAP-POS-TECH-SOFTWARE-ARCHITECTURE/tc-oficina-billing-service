import { CLIENTE_ID, OUTRO_CLIENTE_ID, orcamentoNovo } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { GatewayPagamentoSimulado } from "../../adapters/gateways/gateway-pagamento.simulado";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { ConflitoConcorrenciaError } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { AprovarOrcamentoUseCase } from "./aprovar-orcamento.use-case";

const COBRANCA = { linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" };

describe("AprovarOrcamentoUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let pagamentos: GatewayPagamentoSimulado;
	let uc: AprovarOrcamentoUseCase;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		pagamentos = new GatewayPagamentoSimulado();
		uc = new AprovarOrcamentoUseCase(gateway, pagamentos, new EventosOrcamentoService(gateway, publicador));
	});

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};

	it("404 quando não há orçamento para a OS", async () => {
		await expect(uc.execute("OS-X", CLIENTE_ID, "req-1")).resolves.toMatchObject({ status: 404 });
	});

	it("403 para orçamento de outro cliente, sem gravar nada", async () => {
		const orcamento = salvar(orcamentoNovo());
		await expect(uc.execute(orcamento.numeroOs, OUTRO_CLIENTE_ID, "req-1")).resolves.toMatchObject({ status: 403 });
		expect((await gateway.buscarPorId(orcamento.id))?.versao).toBe(1);
		expect(publicador.eventos).toHaveLength(0);
	});

	it.each([
		["APROVADO", () => orcamentoNovo().aprovar(COBRANCA, new Date(Date.now() + 60_000), new Date())],
		["CANCELADO", () => orcamentoNovo().cancelar("x", new Date())],
	])("422 para orçamento %s", async (_status, montar) => {
		const orcamento = salvar(montar());
		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, "req-1")).resolves.toMatchObject({ status: 422 });
		expect(publicador.doTipo("OrcamentoAprovado")).toHaveLength(0);
	});

	it("422 com prazo de aprovação vencido", async () => {
		const orcamento = salvar(orcamentoNovo({ prazoAprovacaoEm: "2020-01-01T00:00:00.000Z" }));
		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, "req-1")).resolves.toMatchObject({ status: 422 });
	});

	it("200 cria cobrança, aprova e publica OrcamentoAprovado", async () => {
		const orcamento = salvar(orcamentoNovo());
		const criarCobranca = jest.spyOn(pagamentos, "criarCobranca");
		const antes = Date.now();

		const resposta = await uc.execute(orcamento.numeroOs, CLIENTE_ID, "req-1");

		expect(resposta.status).toBe(200);
		const data = resposta.data!;
		expect(data.linkPagamento).toBe(`https://pagamento.simulado.local/checkout/${orcamento.id}`);
		const esperado = antes + orcamento.prazoPagamentoMinutos * 60_000;
		expect(Math.abs(new Date(data.prazoPagamentoEm).getTime() - esperado)).toBeLessThan(5_000);
		expect((await gateway.buscarPorId(orcamento.id))?.status).toBe(StatusOrcamento.APROVADO);

		const [evento] = publicador.doTipo("OrcamentoAprovado");
		expect(evento).toMatchObject({ correlationId: "req-1", payload: { orcamentoId: orcamento.id, ...data } });
		expect(publicador.doTipo("OrcamentoAprovado")).toHaveLength(1);

		const dados = criarCobranca.mock.calls[0][0];
		expect(dados.expiraEm.toISOString()).toBe(data.prazoPagamentoEm);
		expect(dados.valorTotalCentavos).toBe(30000);
		expect(dados.itens).toEqual(
			orcamento.itens.map(({ referenciaId, descricao, quantidade, precoUnitarioCentavos }) => ({
				referenciaId,
				descricao,
				quantidade,
				precoUnitarioCentavos,
			})),
		);
	});

	it("422 quando o orçamento muda entre a leitura e a escrita, sem evento de aprovação", async () => {
		const orcamento = salvar(orcamentoNovo());
		jest.spyOn(gateway, "atualizar").mockRejectedValue(new ConflitoConcorrenciaError(orcamento.id));

		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, "req-1")).resolves.toMatchObject({ status: 422 });

		expect(publicador.doTipo("OrcamentoAprovado")).toHaveLength(0);
	});

	it("outros erros de gravação propagam", async () => {
		const orcamento = salvar(orcamentoNovo());
		jest.spyOn(gateway, "atualizar").mockRejectedValue(new Error("DynamoDB fora"));
		await expect(uc.execute(orcamento.numeroOs, CLIENTE_ID, "req-1")).rejects.toThrow("DynamoDB fora");
	});
});
