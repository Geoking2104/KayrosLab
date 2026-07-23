const STORE_KEY = 'kayros_tour';

export function isTourCompleted() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return true;
  }
}

export function completeTour() {
  try {
    localStorage.setItem(STORE_KEY, '1');
  } catch {}
}
