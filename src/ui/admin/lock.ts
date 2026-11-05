// The admin page's password lock.
//
// The site is static (GitHub Pages), so there is no server to check a password. At build time the
// password (NB_ADMIN_PASSWORD) is stretched with PBKDF2 and only the salt and result are built in;
// the page stretches what you type the same way and compares. It keeps the editor hidden and closed
// to visitors, but it is not a vault: the check runs in the browser. What makes it safe is that the
// editor only changes the look in your own browser. Nobody else sees a change until the design file
// is committed to the repository, which needs your GitHub account.

export interface AdminLock {
  salt: string;
  hash: string;
  iterations: number;
}

declare const __NB_ADMIN_LOCK__: AdminLock | null;

/** null when no password was set for this build. */
export const ADMIN_LOCK: AdminLock | null = typeof __NB_ADMIN_LOCK__ !== 'undefined' ? __NB_ADMIN_LOCK__ : null;

const SESSION_KEY = 'narrative-bridge.admin';
const FAILS_KEY = 'narrative-bridge.admin-fails';
export const MAX_TRIES = 5;
export const WAIT_SECONDS = 30;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PBKDF2-SHA-256, 32 bytes, as base64 (the same as the build's node:crypto pbkdf2). */
export async function stretch(password: string, salt: string, iterations: number): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('This browser can’t check the password here. Open the admin page on the website (https).');
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt) as BufferSource, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(password: string, lock: AdminLock | null = ADMIN_LOCK): Promise<boolean> {
  if (!lock || !password) return false;
  return sameText(await stretch(password, lock.salt, lock.iterations), lock.hash);
}

function session(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Unlocked for this tab until it closes or you lock it. */
export function isUnlocked(lock: AdminLock | null = ADMIN_LOCK): boolean {
  if (!lock) return devWithoutPassword() && session()?.getItem(SESSION_KEY) === 'dev';
  return session()?.getItem(SESSION_KEY) === lock.hash;
}

export function rememberUnlock(lock: AdminLock | null = ADMIN_LOCK) {
  session()?.setItem(SESSION_KEY, lock ? lock.hash : 'dev');
  session()?.removeItem(FAILS_KEY);
}

export function lockAdmin() {
  session()?.removeItem(SESSION_KEY);
}

/** `npm run dev` with no password set: the editor opens without one, on your own machine only. */
export function devWithoutPassword(): boolean {
  return !ADMIN_LOCK && import.meta.env.DEV;
}

/** After MAX_TRIES wrong passwords, a wait before the next try. Returns the seconds left, or 0. */
export function waitLeft(now = Date.now()): number {
  const raw = session()?.getItem(FAILS_KEY);
  if (!raw) return 0;
  const { count, at } = JSON.parse(raw) as { count: number; at: number };
  if (count < MAX_TRIES) return 0;
  return Math.max(0, Math.ceil((at + WAIT_SECONDS * 1000 - now) / 1000));
}

export function recordFailure(now = Date.now()) {
  const raw = session()?.getItem(FAILS_KEY);
  const prev = raw ? (JSON.parse(raw) as { count: number; at: number }) : { count: 0, at: now };
  // After a wait, the count starts again.
  const count = prev.count >= MAX_TRIES ? 1 : prev.count + 1;
  session()?.setItem(FAILS_KEY, JSON.stringify({ count, at: now }));
}
