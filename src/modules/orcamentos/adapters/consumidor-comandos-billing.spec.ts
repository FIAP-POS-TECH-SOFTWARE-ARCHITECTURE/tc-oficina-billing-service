import { comandoComMotivo, comandoGerarOrcamento } from "../../../../test/suporte/fabricas";
import type { ConsumidorSqs } from "../../mensageria/consumidor-sqs";
import type { CancelarOrcamentoUseCase } from "../application/use-cases/cancelar-orcamento.use-case";
import type { EstornarPagamentoUseCase } from "../application/use-cases/estornar-pagamento.use-case";
import type { GerarOrcamentoUseCase } from "../application/use-cases/gerar-orcamento.use-case";
import { ConsumidorComandosBilling } from "./consumidor-comandos-billing";

describe("ConsumidorComandosBilling", () => {
	const consumidor = { iniciar: jest.fn() };
	const gerar = { execute: jest.fn().mockResolvedValue(undefined) };
	const cancelar = { execute: jest.fn().mockResolvedValue(undefined) };
	const estornar = { execute: jest.fn().mockResolvedValue(undefined) };
	const adaptador = new ConsumidorComandosBilling(
		consumidor as unknown as ConsumidorSqs,
		gerar as unknown as GerarOrcamentoUseCase,
		cancelar as unknown as CancelarOrcamentoUseCase,
		estornar as unknown as EstornarPagamentoUseCase,
	);

	beforeEach(() => {
		jest.clearAllMocks();
		process.env.SQS_BILLING_COMANDOS_URL = "http://fila-billing";
		delete process.env.WORKERS_HABILITADOS;
	});

	it.each([
		["GerarOrcamento", () => comandoGerarOrcamento(), gerar],
		["CancelarOrcamento", () => comandoComMotivo("CancelarOrcamento"), cancelar],
		["EstornarPagamento", () => comandoComMotivo("EstornarPagamento"), estornar],
	])("despacha %s para o use case certo", async (_tipo, montar, alvo) => {
		const comando = montar();
		await adaptador.despachar(comando);
		expect(alvo.execute).toHaveBeenCalledWith(comando);
	});

	it("tipo não suportado é rejeitado (a mensagem não é apagada)", async () => {
		await expect(adaptador.despachar({ ...comandoComMotivo("CancelarOrcamento"), tipo: "IniciarReparo" })).rejects.toThrow(
			"Tipo de comando não suportado",
		);
	});

	it("inicia o consumo da fila de comandos no bootstrap e despacha pelo manipulador", async () => {
		adaptador.onApplicationBootstrap();

		expect(consumidor.iniciar).toHaveBeenCalledWith("http://fila-billing", expect.any(Function));
		const manipulador = consumidor.iniciar.mock.calls[0][1] as (e: unknown) => Promise<void>;
		const comando = comandoGerarOrcamento();
		await manipulador(comando);
		expect(gerar.execute).toHaveBeenCalledWith(comando);
	});

	it("não inicia com WORKERS_HABILITADOS=false", () => {
		process.env.WORKERS_HABILITADOS = "false";
		adaptador.onApplicationBootstrap();
		expect(consumidor.iniciar).not.toHaveBeenCalled();
	});

	it("não inicia sem a URL da fila", () => {
		delete process.env.SQS_BILLING_COMANDOS_URL;
		adaptador.onApplicationBootstrap();
		expect(consumidor.iniciar).not.toHaveBeenCalled();
	});
});
