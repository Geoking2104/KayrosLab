import coreUrl from "./salon_core.wasm?url";
import { floorFallback, retrieveFallback } from "./engine";
import type { FloorResult, Passage } from "./types";

type Exports = {
  memory: WebAssembly.Memory;
  salon_heap: () => number;
  salon_out_off: () => number;
  salon_eval: (len: number) => number;
};

export type EngineOrigin = "rust" | "local";

export interface EngineInfo {
  origin: EngineOrigin;
  bytes: number;
  evalMs: number;
  heap: number;
  outOff: number;
  pages: number;
  reason?: string;
}

const IDLE: EngineInfo = {
  origin: "local",
  bytes: 0,
  evalMs: 0,
  heap: 0,
  outOff: 0,
  pages: 0,
  reason: "pas encore chargé",
};

let core: Exports | null = null;
let loading: Promise<Exports | null> | null = null;
let wasmBytes = 0;
let lastInfo: EngineInfo = { ...IDLE };

function remember(partial: Partial<EngineInfo>): EngineInfo {
  lastInfo = { ...lastInfo, ...partial };
  return lastInfo;
}

export function engineInfo(): EngineInfo {
  return lastInfo;
}

function isCore(exports: WebAssembly.Exports): exports is Exports & WebAssembly.Exports {
  const e = exports as Partial<Exports>;
  return (
    e.memory instanceof WebAssembly.Memory &&
    typeof e.salon_heap === "function" &&
    typeof e.salon_out_off === "function" &&
    typeof e.salon_eval === "function"
  );
}

function evalWith(instance: Exports, input: unknown): FloorResult {
  const json = new TextEncoder().encode(JSON.stringify(input));
  const heapPtr = instance.salon_heap();
  const outOff = instance.salon_out_off();
  if (json.length > outOff) throw new Error("entrée trop longue pour le tas WASM");
  new Uint8Array(instance.memory.buffer).set(json, heapPtr);
  const returned = instance.salon_eval(json.length);
  const heapNow = instance.salon_heap();
  const outPtr = heapNow + instance.salon_out_off();
  const absPtr = returned > outOff ? returned : outPtr;
  const view = new DataView(instance.memory.buffer);
  const len = view.getUint32(absPtr, true);
  if (len < 2 || len > 24 * 1024) throw new Error("réponse WASM vide");
  const bytes = new Uint8Array(instance.memory.buffer, absPtr + 4, len);
  const result = JSON.parse(new TextDecoder().decode(bytes)) as FloorResult;
  return {
    hits: result.hits ?? [],
    speakers: result.speakers ?? [],
    moves: result.moves ?? [],
    note: result.note ?? "",
  };
}

function probe(instance: Exports) {
  const out = evalWith(instance, {
    op: "retrieve",
    query: "justice",
    passages: [{ id: "p1", terms: ["justice"] }],
  });
  if (out.hits?.[0]?.id !== "p1") throw new Error("sonde WASM refusée");
}

async function instantiateFrom(url: string): Promise<Exports> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let instance: WebAssembly.Instance;
  const mime = res.headers.get("content-type") ?? "";
  try {
    if (typeof WebAssembly.instantiateStreaming === "function" && mime.includes("wasm")) {
      ({ instance } = await WebAssembly.instantiateStreaming(res, {}));
    } else {
      const buf = await res.arrayBuffer();
      wasmBytes = buf.byteLength;
      ({ instance } = await WebAssembly.instantiate(buf, {}));
    }
  } catch {
    const retry = await fetch(url);
    const buf = await retry.arrayBuffer();
    wasmBytes = buf.byteLength;
    ({ instance } = await WebAssembly.instantiate(buf, {}));
  }
  if (!wasmBytes) {
    const cl = res.headers.get("content-length");
    wasmBytes = cl ? Number(cl) : 0;
  }
  if (!isCore(instance.exports)) {
    throw new Error("exports manquants (salon_heap, salon_eval, salon_out_off, memory)");
  }
  probe(instance.exports);
  return instance.exports;
}

function wasmUrls() {
  const publicUrl = `${import.meta.env.BASE_URL}salon_core.wasm`.replace(/\/{2,}/g, "/");
  return [...new Set([coreUrl, publicUrl].filter(Boolean))];
}

async function instantiate(): Promise<Exports | null> {
  if (typeof WebAssembly === "undefined") {
    remember({ origin: "local", reason: "WebAssembly indisponible" });
    return null;
  }
  const errors: string[] = [];
  for (const url of wasmUrls()) {
    try {
      const loaded = await instantiateFrom(url);
      wasmBytes = wasmBytes || loaded.memory.buffer.byteLength;
      remember({
        origin: "rust",
        bytes: wasmBytes,
        heap: loaded.salon_heap(),
        outOff: loaded.salon_out_off(),
        pages: loaded.memory.buffer.byteLength / 65536,
        reason: undefined,
      });
      return loaded;
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : "échec"}`);
    }
  }
  remember({ origin: "local", reason: errors[0] ?? "module introuvable" });
  return null;
}

export async function loadSalonCore() {
  if (core) return core;
  if (!loading) {
    loading = instantiate().then((loaded) => {
      core = loaded;
      if (!loaded) loading = null;
      return loaded;
    });
  }
  return loading;
}

async function run(input: unknown, fallback: () => FloorResult): Promise<FloorResult> {
  const started = performance.now();
  await loadSalonCore();
  if (!core) {
    const out = fallback();
    remember({ origin: "local", evalMs: performance.now() - started });
    return out;
  }
  try {
    const result = evalWith(core, input);
    remember({
      origin: "rust",
      evalMs: performance.now() - started,
      heap: core.salon_heap(),
      outOff: core.salon_out_off(),
      pages: core.memory.buffer.byteLength / 65536,
      bytes: wasmBytes,
      reason: undefined,
    });
    return result;
  } catch (err) {
    const out = fallback();
    remember({
      origin: "local",
      evalMs: performance.now() - started,
      reason: err instanceof Error ? err.message : "échec d’évaluation",
    });
    return out;
  }
}

export function retrieveMemory(query: string, passages: Passage[]) {
  return run(
    {
      op: "retrieve",
      query,
      passages: passages.map((p) => ({ id: p.id, terms: p.terms.slice(0, 16) })),
    },
    () => retrieveFallback(query, passages),
  );
}

export function nextSpeakers(input: {
  seated: string[];
  last: string | null;
  recent: string[];
  mode: "ask" | "talk";
  addressed: string | null;
  kinds?: string[];
  query?: string;
}) {
  return run(
    {
      op: "floor",
      seated: input.seated,
      last: input.last,
      recent: input.recent,
      mode: input.mode,
      addressed: input.addressed,
      kinds: input.kinds ?? [],
      query: input.query ?? "",
    },
    () => floorFallback(input),
  );
}

