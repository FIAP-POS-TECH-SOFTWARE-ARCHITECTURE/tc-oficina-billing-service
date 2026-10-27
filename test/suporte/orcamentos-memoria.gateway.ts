import type { EnvelopeMensagem } from "../../src/modules/mensageria/envelope";
import type { PagamentoExterno } from "../../src/modules/orcamentos/application/ports/gateway-pagamento.port";
import {
	type CancelamentoAntecipado,
	ConflitoConcorrenciaError,
	type EfeitosGravacao,
	MensagemJaProcessadaError,
	OrcamentoJaExisteError,
	type OrcamentosGatewayPort,
} from "../../src/modules/orcamentos/application/ports/orcamentos.gateway";
import { type DadosOrcamento, Orcamento } from "../../src/modules/orcamentos/domain/orcamento.entity";
import type { StatusOrcamento } from "../../src/modules/orcamentos/domain/status-orcamento";

export class OrcamentosMemoriaGateway implements OrcamentosGatewayPort {
	readonly orcamentos = new Map<string, DadosOrcamento>();
	readonly chaves = new Set<string>();
	readonly cancelamentos = new Map<string, CancelamentoAntecipado>();
	readonly pagamentos = new Map<string, PagamentoExterno>();
	readonly eventos = new Map<string, { envelope: EnvelopeMensagem<unknown>; pendente: boolean }>();

	async buscarPorId(id: string) {
		const d = this.orcamentos.get(id);
		return d ? Orcamento.restaurar(structuredClone(d)) : null;
	}
	async buscarPorOsId(osId: string) {
		return this.achar((d) => d.osId === osId);
	}
	async buscarPorNumeroOs(numeroOs: string) {
		return this.achar((d) => d.numeroOs === numeroOs);
	}
	async listarPorStatus(status: StatusOrcamento) {
		return [...this.orcamentos.values()].filter((d) => d.status === status).map((d) => Orcamento.restaurar(structuredClone(d)));
	}
	async buscarCancelamentoAntecipado(fluxoId: string) {
		return this.cancelamentos.get(fluxoId) ?? null;
	}
	async mensagemJaProcessada(messageId: string) {
		return this.chaves.has(`MSG#${messageId}`);
	}
	async notificacaoJaProcessada(chave: string) {
		return this.chaves.has(`WEBHOOK#${chave}`);
	}
	async criar(orcamento: Orcamento, efeitos: EfeitosGravacao) {
		this.verificarDedupe(efeitos);
		if ([...this.orcamentos.values()].some((d) => d.osId === orcamento.osId || d.numeroOs === orcamento.numeroOs))
			throw new OrcamentoJaExisteError(orcamento.osId);
		if (this.cancelamentos.has(orcamento.fluxoId)) throw new ConflitoConcorrenciaError(`fluxo ${orcamento.fluxoId}`);
		this.orcamentos.set(orcamento.id, orcamento.paraDados());
		this.aplicar(efeitos);
	}
	async atualizar(orcamento: Orcamento, versaoAnterior: number, efeitos: EfeitosGravacao) {
		this.verificarDedupe(efeitos);
		if (this.orcamentos.get(orcamento.id)?.versao !== versaoAnterior) throw new ConflitoConcorrenciaError(orcamento.id);
		this.orcamentos.set(orcamento.id, orcamento.paraDados());
		this.aplicar(efeitos);
	}
	async registrarCancelamentoAntecipado(c: CancelamentoAntecipado, efeitos: EfeitosGravacao) {
		this.verificarDedupe(efeitos);
		if ([...this.orcamentos.values()].some((d) => d.osId === c.osId)) throw new ConflitoConcorrenciaError(`os ${c.osId}`);
		this.cancelamentos.set(c.fluxoId, c);
		this.aplicar(efeitos);
	}
	async registrarEfeitos(efeitos: EfeitosGravacao) {
		this.verificarDedupe(efeitos);
		this.aplicar(efeitos);
	}
	async listarEventosPendentes(antesDe: Date, limite: number) {
		return [...this.eventos.values()]
			.filter((e) => e.pendente && e.envelope.ocorridoEm < antesDe.toISOString())
			.slice(0, limite)
			.map((e) => e.envelope);
	}
	async marcarEventoPublicado(messageId: string) {
		const e = this.eventos.get(messageId);
		if (e) e.pendente = false;
	}
	contarPorOs(osId: string): number {
		return [...this.orcamentos.values()].filter((d) => d.osId === osId).length;
	}

	private achar(filtro: (d: DadosOrcamento) => boolean) {
		const d = [...this.orcamentos.values()].find(filtro);
		return d ? Orcamento.restaurar(structuredClone(d)) : null;
	}
	private verificarDedupe(efeitos: EfeitosGravacao) {
		if (efeitos.mensagemProcessada && this.chaves.has(`MSG#${efeitos.mensagemProcessada}`))
			throw new MensagemJaProcessadaError(efeitos.mensagemProcessada);
		if (efeitos.notificacaoProcessada && this.chaves.has(`WEBHOOK#${efeitos.notificacaoProcessada}`))
			throw new MensagemJaProcessadaError(efeitos.notificacaoProcessada);
	}
	private aplicar(efeitos: EfeitosGravacao) {
		if (efeitos.mensagemProcessada) this.chaves.add(`MSG#${efeitos.mensagemProcessada}`);
		if (efeitos.notificacaoProcessada) this.chaves.add(`WEBHOOK#${efeitos.notificacaoProcessada}`);
		for (const p of efeitos.pagamentos ?? []) this.pagamentos.set(p.pagamentoId, p);
		for (const e of efeitos.eventos) this.eventos.set(e.messageId, { envelope: e, pendente: true });
	}
}
