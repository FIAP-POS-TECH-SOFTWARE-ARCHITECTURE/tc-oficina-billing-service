# syntax=docker/dockerfile:1.7

FROM node:25-alpine3.22 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build
RUN npm ci --omit=dev

FROM node:25-alpine3.22 AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 oficina && adduser -D -u 1001 -G oficina oficina
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY contratos ./contratos
RUN chown -R oficina:oficina /app
USER oficina
EXPOSE 3000
CMD ["node", "dist/main.js"]
