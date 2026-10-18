# Overpass as the host runs it (README.md): the wiktorn image, pinned, with
# start-overpass.sh in front of its entrypoint, so that a server needs no file
# of the repository beside docker-compose.yml.
#   docker build -t 3dtd-osm-overpass overpass-host/overpass
FROM wiktorn/overpass-api:v0.7.62.9
COPY start-overpass.sh /app/start-overpass.sh
RUN chmod 755 /app/start-overpass.sh
ENTRYPOINT ["/bin/bash", "/app/start-overpass.sh"]
CMD []
