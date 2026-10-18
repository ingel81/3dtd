# The proxy and the status page of the own Overpass instance (README.md): one
# image, two commands. Node runs the TypeScript as it is, nothing to install.
#   docker build -t 3dtd-osm-proxy overpass-host
FROM node:24.21-alpine
WORKDIR /app
COPY package.json ./
COPY src/ src/
USER node
ENV NODE_ENV=production
EXPOSE 8080 8090
# node:sqlite still says it is experimental on every start
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
CMD ["src/proxy-main.ts"]
