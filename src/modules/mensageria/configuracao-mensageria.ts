/** Consumidor SQS e jobs ligados por padrão; `WORKERS_HABILITADOS=false` desliga (testes e2e/BDD e execução local só HTTP). */
export function workersHabilitados(): boolean {
	return process.env.WORKERS_HABILITADOS !== "false";
}
