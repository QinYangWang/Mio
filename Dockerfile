FROM node:24.19.0 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
FROM oven/bun:1.4.2
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER bun
CMD ["bun", "src/main.ts"]
