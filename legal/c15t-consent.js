/**
 * Consentement cookies — runtime c15t (https://github.com/c15t/c15t) en mode offline,
 * avec repli local si le module distant n'est pas joignable.
 * Catégories : necessary (toujours) · measurement (optionnelle).
 */
const KEY = 'c15t';
const CATEGORIES = ['necessary', 'measurement'];

function readStored() {
  try {
    const raw = localStorage.getItem(KEY) || cookieGet(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cookieGet(name) {
  const parts = (`; ${document.cookie}`).split(`; ${name}=`);
  if (parts.length < 2) return '';
  return decodeURIComponent(parts.pop().split(';').shift() || '');
}

function cookieSet(name, value) {
  const maxAge = 60 * 60 * 24 * 395;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function persist(consents) {
  const payload = JSON.stringify({
    ...consents,
    necessary: true,
    ts: Date.now(),
    v: 1,
  });
  try { localStorage.setItem(KEY, payload); } catch (_) {}
  cookieSet(KEY, payload);
}

function localRuntime() {
  let consents = { necessary: true, measurement: false };
  const stored = readStored();
  let decided = Boolean(stored && stored.ts);
  if (stored) consents = { necessary: true, measurement: Boolean(stored.measurement) };
  const listeners = new Set();
  const emit = () => {
    const state = api.getState();
    listeners.forEach((fn) => fn(state));
  };
  const api = {
    getState() {
      return {
        consents,
        activeUI: decided ? null : 'banner',
        hasConsented: () => decided,
        has: (cat) => Boolean(consents[cat]),
        saveConsents(mode) {
          consents = {
            necessary: true,
            measurement: mode === 'all' || mode === true,
          };
          if (mode === 'necessary') consents.measurement = false;
          decided = true;
          persist(consents);
          emit();
          return Promise.resolve();
        },
        setConsent(cat, on) {
          if (cat === 'necessary') return;
          consents = { ...consents, [cat]: Boolean(on) };
          persist(consents);
          emit();
        },
        showBanner() {
          decided = false;
          emit();
        },
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(api.getState());
      return () => listeners.delete(fn);
    },
  };
  return { consentStore: api, consentManager: api };
}

async function loadC15t() {
  try {
    const mod = await import('https://esm.sh/c15t@1.8.2');
    const factory = mod.getOrCreateConsentRuntime || mod.createConsentRuntime;
    if (typeof factory !== 'function') return localRuntime();
    return factory({
      mode: 'offline',
      consentCategories: CATEGORIES,
    });
  } catch {
    return localRuntime();
  }
}

function bindBanner(store) {
  const root = document.getElementById('c15t-banner');
  if (!root) return;
  const accept = root.querySelector('[data-c15t="all"]');
  const essential = root.querySelector('[data-c15t="necessary"]');
  const paint = (state) => {
    const show = state.activeUI === 'banner' || (typeof state.hasConsented === 'function' && !state.hasConsented());
    root.hidden = !show;
  };
  store.subscribe(paint);
  paint(store.getState());
  accept?.addEventListener('click', () => store.getState().saveConsents('all'));
  essential?.addEventListener('click', () => store.getState().saveConsents('necessary'));
  document.querySelectorAll('[data-c15t="review"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const state = store.getState();
      if (typeof state.showBanner === 'function') state.showBanner();
      else {
        persist({ necessary: true, measurement: false, ts: 0 });
        localStorage.removeItem(KEY);
        cookieSet(KEY, '');
        root.hidden = false;
      }
    });
  });
}

loadC15t().then(({ consentStore }) => {
  window.__c15t = consentStore;
  bindBanner(consentStore);
}).catch(() => {
  const { consentStore } = localRuntime();
  window.__c15t = consentStore;
  bindBanner(consentStore);
});
