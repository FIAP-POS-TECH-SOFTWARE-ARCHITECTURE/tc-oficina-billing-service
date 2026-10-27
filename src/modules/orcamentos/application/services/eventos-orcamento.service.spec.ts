import { OrcamentosMemoriaGateway } from "../../../../../test/suporte/orcamentos-memoria.gateway";
import { PublicadorMemoria } from "../../../../../test/suporte/publicador-memoria";
import { criarEventoBilling } from "../eventos-billing";
import { MensagemJaProcessadaError } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "./eventos-orcamento.service";

const contexto = { fluxoId: "f-1", osId: "os-1", numeroOs: "OS-1", correlationId: "req-1" };
const evento = (ocorridoEm?: Date) => ({
	...criarEventoBilling(contexto, "OrcamentoCancelado", { orcamentoId: null, motivo: "x" }),
	...(ocorridoEm ? { ocorridoEm: ocorridoEm.toISOString() } : {}),
});

describe("EventosOrcamentoService", () => {
	let gateway: OrcamentosMemoriaGateway;
	let publicador: PublicadorMemoria;
	let servico: EventosOrcamentoService;

	beforeEach(() => {
		gateway = new OrcamentosMemoriaGateway();
		publicador = new PublicadorMemoria();
		servico = new EventosOrcamentoService(gateway, publicador);
	});

	it("grava, publica na hora e tira o evento da lista de pendentes", async () => {
		const e = evento();
		await expect(servico.registrar({ mensagemProcessada: "m1", eventos: [e] })).resolves.toBe(true);
		expect(publicador.eventos).toEqual([e]);
		expect(gateway.eventos.get(e.messageId)?.pendente).toBe(false);
	});

	it("publicador fora do ar não desfaz a gravação: evento fica pendente", async () => {
		publicador.falhar = true;
		const e = evento();
		await expect(servico.registrar({ mensagemProcessada: "m1", eventos: [e] })).resolves.toBe(true);
		expect(publicador.eventos).toHaveLength(0);
		expect(gateway.eventos.get(e.messageId)?.pendente).toBe(true);
	});

	it("mensagem já processada devolve false e não publica", async () => {
		await servico.registrar({ mensagemProcessada: "m1", eventos: [] });
		const e = evento();
		await expect(servico.registrar({ mensagemProcessada: "m1", eventos: [e] })).resolves.toBe(false);
		expect(publicador.eventos).toHaveLength(0);
		expect(gateway.eventos.has(e.messageId)).toBe(false);
	});

	it("outros erros de gravação propagam", async () => {
		jest.spyOn(gateway, "registrarEfeitos").mockRejectedValue(new Error("DynamoDB fora"));
		await expect(servico.registrar({ eventos: [evento()] })).rejects.toThrow("DynamoDB fora");
	});

	it("criar, atualizar e cancelamento antecipado também publicam e engolem duplicata", async () => {
		const duplicada = new MensagemJaProcessadaError("m1");
		jest.spyOn(gateway, "criar").mockResolvedValue();
		jest.spyOn(gateway, "atualizar").mockRejectedValue(duplicada);
		jest.spyOn(gateway, "registrarCancelamentoAntecipado").mockResolvedValue();
		const [e1, e2, e3] = [evento(), evento(), evento()];

		await expect(servico.criar({} as never, { eventos: [e1] })).resolves.toBe(true);
		await expect(servico.atualizar({} as never, 1, { eventos: [e2] })).resolves.toBe(false);
		await expect(
			servico.registrarCancelamentoAntecipado({ fluxoId: "f", osId: "o", motivo: "m", canceladoEm: "" }, { eventos: [e3] }),
		).resolves.toBe(true);
		expect(publicador.eventos).toEqual([e1, e3]);
	});

	it("republicarPendentes publica só os eventos com mais de 10 s", async () => {
		const agora = new Date("2026-10-20T13:05:30.000Z");
		const antigo = evento(new Date("2026-10-20T13:05:00.000Z"));
		const recente = evento(new Date("2026-10-20T13:05:25.000Z"));
		publicador.falhar = true;
		await servico.registrar({ eventos: [antigo, recente] });
		publicador.falhar = false;

		await expect(servico.republicarPendentes(agora)).resolves.toBe(1);

		expect(publicador.eventos).toEqual([antigo]);
		expect(gateway.eventos.get(antigo.messageId)?.pendente).toBe(false);
		expect(gateway.eventos.get(recente.messageId)?.pendente).toBe(true);
	});
});
