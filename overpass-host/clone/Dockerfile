# The download of an Overpass clone (clone.sh): aria2 for parallel, resumable downloads
FROM alpine:3.23
RUN apk add --no-cache bash aria2 curl coreutils ca-certificates
COPY clone.sh /clone.sh
ENTRYPOINT ["bash", "/clone.sh"]
