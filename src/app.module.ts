import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { AwsModule } from "./common/aws/aws.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
	imports: [
		ConfigModule.forRoot(),
		LoggerModule.forRoot({
			pinoHttp: {
				genReqId: (req) => {
					const header = req.headers["x-request-id"];
					if (Array.isArray(header)) return header[0] ?? randomUUID();
					return header?.split(",")[0].trim() || randomUUID();
				},
				customProps: (req) => ({ requestId: req.id }),
				redact: ["req.headers.authorization"],
				autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
				transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
			},
		}),
		JwtModule.register({ global: true, secret: process.env.JWT_SECRET }),
		ScheduleModule.forRoot(),
		AwsModule,
		HealthModule,
	],
})
export class AppModule {}
