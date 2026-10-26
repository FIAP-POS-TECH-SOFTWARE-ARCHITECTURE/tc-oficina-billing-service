import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";

export const CAMINHO_SWAGGER = "billing/docs";

// Probes do Kubernetes e notificações do Mercado Pago chegam em rajada e todas do mesmo IP (gateway/LB).
const ROTAS_SEM_LIMITE = ["/health", "/billing/webhooks"];

export function configurarApp(app: INestApplication): void {
	app.use(helmet());
	app.use(
		rateLimit({
			windowMs: 15 * 60 * 1000,
			max: 100,
			standardHeaders: true,
			legacyHeaders: false,
			skip: (req) => ROTAS_SEM_LIMITE.some((prefixo) => req.path.startsWith(prefixo)),
		}),
	);
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);

	const reflector = app.get(Reflector);
	app.useGlobalGuards(new JwtAuthGuard(app.get(JwtService), reflector), new RolesGuard(reflector));
	app.useGlobalInterceptors(new ResponseInterceptor());
	app.useGlobalFilters(new AllExceptionsFilter());

	const config = new DocumentBuilder()
		.setTitle("Oficina Billing Service")
		.setDescription("Orçamentos e pagamentos da oficina mecânica")
		.setVersion("1.0")
		.addBearerAuth()
		.build();
	SwaggerModule.setup(CAMINHO_SWAGGER, app, SwaggerModule.createDocument(app, config));
}
