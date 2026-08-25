# TimesFM 2.5 forecasting

## Decision and scope

TimesFM is relevant to KayrosLab when an idea already has a sufficiently long,
ordered KPI history. It complements the deterministic `simulate_trajectory`
tool; it does not replace it.

The deterministic projection answers “what follows from the declared scenarios
and assumptions?” TimesFM answers “what trajectory is statistically plausible
given the observed series?” Keeping both prevents a model forecast from being
presented as a reproducible business case.

The initial production integration deliberately excludes XReg covariates. In
TimesFM 2.5 they use `forecast_with_covariates`, a different input contract that
also requires `return_backcast=True` and the `timesfm[xreg]` dependencies. The
single `xreg` array proposed in the implementation note does not match that API.

## Architecture

```text
Observed KPI readings
  -> Fastify tenant/auth boundary
  -> ToolRegistry: projection.forecast
  -> bounded Node adapter/cache
  -> loopback-only Python service
  -> TimesFM 2.5 warm model
  -> P10..P90 + point forecast
  -> uncertainty assessment
  -> Postgres latest snapshot + governed API response
```

`core/` remains dependency-free. Its adapter file only contains the portable
contract, validation and uncertainty calculation. PyTorch, NumPy and TimesFM
are isolated in `backend/timesfm-service/`.

## Safety properties

- Forecasts are always labelled `SIMULATION` and never stored as observed KPI
  readings.
- At least 20 observations are required by the product route.
- Batch, context, horizon, cache size, response shape and request time are
  bounded.
- NaN and infinite values are rejected on both sides of the process boundary.
- P10/P50/P90 are read from the documented nine-quantile response. TimesFM's
  leading mean channel is removed by the Python service to avoid an off-by-one
  interpretation.
- A mean `(P90 - P10) / abs(P50)` ratio above `0.8` requires human review.
- Tables, queries and API lookups are tenant-scoped.
- The model endpoint comes only from server configuration; clients cannot use
  it as an SSRF proxy.
- The container runs as UID 10001, drops Linux capabilities, uses a read-only
  root filesystem and binds only to `127.0.0.1:8001`.

TimesFM is a pretrained foundation model, not a causal model. It can extrapolate
historical patterns but cannot prove that a strategic option will produce an
outcome. Regime changes, sparse histories, data quality failures and KPI
definition changes remain human review concerns.

## API

All product routes require the existing KayrosLab Bearer authentication.

```http
GET /v1/forecast/status
POST /v1/ideas/:id/forecast
GET /v1/ideas/:id/forecasts
```

Example request:

```json
{
  "kpi": "adoption",
  "horizon": 12
}
```

The source series is loaded from `idea.impact.releves` or the tenant-scoped
`kayros_kpi_history` table. The execution monitor writes new readings to both
the existing idea impact record and the normalized history table.

## Local service

```bash
docker compose \
  --env-file backend/fastify/.env \
  -f deploy/timesfm.compose.yaml \
  up --build --wait timesfm
```

Then enable the Node adapter:

```dotenv
KAYROS_TIMESFM_ENABLED=true
KAYROS_TIMESFM_ENDPOINT=http://127.0.0.1:8001
KAYROS_TIMESFM_TOKEN=<shared-random-token>
```

Model weights are downloaded from Hugging Face on the first start and retained
in the `kayroslab-timesfm-model-cache-v1` volume. The first readiness check can
therefore take several minutes.

## OVH deployment

The normal backend deployment stays safe when TimesFM is disabled. To opt in:

1. Install Docker Engine with the Compose v2 plugin on the VPS.
2. Ensure at least 3 GiB is available during startup and size the host for the
   Python/PyTorch model alongside the existing Node and Postgres processes.
3. Set the repository variable `KAYROS_TIMESFM_ENABLED=true`.
4. Set a repository secret `KAYROS_TIMESFM_TOKEN`.
5. Dispatch the `Deploy KayrosLab backend - OVH VPS` workflow.

The deployment fails rather than silently enabling a broken model service when
Docker, memory or health checks are insufficient. The deterministic projection
path remains available whenever TimesFM is disabled.

## Verification

```bash
node --test core/adapters/timesfm-forecast.test.mjs
node --test backend/fastify/tests/timesfm-adapter.test.mjs
node --test backend/fastify/tests/forecasts.test.mjs
python -m py_compile backend/timesfm-service/timesfm_service.py
```

Full model inference is intentionally not part of every CI run because it
downloads large model weights. It must be exercised by the container readiness
check during an enabled deployment and by a scheduled infrastructure smoke test
if TimesFM becomes a production-critical dependency.

## Upstream basis

- Model: `google/timesfm-2.5-200m-pytorch`
- Python package: `timesfm[torch]==2.0.2`
- Context limit: 16,384
- Continuous quantile horizon limit: 1,000
- Open-source implementation: Apache-2.0; not an officially supported Google
  product

Review upstream release notes and model licensing before changing model IDs or
making the service externally accessible.
