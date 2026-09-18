# syntax=docker/dockerfile:1.7

# ---- Stage 1: tippecanoe aus Source ----
FROM debian:bookworm-slim AS tippecanoe-builder
ARG TIPPECANOE_REF=2.79.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates build-essential libsqlite3-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${TIPPECANOE_REF} \
      https://github.com/felt/tippecanoe.git /src/tippecanoe
WORKDIR /src/tippecanoe
RUN make -j"$(nproc)" && make install PREFIX=/opt/tippecanoe

# ---- Stage 2: Python-Runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update && apt-get install -y --no-install-recommends \
      libsqlite3-0 libexpat1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tippecanoe-builder /opt/tippecanoe/bin/tippecanoe /usr/local/bin/tippecanoe
COPY --from=tippecanoe-builder /opt/tippecanoe/bin/tile-join  /usr/local/bin/tile-join

COPY --from=ghcr.io/astral-sh/uv:0.12.6 /uv /usr/local/bin/uv

# Abhängigkeiten exakt aus uv.lock; --locked bricht ab, wenn pyproject.toml und
# uv.lock auseinanderlaufen (dann lokal `uv lock` ausführen und committen).
WORKDIR /app
COPY pyproject.toml uv.lock /app/
RUN uv sync --locked --no-dev --no-install-project
ENV PATH="/opt/venv/bin:$PATH"

COPY preprocessing /app/preprocessing

ENV PYTHONPATH=/app/preprocessing
WORKDIR /app/preprocessing

ENTRYPOINT ["python", "run_pipeline.py"]
CMD []
