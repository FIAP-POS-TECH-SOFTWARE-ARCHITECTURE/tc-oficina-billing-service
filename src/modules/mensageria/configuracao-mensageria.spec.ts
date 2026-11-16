import { workersHabilitados } from "./configuracao-mensageria";

describe("workersHabilitados", () => {
	afterEach(() => delete process.env.WORKERS_HABILITADOS);

	it("ligado quando a variável não existe", () => {
		delete process.env.WORKERS_HABILITADOS;
		expect(workersHabilitados()).toBe(true);
	});

	it('desligado com "false"', () => {
		process.env.WORKERS_HABILITADOS = "false";
		expect(workersHabilitados()).toBe(false);
	});
});
