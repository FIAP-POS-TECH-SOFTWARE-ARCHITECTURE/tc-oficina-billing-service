import { comandoGerarOrcamento } from "../../../../../test/suporte/fabricas";
import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { ConflitoConcorrenciaError, OrcamentoJaExisteError } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";
import { GerarOrcamentoUseCase } from "./gerar-orcamento.use-case";

describe("GerarOrcamentoUseCase", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let uc: GerarOrcamentoUseCase;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		uc = new GerarOrcamentoUseCase(gateway, new EventosOrcamentoService(gateway, publicador));
	});

	it("cria o orçamento e publica OrcamentoGerado com o correlationId do comando", async () => {
		const comando = comandoGerarOrcamento();

		await uc.execute(comando);

		const orcamento = await gateway.buscarPorOsId(comando.osId);
		expect(orcamento?.numeroOs).toBe(comando.numeroOs);
		const [evento] = publicador.doTipo("OrcamentoGerado");
		expect(evento.payload).toEqual({ orcamentoId: orcamento!.id, valorTotalCentavos: 30000 });
		expect(evento).toMatchObject({ correlationId: comando.correlationId, fluxoId: comando.fluxoId, origem: "billing" });
	});

	it("comando duplicado não gera segundo orçamento nem segundo evento", async () => {
		const comando = comandoGerarOrcamento();

		await uc.execute(comando);
		await uc.execute(comando);

		expect(gateway.contarPorOs(comando.osId)).toBe(1);
		expect(publicador.doTipo("OrcamentoGerado")).toHaveLength(1);
	});

	it("soma dos itens diferente do total → FalhaGerarOrcamento sem criar orçamento", async () => {
		const comando = comandoGerarOrcamento({ payload: { valorTotalCentavos: 29999 } });

		await uc.execute(comando);

		expect(gateway.contarPorOs(comando.osId)).toBe(0);
		expect(publicador.doTipo("FalhaGerarOrcamento").map((e) => e.payload)).toEqual([{ motivo: "VALOR_TOTAL_INCONSISTENTE" }]);
	});

	it("outro messageId para OS com orçamento ativo reemite OrcamentoGerado do mesmo orçamento", async () => {
		const primeiro = comandoGerarOrcamento();
		await uc.execute(primeiro);
		await uc.execute(comandoGerarOrcamento());

		const gerados = publicador.doTipo("OrcamentoGerado");
		expect(gerados).toHaveLength(2);
		expect(gerados[1].payload.orcamentoId).toBe(gerados[0].payload.orcamentoId);
		expect(gateway.contarPorOs(primeiro.osId)).toBe(1);
	});

	it("OS com orçamento encerrado → FalhaGerarOrcamento ORCAMENTO_ENCERRADO", async () => {
		const comando = comandoGerarOrcamento();
		await uc.execute(comando);
		const orcamento = (await gateway.buscarPorOsId(comando.osId))!;
		await gateway.atualizar(orcamento.rejeitar(null, new Date()), orcamento.versao, { eventos: [] });

		await uc.execute(comandoGerarOrcamento());

		expect(publicador.doTipo("FalhaGerarOrcamento").map((e) => e.payload)).toEqual([{ motivo: "ORCAMENTO_ENCERRADO" }]);
	});

	it("fluxo cancelado antes do comando: não cria e reemite OrcamentoCancelado sem orçamento", async () => {
		const comando = comandoGerarOrcamento();
		gateway.cancelamentos.set(comando.fluxoId, {
			fluxoId: comando.fluxoId,
			osId: comando.osId,
			motivo: "PRAZO_RESPOSTA_SERVICO",
			canceladoEm: "",
		});

		await uc.execute(comando);

		expect(gateway.contarPorOs(comando.osId)).toBe(0);
		expect(publicador.doTipo("OrcamentoCancelado").map((e) => e.payload)).toEqual([
			{ orcamentoId: null, motivo: "PRAZO_RESPOSTA_SERVICO" },
		]);
		await expect(gateway.mensagemJaProcessada(comando.messageId)).resolves.toBe(true);
	});

	it("corrida na criação: relê o orçamento vencedor e reemite OrcamentoGerado", async () => {
		const vencedor = comandoGerarOrcamento();
		await uc.execute(vencedor);
		const orcamentoId = publicador.doTipo("OrcamentoGerado")[0].payload.orcamentoId;
		const buscar = jest.spyOn(gateway, "buscarPorOsId");
		buscar.mockResolvedValueOnce(null);

		await uc.execute(comandoGerarOrcamento());

		const gerados = publicador.doTipo("OrcamentoGerado");
		expect(gerados).toHaveLength(2);
		expect(gerados[1].payload.orcamentoId).toBe(orcamentoId);
	});

	it("corrida sem orçamento relido propaga o erro original", async () => {
		jest.spyOn(gateway, "criar").mockRejectedValue(new OrcamentoJaExisteError("os"));
		await expect(uc.execute(comandoGerarOrcamento())).rejects.toBeInstanceOf(OrcamentoJaExisteError);
	});

	it("conflito de concorrência propaga (mensagem volta à fila)", async () => {
		jest.spyOn(gateway, "criar").mockRejectedValue(new ConflitoConcorrenciaError("fluxo"));
		await expect(uc.execute(comandoGerarOrcamento())).rejects.toBeInstanceOf(ConflitoConcorrenciaError);
		expect(publicador.eventos).toHaveLength(0);
	});

	it("erro inesperado ao montar o orçamento propaga", async () => {
		const comando = comandoGerarOrcamento();
		(comando.payload as { itens: unknown }).itens = null;
		await expect(uc.execute(comando)).rejects.toBeInstanceOf(TypeError);
	});
});
