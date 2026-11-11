FROM eclipse-temurin:21-jdk AS backend-build
WORKDIR /workspace/backend
COPY backend/ ./
RUN chmod +x mvnw && ./mvnw -B -ntp -DskipTests package dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=target/dependency

FROM eclipse-temurin:21-jre AS java-runtime
WORKDIR /app

FROM java-runtime AS backend
COPY --from=backend-build /workspace/backend/target/exchange-0.0.1-SNAPSHOT.jar /app/exchange.jar
ENTRYPOINT ["java", "-jar", "/app/exchange.jar"]

FROM java-runtime AS emulator
COPY --from=backend-build /workspace/backend/target/classes /app/classes
COPY --from=backend-build /workspace/backend/target/dependency /app/lib
ENTRYPOINT ["java", "-cp", "/app/classes:/app/lib/*", "ru.secreate.exchange.emulator.EmulatorMain", "9090"]

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html

FROM node:24-alpine AS seed
WORKDIR /app
COPY scripts/demo-seed.mjs /app/demo-seed.mjs
COPY scripts/demo-seed-identity.mjs /app/demo-seed-identity.mjs
ENTRYPOINT ["node", "/app/demo-seed.mjs"]

# Optional Linux verification targets; not used by the ordinary application.
FROM backend-build AS backend-check
CMD ["./mvnw", "-B", "-ntp", "verify"]

FROM frontend-build AS frontend-check
RUN npm run lint && npm run test:styles

FROM docker:cli AS docker-client
FROM frontend-build AS browser-check
RUN apk add --no-cache chromium
COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker
ENV TASK3_BROWSER=/usr/bin/chromium

FROM node:24-alpine AS agent-check
RUN apk add --no-cache git
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
# Hook tests resolve the checkout root via git; build contexts exclude the host .git.
RUN git init -q && npm run check:agents
