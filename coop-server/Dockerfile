# The coop relay as a container (docs/COOP_PLAN.md, D56, D66). Build from the
# repository root, which holds the protocol the relay shares with the game:
#   docker build -f coop-server/Dockerfile -t 3dtd-relay .
# The release workflow builds it as ghcr.io/ingel81/3dtd-relay.

FROM node:24-alpine AS build
WORKDIR /src
COPY coop-server/src/ coop-server/src/
COPY src/app/coop/ src/app/coop/
COPY src/app/managers/game-state/game-clock.ts src/app/managers/game-state/
# One file with ws in it; the optional native ws helpers stay out
RUN npm install --no-save --no-audit --no-fund esbuild@0.28.1 ws@8.21.3 \
 && npx esbuild coop-server/src/main.ts --bundle --platform=node --format=esm --target=node22 \
      --external:bufferutil --external:utf-8-validate \
      "--banner:js=import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
      --outfile=/out/relay.mjs

FROM node:24-alpine
WORKDIR /app
COPY --from=build /out/relay.mjs .
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
EXPOSE 3003
VOLUME /app/logs
ENTRYPOINT ["node", "relay.mjs", "--log-dir", "/app/logs"]
# The public lobby's defaults (D59, D64, D66); a container's own arguments replace them
CMD ["--port", "3003", "--status", "local", "--log-days", "14", "--origins", "app://app"]
