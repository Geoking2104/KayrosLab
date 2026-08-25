"""Isolated TimesFM 2.5 inference service for KayrosLab.

The Node backend is the only intended caller. The service never makes a
governance decision: every response is explicitly marked as a simulation.
"""

from __future__ import annotations

import logging
import math
import os
import secrets
import threading
from contextlib import asynccontextmanager
from typing import Annotated

import numpy as np
import timesfm
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL_ID = os.getenv("TIMESFM_MODEL_ID", "google/timesfm-2.5-200m-pytorch")
MAX_CONTEXT = min(16_384, max(32, int(os.getenv("TIMESFM_MAX_CONTEXT", "1024"))))
MAX_HORIZON = min(1_000, max(1, int(os.getenv("TIMESFM_MAX_HORIZON", "256"))))
MAX_BATCH = min(128, max(1, int(os.getenv("TIMESFM_MAX_BATCH", "32"))))
API_TOKEN = os.getenv("TIMESFM_API_TOKEN", "")
QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

if MAX_CONTEXT + MAX_HORIZON > 16_384:
    raise RuntimeError("TIMESFM_MAX_CONTEXT + TIMESFM_MAX_HORIZON must not exceed 16384")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("kayros.timesfm")


class ModelState:
    model = None
    error: str | None = None
    lock = threading.Lock()


state = ModelState()


def load_model():
    torch.set_float32_matmul_precision("high")
    torch.set_num_threads(max(1, int(os.getenv("TIMESFM_TORCH_THREADS", "2"))))
    logger.info("Loading TimesFM model %s", MODEL_ID)
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(MODEL_ID)
    model.compile(
        timesfm.ForecastConfig(
            max_context=MAX_CONTEXT,
            max_horizon=MAX_HORIZON,
            normalize_inputs=True,
            use_continuous_quantile_head=True,
            force_flip_invariance=True,
            infer_is_positive=True,
            fix_quantile_crossing=True,
        )
    )
    logger.info("TimesFM model loaded and compiled")
    return model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        state.model = load_model()
        state.error = None
    except Exception as exc:  # keep diagnostics in logs, not in HTTP responses
        state.error = type(exc).__name__
        logger.exception("TimesFM model initialisation failed")
        raise
    yield
    state.model = None


app = FastAPI(
    title="KayrosLab TimesFM Forecast Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inputs: list[list[float]] = Field(min_length=1, max_length=MAX_BATCH)
    horizon: int = Field(default=12, ge=1, le=MAX_HORIZON)

    @field_validator("inputs")
    @classmethod
    def validate_inputs(cls, value: list[list[float]]):
        total = 0
        for series in value:
            if len(series) < 3 or len(series) > MAX_CONTEXT:
                raise ValueError(f"each series must contain 3..{MAX_CONTEXT} values")
            if not all(math.isfinite(item) for item in series):
                raise ValueError("series values must be finite")
            total += len(series)
        if total > MAX_BATCH * MAX_CONTEXT:
            raise ValueError("request is too large")
        return value


def require_token(authorization: Annotated[str | None, Header()] = None):
    if not API_TOKEN:
        return
    expected = f"Bearer {API_TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {
        "status": "ok" if state.model is not None else "starting",
        "model": MODEL_ID,
        "model_loaded": state.model is not None,
        "max_context": MAX_CONTEXT,
        "max_horizon": MAX_HORIZON,
        "max_batch": MAX_BATCH,
    }


@app.post("/forecast", dependencies=[Depends(require_token)])
def forecast(request: ForecastRequest):
    if state.model is None:
        raise HTTPException(status_code=503, detail="model unavailable")

    inputs = [np.asarray(series[-MAX_CONTEXT:], dtype=np.float32) for series in request.inputs]
    try:
        # The PyTorch decoder is shared and intentionally serialised. Batching
        # still gives portfolio throughput without unsafe concurrent mutation.
        with state.lock:
            point, raw_quantiles = state.model.forecast(horizon=request.horizon, inputs=inputs)
    except Exception:
        logger.exception("TimesFM forecast failed")
        raise HTTPException(status_code=503, detail="forecast unavailable") from None

    # TimesFM 2.5 returns [mean, P10, ..., P90]. The mean is already returned
    # separately as point_forecast, so expose only the nine labelled quantiles.
    quantile_forecast = raw_quantiles[:, :, 1:]
    return {
        "point_forecast": point.tolist(),
        "quantile_forecast": quantile_forecast.tolist(),
        "quantiles": QUANTILES,
        "model_id": MODEL_ID,
        "simulated": True,
        "provenance": (
            f"{MODEL_ID} | timesfm=2.0.2 | context={MAX_CONTEXT} "
            f"| horizon={request.horizon}"
        ),
    }
