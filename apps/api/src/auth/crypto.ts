import crypto from 'node:crypto';
import { Algorithm, hash, hashSync, verify } from '@node-rs/argon2';

import {
  AUTH_LIMITS,
  DISPOSABLE_EMAIL_DOMAINS,
  type AltchaChallengeResponse,
} from '@entsiegelung/shared';

import { BoundedSemaphore } from '../util/semaphore.js';

const ARGON2ID_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DEFAULT_AUTH_SEMAPHORE = new BoundedSemaphore(4, 20, 'AUTH_BUSY');

export const TIMING_GUARD_PASSWORD_HASH: string = hashSync(
  crypto.randomBytes(32),
  ARGON2ID_OPTIONS,
);

export const TIMING_GUARD_OPAQUE_TOKEN_HASH: Buffer = crypto
  .createHash('sha256')
  .update(crypto.randomBytes(32))
  .digest();

export async function hashPassword(
  password: string,
  semaphore: BoundedSemaphore = DEFAULT_AUTH_SEMAPHORE,
): Promise<string> {
  return semaphore.run(() => hash(password, ARGON2ID_OPTIONS));
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
  semaphore: BoundedSemaphore = DEFAULT_AUTH_SEMAPHORE,
): Promise<boolean> {
  return semaphore.run(async () => {
    if (!passwordHash.startsWith('$argon2')) {
      return false;
    }
    try {
      return await verify(passwordHash, password, ARGON2ID_OPTIONS);
    } catch (err: unknown) {
      if (err instanceof Error) {
        return false;
      }
      return false;
    }
  });
}

export function generateRecoveryCode(): string {
  const rawHex = crypto
    .randomBytes(AUTH_LIMITS.RECOVERY_CODE_BYTES)
    .toString('hex')
    .toUpperCase();
  const groups: string[] = [];
  for (let offset = 0; offset < rawHex.length; offset += 4) {
    groups.push(rawHex.slice(offset, offset + 4));
  }
  return groups.join('-');
}

export function hashOpaqueToken(normalized: string): Buffer {
  return crypto.createHash('sha256').update(normalized, 'utf8').digest();
}

export function verifyOpaqueToken(
  normalizedCandidate: string,
  storedDigest: Uint8Array,
): boolean {
  const candidateDigest = hashOpaqueToken(normalizedCandidate);
  if (candidateDigest.byteLength !== storedDigest.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(candidateDigest, storedDigest);
}

export function hashPseudonymTombstone(pseudonymLower: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(pseudonymLower.toLowerCase(), 'utf8')
    .digest();
}

export function hashEmailTombstone(emailLower: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(`email:${emailLower.trim().toLowerCase()}`, 'utf8')
    .digest();
}

export function canonicalizeEmail(rawEmail: string): string {
  const lowered = rawEmail.trim().toLowerCase();
  const atIndex = lowered.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === lowered.length - 1) {
    return lowered;
  }

  let localPart = lowered.slice(0, atIndex);
  let domain = lowered.slice(atIndex + 1);

  const plusIndex = localPart.indexOf('+');
  if (plusIndex > 0) {
    localPart = localPart.slice(0, plusIndex);
  }

  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
  }
  if (domain === 'gmail.com') {
    const stripped = localPart.replace(/\./g, '');
    if (stripped.length > 0) {
      localPart = stripped;
    }
  }

  return `${localPart}@${domain}`;
}

export function hashCanonicalEmail(rawEmail: string): Buffer {
  return hashEmailTombstone(canonicalizeEmail(rawEmail));
}

export function isDisposableEmailDomain(
  rawEmail: string,
  extraDomains: readonly string[] = [],
): boolean {
  const lowered = rawEmail.trim().toLowerCase();
  const atIndex = lowered.lastIndexOf('@');
  if (atIndex === -1 || atIndex === lowered.length - 1) {
    return false;
  }
  const domain = lowered.slice(atIndex + 1).replace(/\.+$/, '');
  if (!domain) {
    return false;
  }

  const blocked = new Set<string>([
    ...DISPOSABLE_EMAIL_DOMAINS,
    ...extraDomains.map((d) => d.trim().toLowerCase()).filter(Boolean),
  ]);

  if (blocked.has(domain)) {
    return true;
  }
  for (const candidate of blocked) {
    if (domain.endsWith(`.${candidate}`)) {
      return true;
    }
  }
  return false;
}

export interface VerifyAltchaResult {
  valid: boolean;
  challengeId: string | null;
}

