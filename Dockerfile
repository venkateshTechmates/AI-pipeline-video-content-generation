# API + graph worker image (same image, different command).
FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-inter fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
    espeak-ng ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY clipforge ./clipforge
COPY supabase ./supabase
RUN pip install --no-cache-dir ".[otel]"

ENV PYTHONUNBUFFERED=1 ASSET_ROOT=/data/assets
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1
CMD ["clipforge", "api", "--port", "8000"]
