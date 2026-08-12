// KayrosLab -- append-only JSONL audit sink.
//
// Graph Engineering spec section 2 gives the Logger node ownership of the
// audit trail, and section 6 requires structured logs for audit. Until now
// logs lived only in WorkflowState, capped at 500 entries and discarded when
// the run ended: an audit trail that disappears is not an audit trail.
//
// One file per run, one JSON object per line, append-only. A record is never
// rewritten and never re-read, so a crashed run still leaves everything it
// had time to emit.

const DEFAULT_DIR = 'logs';

/** Filenames come from a runId, which is caller data: keep it to a safe set. */
function safeSegment(value, fallback = 'run') {
  const raw = String(value ?? '').trim();
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned.slice(0, 128) : fallback;
}

function serialize(entry) {
  // A record that cannot be serialized must not take the whole run down, but
  // it must not vanish either: it degrades to an explicit marker.
  try {
    return `${JSON.stringify(entry)}\n`;
  } catch (error) {
    return `${JSON.stringify({
      type: 'log_sink_error',
      message: String(error?.message || error),
      ts: new Date().toISOString(),
    })}\n`;
  }
}

/**
 * In-memory sink. Used by tests, and usable in production to buffer a run
 * whose trail is shipped elsewhere.
 */
export function createMemorySink() {
  const lines = [];
  return {
    kind: 'memory',
    lines,
    async append(entry) { lines.push(serialize(entry).trimEnd()); return true; },
    async flush() { return true; },
  };
}

/**
 * JSONL sink writing to `<dir>/<runId>.jsonl`.
 *
 * @param {object} [opts]
 * @param {string} [opts.dir]  target directory, created on first write
 * @param {object} [opts.fs]   fs/promises-like object, injected in tests
 */
export function createJsonlSink({ dir = DEFAULT_DIR, fs = null } = {}) {
  let fsPromise = fs ? Promise.resolve(fs) : null;
  const ensured = new Set();

  const getFs = () => {
    if (!fsPromise) fsPromise = import('node:fs/promises');
    return fsPromise;
  };

  // Joined by hand: the sink must stay usable in a browser-ish bundle where
  // node:path is not available, and both separators work on Windows.
  const pathFor = (runId) => `${dir}/${safeSegment(runId)}.jsonl`;

  return {
    kind: 'jsonl',
    dir,
    pathFor,
    async append(entry) {
      const target = pathFor(entry?.runId);
      const nodeFs = await getFs();
      if (!ensured.has(dir)) {
        await nodeFs.mkdir(dir, { recursive: true });
        ensured.add(dir);
      }
      await nodeFs.appendFile(target, serialize(entry), 'utf8');
      return true;
    },
    async flush() { return true; },
  };
}

/**
 * Normalizes whatever the caller passed as a sink. A bare function is
 * accepted as an append handler so a caller can pipe records anywhere.
 */
export function resolveLogSink(sink) {
  if (!sink) return null;
  if (typeof sink === 'function') return { kind: 'fn', append: sink, flush: async () => true };
  if (typeof sink.append === 'function') return sink;
  return null;
}
