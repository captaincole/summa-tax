// Passcode lives in sessionStorage so refresh keeps you signed in within a tab
// but a new tab/window starts fresh. Closing the browser drops it. For a demo
// behind a shared passcode, that's the right window.

const KEY = "wot.passcode";

export function getPasscode(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setPasscode(passcode: string): void {
  sessionStorage.setItem(KEY, passcode);
}

export function clearPasscode(): void {
  sessionStorage.removeItem(KEY);
}

export function authHeaders(): HeadersInit {
  const passcode = getPasscode();
  return passcode ? { Authorization: `Bearer ${passcode}` } : {};
}
