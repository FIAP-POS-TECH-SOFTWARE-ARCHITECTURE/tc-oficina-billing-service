import { CLIENTE_ID, OUTRO_CLIENTE_ID, orcamentoNovo } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import type { Orcamento } from "../../domain/orcamento.entity";
import { StatusOrcamento } from "../../domain/status-orcamento";
import { ConsultarOrcamentoClienteUseCase } from "./consultar-orcamento-cliente.use-case";
import { ConsultarOrcamentoUseCase } from "./consultar-orcamento.use-case";
import { ListarOrcamentosUseCase } from "./listar-orcamentos.use-case";

const COBRANCA = { linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" };

describe("consultas de orçamento", () => {
	let gateway: OrcamentosMemoriaGateway;

	beforeEach(() => (gateway = new OrcamentosMemoriaGateway()));

	const salvar = (orcamento: Orcamento) => {
		gateway.orcamentos.set(orcamento.id, orcamento.paraDados());
		return orcamento;
	};

	describe("ConsultarOrcamentoClienteUseCase", () => {
		const uc = () => new ConsultarOrcamentoClienteUseCase(gateway);

		it("404 sem orçamento e 403 para outro cliente", async () => {
			await expect(uc().execute("OS-X", CLIENTE_ID)).resolves.toMatchObject({ status: 404 });
			const orcamento = salvar(orcamentoNovo());
			await expect(uc().execute(orcamento.numeroOs, OUTRO_CLIENTE_ID)).resolves.toMatchObject({ status: 403 });
		});

		it("200 com link de pagamento só quando aprovado", async () => {
			const aguardando = salvar(orcamentoNovo());
			await expect(uc().execute(aguardando.numeroOs, CLIENTE_ID)).resolves.toMatchObject({
				status: 200,
				data: { id: aguardando.id, status: StatusOrcamento.AGUARDANDO_APROVACAO, linkPagamento: null, valorTotalCentavos: 30000 },
			});

			const aprovado = salvar(aguardando.aprovar(COBRANCA, new Date(Date.now() + 60_000), new Date()));
			await expect(uc().execute(aprovado.numeroOs, CLIENTE_ID)).resolves.toMatchObject({
				data: { status: StatusOrcamento.APROVADO, linkPagamento: COBRANCA.linkPagamento },
			});

			const cancelado = salvar(aprovado.cancelar("x", new Date()));
			await expect(uc().execute(cancelado.numeroOs, CLIENTE_ID)).resolves.toMatchObject({ data: { linkPagamento: null } });
		});
	});

	describe("ConsultarOrcamentoUseCase (oficina)", () => {
		it("404 sem orçamento e 200 sem checar dono", async () => {
			const uc = new ConsultarOrcamentoUseCase(gateway);
			await expect(uc.execute("OS-X")).resolves.toMatchObject({ status: 404 });
			const orcamento = salvar(orcamentoNovo());
			await expect(uc.execute(orcamento.numeroOs)).resolves.toMatchObject({ status: 200, data: { id: orcamento.id } });
		});
	});

	describe("ListarOrcamentosUseCase", () => {
		const criar = (id: string, numeroOs: string, criadoEm: string) =>
			salvar(orcamentoNovo({ id, osId: `os-${id}`, numeroOs }, new Date(criadoEm)));

		it("filtra pelo status informado", async () => {
			criar("a", "OS-A", "2026-10-20T10:00:00.000Z");
			const b = criar("b", "OS-B", "2026-10-20T11:00:00.000Z");
			salvar(b.rejeitar(null, new Date()));

			const resposta = await new ListarOrcamentosUseCase(gateway).execute(StatusOrcamento.REJEITADO);

			expect(resposta.data?.map((o) => o.id)).toEqual(["b"]);
		});

		it("sem status lista todos, mais recentes primeiro", async () => {
			criar("a", "OS-A", "2026-10-20T10:00:00.000Z");
			const b = criar("b", "OS-B", "2026-10-20T12:00:00.000Z");
			criar("c", "OS-C", "2026-10-20T11:00:00.000Z");
			salvar(b.cancelar("x", new Date()));

			const resposta = await new ListarOrcamentosUseCase(gateway).execute();

			expect(resposta.data?.map((o) => o.id)).toEqual(["b", "c", "a"]);
		});
	});
});
