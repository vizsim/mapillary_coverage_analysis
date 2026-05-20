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
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      libsqlite3-0 libexpat1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tippecanoe-builder /opt/tippecanoe/bin/tippecanoe /usr/local/bin/tippecanoe
COPY --from=tippecanoe-builder /opt/tippecanoe/bin/tile-join  /usr/local/bin/tile-join

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY preprocessing /app/preprocessing

ENV PYTHONPATH=/app/preprocessing
WORKDIR /app/preprocessing

ENTRYPOINT ["python", "run_pipeline.py"]
CMD ["--data-dir", "/app/data", "--output-dir", "/app/data"]
