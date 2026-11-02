# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

# A proxy CA may be mounted during a managed-cloud build. It is never copied
# into the image. Package signatures and TLS verification remain enabled.
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    set --; \
    if [ -r /run/secrets/proxy_ca ]; then \
      set -- -o Acquire::https::CaInfo=/run/secrets/proxy_ca; \
    fi; \
    apt-get "$@" update; \
    apt-get "$@" install -y --no-install-recommends ca-certificates ffmpeg; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 10001 luma; \
    useradd --uid 10001 --gid luma --no-create-home --shell /usr/sbin/nologin luma

WORKDIR /app
COPY --chown=luma:luma server.py video_provider.py reference_planner.py mp4_export.py ./
COPY --chown=luma:luma index.html style.css studio.js reference.js auto.js auto.css ./
COPY --chown=luma:luma assets/ ./assets/

USER luma
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python3 -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','10000')+'/healthz',timeout=3).close()"
CMD ["sh", "-c", "exec python3 -B server.py --host 0.0.0.0 --port \"${PORT:-10000}\" --public"]
