# The proxy and the status page of the own Overpass instance (README.md): one
# image, two commands. Node runs the TypeScript as it is, nothing to install.
#   docker build -t 3dtd-osm-proxy overpass-host
FROM node:24.21-alpine
WORKDIR /app
COPY package.json ./
COPY src/ src/
# Which build this is, in the log and on the status page ("next (a1b2c3d4)")
ARG HOST_BUILD=dev
ENV HOST_BUILD=${HOST_BUILD} NODE_ENV=production
USER node
EXPOSE 8080 8090
# node:sqlite still says it is experimental on every start
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
CMD ["src/proxy-main.ts"]
