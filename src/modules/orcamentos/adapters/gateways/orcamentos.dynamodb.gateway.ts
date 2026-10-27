import {
	DynamoDBDocumentClient,
	GetCommand,
	QueryCommand,
	TransactWriteCommand,
	type TransactWriteCommandInput,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { CLIENTE_DYNAMODB } from "../../../../common/aws/clientes-aws";
import type { EnvelopeMensagem } from "../../../mensageria/envelope";
import type { PagamentoExterno } from "../../application/ports/gateway-pagamento.port";
import {
	type CancelamentoAntecipado,
	ConflitoConcorrenciaError,
	type EfeitosGravacao,
	MensagemJaProcessadaError,
	OrcamentoJaExisteError,
	type OrcamentosGatewayPort,
} from "../../application/ports/orcamentos.gateway";
import { type DadosOrcamento, Orcamento } from "../../domain/orcamento.entity";
import type { StatusOrcamento } from "../../domain/status-orcamento";

type ItemTransacao = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type Item = Record<string, unknown>;

const SEM_CHAVE = "attribute_not_exists(pk)";
const CHAVES_TECNICAS = new Set(["pk", "sk", "gsi1pk", "gsi1sk", "tipoItem"]);
const chaveOrcamento = (id: string) => ({ pk: `ORCAMENTO#${id}`, sk: "ORCAMENTO" });
const itemParaDados = (item: Item) =>
	Object.fromEntries(Object.entries(item).filter(([chave]) => !CHAVES_TECNICAS.has(chave))) as unknown as DadosOrcamento;

@Injectable()
export class OrcamentosDynamoDbGateway implements OrcamentosGatewayPort {
	constructor(@Inject(CLIENTE_DYNAMODB) private readonly db: DynamoDBDocumentClient) {}

	private get tabela(): string {
		const tabela = process.env.DYNAMODB_TABLE;
		if (!tabela) throw new Error("DYNAMODB_TABLE não definido");
		return tabela;
	}

	async buscarPorId(orcamentoId: string): Promise<Orcamento | null> {
		const item = await this.obter(chaveOrcamento(orcamentoId));
		return item ? Orcamento.restaurar(itemParaDados(item)) : null;
	}

	buscarPorOsId(osId: string): Promise<Orcamento | null> {
		return this.buscarPorPonteiro(`OS#${osId}`);
	}

	buscarPorNumeroOs(numeroOs: string): Promise<Orcamento | null> {
		return this.buscarPorPonteiro(`NUMERO_OS#${numeroOs}`);
	}

	async listarPorStatus(status: StatusOrcamento): Promise<Orcamento[]> {
		const itens: Item[] = [];
		let inicio: Item | undefined;
		do {
			const r = await this.db.send(
				new QueryCommand({
					TableName: this.tabela,
					IndexName: "gsi1",
					KeyConditionExpression: "gsi1pk = :pk",
					ExpressionAttributeValues: { ":pk": `STATUS#${status}` },
					ExclusiveStartKey: inicio,
				}),
			);
			itens.push(...(r.Items ?? []));
			inicio = r.LastEvaluatedKey;
		} while (inicio);
		return itens.map((item) => Orcamento.restaurar(itemParaDados(item)));
	}

	async buscarCancelamentoAntecipado(fluxoId: string): Promise<CancelamentoAntecipado | null> {
		const item = await this.obter({ pk: `FLUXO_CANCELADO#${fluxoId}`, sk: "FLUXO" });
		return item
			? { fluxoId, osId: item.osId as string, motivo: item.motivo as string, canceladoEm: item.canceladoEm as string }
			: null;
	}

	async mensagemJaProcessada(messageId: string): Promise<boolean> {
		return (await this.obter({ pk: `MSG#${messageId}`, sk: "MSG" })) !== null;
	}

	async notificacaoJaProcessada(chave: string): Promise<boolean> {
		return (await this.obter({ pk: `WEBHOOK#${chave}`, sk: "WEBHOOK" })) !== null;
	}

	async criar(orcamento: Orcamento, efeitos: EfeitosGravacao): Promise<void> {
		const ponteiro = (pk: string): ItemTransacao => ({
			Put: {
				TableName: this.tabela,
				Item: { pk, sk: "ORCAMENTO", tipoItem: "PONTEIRO", orcamentoId: orcamento.id },
				ConditionExpression: SEM_CHAVE,
			},
		});
		await this.executar(
			[
				...this.itensDedupe(efeitos),
				{ Put: { TableName: this.tabela, Item: this.itemOrcamento(orcamento), ConditionExpression: SEM_CHAVE } },
				ponteiro(`OS#${orcamento.osId}`),
				ponteiro(`NUMERO_OS#${orcamento.numeroOs}`),
				{
					ConditionCheck: {
						TableName: this.tabela,
						Key: { pk: `FLUXO_CANCELADO#${orcamento.fluxoId}`, sk: "FLUXO" },
						ConditionExpression: SEM_CHAVE,
					},
				},
				...this.itensPagamentos(efeitos),
				...this.itensEventos(efeitos),
			],
			efeitos,
			// domínio: 0 orçamento, 1–2 ponteiros, 3 ConditionCheck do fluxo cancelado
			(indice) =>
				indice <= 2 ? new OrcamentoJaExisteError(orcamento.osId) : new ConflitoConcorrenciaError(`fluxo ${orcamento.fluxoId}`),
		);
	}

	async atualizar(orcamento: Orcamento, versaoAnterior: number, efeitos: EfeitosGravacao): Promise<void> {
		await this.executar(
			[
				...this.itensDedupe(efeitos),
				{
					Put: {
						TableName: this.tabela,
						Item: this.itemOrcamento(orcamento),
						ConditionExpression: "versao = :versaoAnterior",
						ExpressionAttributeValues: { ":versaoAnterior": versaoAnterior },
					},
				},
				...this.itensPagamentos(efeitos),
				...this.itensEventos(efeitos),
			],
			efeitos,
			() => new ConflitoConcorrenciaError(orcamento.id),
		);
	}

	async registrarCancelamentoAntecipado(cancelamento: CancelamentoAntecipado, efeitos: EfeitosGravacao): Promise<void> {
		await this.executar(
			[
				...this.itensDedupe(efeitos),
				{
					Put: {
						TableName: this.tabela,
						Item: { pk: `FLUXO_CANCELADO#${cancelamento.fluxoId}`, sk: "FLUXO", tipoItem: "FLUXO_CANCELADO", ...cancelamento },
					},
				},
				{
					ConditionCheck: {
						TableName: this.tabela,
						Key: { pk: `OS#${cancelamento.osId}`, sk: "ORCAMENTO" },
						ConditionExpression: SEM_CHAVE,
					},
				},
				...this.itensEventos(efeitos),
			],
			efeitos,
			() => new ConflitoConcorrenciaError(`os ${cancelamento.osId}`),
		);
	}

	async registrarEfeitos(efeitos: EfeitosGravacao): Promise<void> {
		const itens = [...this.itensDedupe(efeitos), ...this.itensPagamentos(efeitos), ...this.itensEventos(efeitos)];
		if (itens.length === 0) return;
		await this.executar(itens, efeitos, () => new ConflitoConcorrenciaError("efeitos"));
	}

	async listarEventosPendentes(ocorridosAntesDe: Date, limite: number): Promise<EnvelopeMensagem<unknown>[]> {
		const r = await this.db.send(
			new QueryCommand({
				TableName: this.tabela,
				IndexName: "gsi1",
				KeyConditionExpression: "gsi1pk = :p AND gsi1sk < :limite",
				ExpressionAttributeValues: { ":p": "EVENTO_PENDENTE", ":limite": ocorridosAntesDe.toISOString() },
				Limit: limite,
			}),
		);
		return (r.Items ?? []).map((item) => item.envelope as EnvelopeMensagem<unknown>);
	}

	async marcarEventoPublicado(messageId: string): Promise<void> {
		await this.db.send(
			new UpdateCommand({
				TableName: this.tabela,
				Key: { pk: `EVENTO#${messageId}`, sk: "EVENTO" },
				UpdateExpression: "SET eventoPendente = :falso, publicadoEm = :agora REMOVE gsi1pk, gsi1sk",
				ConditionExpression: "attribute_exists(pk)",
				ExpressionAttributeValues: { ":falso": false, ":agora": new Date().toISOString() },
			}),
		);
	}

	private async obter(chave: { pk: string; sk: string }): Promise<Item | null> {
		const r = await this.db.send(new GetCommand({ TableName: this.tabela, Key: chave, ConsistentRead: true }));
		return r.Item ?? null;
	}

	private async buscarPorPonteiro(pk: string): Promise<Orcamento | null> {
		const ponteiro = await this.obter({ pk, sk: "ORCAMENTO" });
		return ponteiro ? this.buscarPorId(ponteiro.orcamentoId as string) : null;
	}

	private itemOrcamento(orcamento: Orcamento): Item {
		const dados = orcamento.paraDados();
		return {
			...chaveOrcamento(dados.id),
			tipoItem: "ORCAMENTO",
			gsi1pk: `STATUS#${dados.status}`,
			gsi1sk: `${dados.criadoEm}#${dados.id}`,
			...dados,
		};
	}

	private itensDedupe(efeitos: EfeitosGravacao): ItemTransacao[] {
		const agora = new Date().toISOString();
		const itens: ItemTransacao[] = [];
		if (efeitos.mensagemProcessada)
			itens.push({
				Put: {
					TableName: this.tabela,
					Item: { pk: `MSG#${efeitos.mensagemProcessada}`, sk: "MSG", processadaEm: agora },
					ConditionExpression: SEM_CHAVE,
				},
			});
		if (efeitos.notificacaoProcessada)
			itens.push({
				Put: {
					TableName: this.tabela,
					Item: { pk: `WEBHOOK#${efeitos.notificacaoProcessada}`, sk: "WEBHOOK", processadaEm: agora },
					ConditionExpression: SEM_CHAVE,
				},
			});
		return itens;
	}

	private itensPagamentos(efeitos: EfeitosGravacao): ItemTransacao[] {
		return (efeitos.pagamentos ?? []).map((p: PagamentoExterno) => ({
			Put: {
				TableName: this.tabela,
				Item: {
					pk: `ORCAMENTO#${p.orcamentoId}`,
					sk: `PAGAMENTO#${p.pagamentoId}`,
					tipoItem: "PAGAMENTO",
					...p,
					atualizadoEm: new Date().toISOString(),
				},
			},
		}));
	}

	private itensEventos(efeitos: EfeitosGravacao): ItemTransacao[] {
		return efeitos.eventos.map((evento) => ({
			Put: {
				TableName: this.tabela,
				Item: {
					pk: `EVENTO#${evento.messageId}`,
					sk: "EVENTO",
					tipoItem: "EVENTO",
					tipo: evento.tipo,
					envelope: evento,
					eventoPendente: true,
					gsi1pk: "EVENTO_PENDENTE",
					gsi1sk: `${evento.ocorridoEm}#${evento.messageId}`,
					criadoEm: evento.ocorridoEm,
				},
				ConditionExpression: SEM_CHAVE,
			},
		}));
	}

	/** `erroDoDominio(indice)` recebe o índice do item de domínio que falhou, contado a partir do fim dos itens de dedupe. */
	private async executar(itens: ItemTransacao[], efeitos: EfeitosGravacao, erroDoDominio: (indice: number) => Error): Promise<void> {
		try {
			await this.db.send(new TransactWriteCommand({ TransactItems: itens }));
		} catch (erro) {
			if ((erro as { name?: string }).name !== "TransactionCanceledException") throw erro;
			throw await this.traduzir(erro as { CancellationReasons?: { Code?: string }[] }, efeitos, erroDoDominio);
		}
	}

	private async traduzir(
		erro: { CancellationReasons?: { Code?: string }[] },
		efeitos: EfeitosGravacao,
		erroDoDominio: (indice: number) => Error,
	): Promise<Error> {
		const chaves = [efeitos.mensagemProcessada, efeitos.notificacaoProcessada].filter((c): c is string => Boolean(c));
		const razoes = erro.CancellationReasons;
		if (razoes && razoes.length > 0) {
			const falhou = razoes.findIndex((r) => r.Code === "ConditionalCheckFailed");
			if (falhou >= 0 && falhou < chaves.length) return new MensagemJaProcessadaError(chaves[falhou]);
			if (falhou >= chaves.length) return erroDoDominio(falhou - chaves.length);
			return erro as Error;
		}
		// Emulador sem CancellationReasons: descobre a causa relendo os itens de dedupe.
		if (efeitos.mensagemProcessada && (await this.mensagemJaProcessada(efeitos.mensagemProcessada)))
			return new MensagemJaProcessadaError(efeitos.mensagemProcessada);
		if (efeitos.notificacaoProcessada && (await this.notificacaoJaProcessada(efeitos.notificacaoProcessada)))
			return new MensagemJaProcessadaError(efeitos.notificacaoProcessada);
		return erroDoDominio(0);
	}
}
