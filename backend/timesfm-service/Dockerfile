FROM python:3.11.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/huggingface \
    TIMESFM_MODEL_ID=google/timesfm-2.5-200m-pytorch \
    TIMESFM_MAX_CONTEXT=1024 \
    TIMESFM_MAX_HORIZON=256 \
    TIMESFM_MAX_BATCH=32 \
    PORT=8001

RUN groupadd --gid 10001 timesfm \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin timesfm \
    && mkdir -p /app /models/huggingface \
    && chown -R timesfm:timesfm /app /models

WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --requirement requirements.txt
COPY --chown=timesfm:timesfm timesfm_service.py ./

USER 10001:10001
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m --retries=3 \
  CMD python -c "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)); raise SystemExit(0 if data.get('model_loaded') else 1)"

CMD ["python", "-m", "uvicorn", "timesfm_service:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--no-server-header"]
