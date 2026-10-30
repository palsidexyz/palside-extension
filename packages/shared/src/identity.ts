import { schnorr } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { bech32, base64 } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export const ENGLISH_WORDS: readonly string[] = wordlist;
export const VAULT_ITERATIONS = 600_000;
/** The device password is a six-digit PIN; it only seals the local copy of the phrase. */
export const PIN_LENGTH = 6;
export const isValidPin = (pin: string) => pin.length === PIN_LENGTH && /^[0-9]+$/.test(pin);
export const HTTP_AUTH_KIND = 27235;

const textEncoder = new TextEncoder();

export function generateMnemonic(): string {
  return bip39Generate(wordlist, 128);
}

export function normalizeMnemonic(input: string | readonly string[]): string {
  const source = typeof input === 'string' ? input : input.join(' ');
  return source.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isValidMnemonic(mnemonic: string): boolean {
  const normalized = normalizeMnemonic(mnemonic);
  return normalized.split(' ').length === 12 && validateMnemonic(normalized, wordlist);
}

export type Identity = {
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
  secretStorageKey: Uint8Array;
};

export function deriveIdentity(mnemonic: string): Identity {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) throw new Error('INVALID_MNEMONIC');
  const seed = mnemonicToSeedSync(normalized);
  const child = HDKey.fromMasterSeed(seed).derive("m/44'/1237'/0'/0/0");
  const secretKey = child.privateKey;
  if (!secretKey) throw new Error('INVALID_MNEMONIC');
  const publicKeyBytes = schnorr.getPublicKey(secretKey);
  const publicKey = bytesToHex(publicKeyBytes);
  const secretStorageKey = hkdf(sha256, seed, new Uint8Array(0), textEncoder.encode('palside/matrix-secret-storage/v1'), 32);
  return { secretKey: new Uint8Array(secretKey), publicKey, npub: npubEncode(publicKey), secretStorageKey };
}

export function npubEncode(publicKeyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) throw new Error('INVALID_PUBLIC_KEY');
  return bech32.encodeFromBytes('npub', hexToBytes(publicKeyHex));
}

export function npubDecode(npub: string): string {
  const decoded = bech32.decodeToBytes(npub);
  if (decoded.prefix !== 'npub' || decoded.bytes.length !== 32) throw new Error('INVALID_NPUB');
  return bytesToHex(decoded.bytes);
}

export function shortNpub(npub: string): string {
  npubDecode(npub);
  const data = npub.slice(npub.indexOf('1') + 1);
  return `npub1${data.slice(0, 4)}…${data.slice(-4)}`;
}

type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

function eventHash(pubkey: string, created_at: number, kind: number, tags: string[][], content: string): Uint8Array {
  return sha256(textEncoder.encode(JSON.stringify([0, pubkey, created_at, kind, tags, content])));
}

export function signEvent(event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>, secretKey: Uint8Array): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
  const idBytes = eventHash(pubkey, event.created_at, event.kind, event.tags, event.content);
  return { ...event, id: bytesToHex(idBytes), pubkey, sig: bytesToHex(schnorr.sign(idBytes, secretKey)) };
}

export function verifyEvent(event: NostrEvent): boolean {
  try {
    if (!event || typeof event !== 'object' || !/^[0-9a-f]{64}$/.test(event.id) || !/^[0-9a-f]{64}$/.test(event.pubkey) || !/^[0-9a-f]{128}$/.test(event.sig)) return false;
    if (!Number.isInteger(event.created_at) || !Number.isInteger(event.kind) || event.kind < 0 || event.kind > 65535 || typeof event.content !== 'string' || !Array.isArray(event.tags) || event.tags.some(tag => !Array.isArray(tag) || tag.some(value => typeof value !== 'string'))) return false;
    const idBytes = eventHash(event.pubkey, event.created_at, event.kind, event.tags, event.content);
    return bytesToHex(idBytes) === event.id && schnorr.verify(hexToBytes(event.sig), idBytes, hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}

export function leadingZeroBits(idHex: string): number {
  if (!/^[0-9a-f]{64}$/.test(idHex)) throw new Error('INVALID_ID');
  let count = 0;
  for (const character of idHex) {
    const nibble = Number.parseInt(character, 16);
    if (nibble === 0) count += 4;
    else { count += Math.clz32(nibble) - 28; break; }
  }
  return count;
}

type HttpAuthInput = { url: string; method: string; body?: Uint8Array; secretKey: Uint8Array; now?: number; difficulty?: number; signal?: AbortSignal };

function currentSeconds(): number { return Math.floor(Date.now() / 1000); }

export async function createHttpAuth(input: HttpAuthInput): Promise<NostrEvent> {
  const method = input.method.toUpperCase();
  const body = input.body && input.body.length > 0 ? input.body : undefined;
  const difficulty = input.difficulty === undefined ? 0 : input.difficulty;
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 32) throw new Error('INVALID_DIFFICULTY');
  input.signal?.throwIfAborted();
  const initialClock = currentSeconds();
  const offset = (input.now ?? initialClock) - initialClock;
  const now = () => Math.floor(Date.now() / 1000 + offset);
  const tags: string[][] = [['u', input.url], ['method', method], ['request', bytesToHex(randomBytes(16))]];
  if (body) tags.push(['payload', bytesToHex(sha256(body))]);
  if (difficulty > 0) tags.push(['nonce', '0', String(difficulty)]);
  let createdAt = input.now ?? initialClock;
  // The event id does not depend on the signature: mine on the hash, sign once.
  if (difficulty > 0) {
    const pubkey = bytesToHex(schnorr.getPublicKey(input.secretKey));
    for (let counter = 0; leadingZeroBits(bytesToHex(eventHash(pubkey, createdAt, HTTP_AUTH_KIND, tags, ''))) < difficulty;) {
      counter++;
      tags[tags.length - 1]![1] = String(counter);
      if ((counter & 0xffff) === 0) createdAt = now();
      if ((counter & 0x3ff) === 0) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        input.signal?.throwIfAborted();
      }
    }
  }
  input.signal?.throwIfAborted();
  return signEvent({ created_at: createdAt, kind: HTTP_AUTH_KIND, tags, content: '' }, input.secretKey);
}