const DEFAULT_ALTCHA_MAX_NUMBER = 15_000;
const DEFAULT_ALTCHA_TTL_MS = 10 * 60 * 1000;

export function createAltchaChallenge(
  hmacSecret: Buffer | string,
  options: {
    maxNumber?: number | undefined;
    ttlMs?: number | undefined;
    nowMs?: number | undefined;
  } = {},
): AltchaChallengeResponse {
  const maxnumber = Math.max(100, options.maxNumber ?? DEFAULT_ALTCHA_MAX_NUMBER);
  const ttlMs = Math.max(5_000, options.ttlMs ?? DEFAULT_ALTCHA_TTL_MS);
  const nowMs = options.nowMs ?? Date.now();
  const expiresAtMs = nowMs + ttlMs;
  const nonce = crypto.randomBytes(12).toString('hex');
  const salt = `${expiresAtMs}.${maxnumber}.${nonce}`;
  const secretNumber = crypto.randomInt(0, maxnumber + 1);
  const challenge = crypto
    .createHash('sha256')
    .update(`${salt}${secretNumber}`, 'utf8')
    .digest('hex');
  const signature = crypto
    .createHmac('sha256', hmacSecret)
    .update(`${challenge}:${salt}`, 'utf8')
    .digest('hex');

  return {
    algorithm: 'SHA-256',
    challenge,
    maxnumber,
    salt,
    signature,
  };
}

export function solveAltchaChallenge(
  challengeObj: AltchaChallengeResponse,
): string {
  for (let n = 0; n <= challengeObj.maxnumber; n++) {
    const digest = crypto
      .createHash('sha256')
      .update(`${challengeObj.salt}${n}`, 'utf8')
      .digest('hex');
    if (digest === challengeObj.challenge) {
      return Buffer.from(
        JSON.stringify({
          algorithm: challengeObj.algorithm,
          challenge: challengeObj.challenge,
          number: n,
          salt: challengeObj.salt,
          signature: challengeObj.signature,
        }),
        'utf8',
      ).toString('base64');
    }
  }
  throw new Error('Failed to solve ALTCHA challenge within maxnumber.');
}

export function verifyAltchaPayload(
  rawPayload: string,
  hmacSecret: Buffer | string,
  nowMs: number = Date.now(),
): VerifyAltchaResult {
  try {
    const trimmed = rawPayload.trim();
    if (!trimmed || trimmed.length > 4096) {
      return { valid: false, challengeId: null };
    }
    const jsonText = trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as {
      algorithm?: unknown;
      challenge?: unknown;
      number?: unknown;
      salt?: unknown;
      signature?: unknown;
    };

    if (
      parsed.algorithm !== 'SHA-256' ||
      typeof parsed.challenge !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(parsed.challenge) ||
      typeof parsed.number !== 'number' ||
      !Number.isInteger(parsed.number) ||
      parsed.number < 0 ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.signature !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(parsed.signature)
    ) {
      return { valid: false, challengeId: null };
    }

    const saltParts = parsed.salt.split('.');
    if (saltParts.length !== 3) {
      return { valid: false, challengeId: null };
    }
    const expiresAtMs = Number(saltParts[0]);
    const maxNumber = Number(saltParts[1]);
    if (
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= nowMs ||
      !Number.isInteger(maxNumber) ||
      maxNumber < 1 ||
      parsed.number > maxNumber
    ) {
      return { valid: false, challengeId: null };
    }

    const expectedSig = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${parsed.challenge.toLowerCase()}:${parsed.salt}`, 'utf8')
      .digest();
    const providedSig = Buffer.from(parsed.signature, 'hex');
    if (
      expectedSig.byteLength !== providedSig.byteLength ||
      !crypto.timingSafeEqual(expectedSig, providedSig)
    ) {
      return { valid: false, challengeId: null };
    }

    const computedChallenge = crypto
      .createHash('sha256')
      .update(`${parsed.salt}${parsed.number}`, 'utf8')
      .digest();
    const expectedChallenge = Buffer.from(parsed.challenge, 'hex');
    if (
      computedChallenge.byteLength !== expectedChallenge.byteLength ||
      !crypto.timingSafeEqual(computedChallenge, expectedChallenge)
    ) {
      return { valid: false, challengeId: null };
    }

    return {
      valid: true,
      challengeId: `${parsed.salt}:${parsed.challenge.toLowerCase()}`,
    };
  } catch {
    return { valid: false, challengeId: null };
  }
}

export function generateEmailActionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