export function authorizationHeader(event: NostrEvent): string {
  return `Nostr ${base64.encode(textEncoder.encode(JSON.stringify(event)))}`;
}

type HttpAuthCheck = { header: string | undefined; url: string; method: string; body?: Uint8Array; now: number; difficulty?: number; windowSeconds?: number };
type HttpAuthResult = { ok: true; event: NostrEvent } | { ok: false; code: 'AUTH_REQUIRED' | 'AUTH_INVALID' | 'AUTH_EXPIRED' | 'POW_REQUIRED' };

function invalid(): HttpAuthResult { return { ok: false, code: 'AUTH_INVALID' }; }

export function verifyHttpAuth(check: HttpAuthCheck): HttpAuthResult {
  if (!check.header || !check.header.startsWith('Nostr ')) return { ok: false, code: 'AUTH_REQUIRED' };
  const encoded = check.header.slice(6);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return invalid();
  let event: NostrEvent;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(base64.decode(encoded));
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return invalid();
    event = parsed as NostrEvent;
    if (typeof event.id !== 'string' || typeof event.pubkey !== 'string' || typeof event.sig !== 'string' || typeof event.content !== 'string' || !Number.isInteger(event.created_at) || !Number.isInteger(event.kind) || !Array.isArray(event.tags) || event.tags.some(tag => !Array.isArray(tag) || tag.some(value => typeof value !== 'string'))) return invalid();
  } catch { return invalid(); }
  if (event.kind !== HTTP_AUTH_KIND) return invalid();
  const tag = (name: string) => event.tags.find(item => item[0] === name)?.[1];
  if (tag('u') !== check.url) return invalid();
  if (tag('method') !== check.method.toUpperCase()) return invalid();
  const payloads = event.tags.filter(item => item[0] === 'payload');
  if (payloads.length > 1) return invalid();
  if (payloads.length || check.body?.length) {
    if (payloads[0]?.[1] !== bytesToHex(sha256(check.body ?? new Uint8Array(0)))) return invalid();
  }
  const window = check.windowSeconds ?? 60;
  if (Math.abs(event.created_at - check.now) > window) return { ok: false, code: 'AUTH_EXPIRED' };
  if (!verifyEvent(event)) return invalid();
  if (check.difficulty !== undefined && check.difficulty > 0) {
    const nonce = event.tags.find(item => item[0] === 'nonce');
    const committed = nonce && nonce.length >= 3 ? Number(nonce[2]) : NaN;
    if (!Number.isInteger(committed) || committed < check.difficulty || leadingZeroBits(event.id) < check.difficulty) return { ok: false, code: 'POW_REQUIRED' };
  }
  return { ok: true, event };
}

/** Vaults seal the recovery phrase with a six-digit PIN. */
export const VAULT_VERSION = 2;
export type Vault = { v: 2; iterations: number; salt: string; iv: string; ciphertext: string };

export function isValidVault(value: unknown): value is Vault {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const vault = value as Partial<Vault>;
  if (vault.v !== VAULT_VERSION || vault.iterations !== VAULT_ITERATIONS) return false;
  const encodedBytes = (value: unknown, minimum: number, maximum: number): boolean => {
    if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4) return false;
    try {
      const bytes = base64.decode(value);
      return bytes.length >= minimum && bytes.length <= maximum && base64.encode(bytes) === value;
    } catch { return false; }
  };
  // BIP-39 phrases and their GCM authentication tag fit within 256 bytes.
  return encodedBytes(vault.salt, 16, 16) && encodedBytes(vault.iv, 12, 12) && encodedBytes(vault.ciphertext, 16, 256);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealMnemonic(mnemonic: string, pin: string): Promise<Vault> {
  if (!isValidPin(pin)) throw new Error('PIN_INVALID');
  const salt = randomBytes(16); const iv = randomBytes(12);
  const key = await passwordKey(pin, salt, VAULT_ITERATIONS);
  const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, textEncoder.encode(mnemonic)));
  return { v: VAULT_VERSION, iterations: VAULT_ITERATIONS, salt: base64.encode(salt), iv: base64.encode(iv), ciphertext: base64.encode(ciphertext) };
}

export async function openMnemonic(vault: Vault, pin: string): Promise<string> {
  if (!isValidVault(vault)) throw new Error('INVALID_VAULT');
  try {
    const salt = base64.decode(vault.salt); const iv = base64.decode(vault.iv); const ciphertext = base64.decode(vault.ciphertext);
    const key = await passwordKey(pin, salt, vault.iterations);
    const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, ciphertext as unknown as BufferSource);
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch { throw new Error('WRONG_PASSWORD'); }
}
