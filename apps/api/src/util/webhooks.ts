// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

import type { PolygonFeature, WebhookEventType } from '@openunseal/shared';
import type { FastifyBaseLogger } from 'fastify';

export interface WebhookConfig {
  readonly url: string;
  readonly secret: string | null;
  readonly events: readonly WebhookEventType[];
  readonly timeoutMs: number;
  readonly allowPrivateNetworks: boolean;
}

export interface WebhookInstanceMetadata {
  readonly appName: string;
  readonly publicBaseUrl: string;
}

export interface WebhookEnvelope {
  readonly event: WebhookEventType;
  readonly eventId: string;
  readonly timestamp: string;
  readonly instance: WebhookInstanceMetadata;
  readonly data: Record<string, unknown>;
}

export interface WebhookDispatcher {
  emit(event: WebhookEventType, data: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export interface MemoryWebhookDispatcher extends WebhookDispatcher {
  readonly deliveries: WebhookEnvelope[];
  clear(): void;
}

export type LookupAllFn = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export interface CreateWebhookDispatcherOptions {
  readonly config: WebhookConfig | null;
  readonly instance: WebhookInstanceMetadata;
  readonly logger: FastifyBaseLogger;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly lookupImpl?: LookupAllFn | undefined;
  readonly retryDelayMs?: number | undefined;
}

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    acc = (acc << 8) | octet;
  }
  return acc >>> 0;
}

function ipv4InCidr(ipUint: number, baseStr: string, prefixBits: number): boolean {
  const baseUint = parseIpv4ToUint32(baseStr);
  if (baseUint === null) {
    return false;
  }
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (ipUint & mask) === (baseUint & mask);
}

/**
 * Checks whether an IPv4 or IPv6 literal belongs to loopback, RFC 1918 private space,
 * link-local / cloud metadata, CGNAT, multicast, or unspecified ranges (SSRF protection).
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  const trimmed = rawIp.trim().replace(/^\[|\]$/g, '').toLowerCase();
  const zoneIdx = trimmed.indexOf('%');
  const ip = zoneIdx >= 0 ? trimmed.slice(0, zoneIdx) : trimmed;

  const ipType = net.isIP(ip);
  if (ipType === 4) {
    const val = parseIpv4ToUint32(ip);
    if (val === null) {
      return true;
    }
    return (
      ipv4InCidr(val, '0.0.0.0', 8) ||
      ipv4InCidr(val, '10.0.0.0', 8) ||
      ipv4InCidr(val, '100.64.0.0', 10) ||
      ipv4InCidr(val, '127.0.0.0', 8) ||
      ipv4InCidr(val, '169.254.0.0', 16) ||
      ipv4InCidr(val, '172.16.0.0', 12) ||
      ipv4InCidr(val, '192.0.0.0', 24) ||
      ipv4InCidr(val, '192.0.2.0', 24) ||
      ipv4InCidr(val, '192.168.0.0', 16) ||
      ipv4InCidr(val, '198.18.0.0', 15) ||
      ipv4InCidr(val, '198.51.100.0', 24) ||
      ipv4InCidr(val, '203.0.113.0', 24) ||
      ipv4InCidr(val, '224.0.0.0', 4) ||
      ipv4InCidr(val, '240.0.0.0', 4)
    );
  }

  if (ipType === 6) {
    if (ip === '::' || ip === '::1') {
      return true;
    }
    // IPv4-mapped IPv6 dotted form: ::ffff:127.0.0.1
    const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
    if (mappedDotted?.[1]) {
      return isPrivateOrReservedIp(mappedDotted[1]);
    }
    // IPv4-mapped IPv6 hex form: ::ffff:7f00:1
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (mappedHex?.[1] && mappedHex[2]) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrReservedIp(dotted);
    }
    const firstHextetStr = ip.split(':')[0] ?? '';
    const firstHextet =
      firstHextetStr.length > 0 ? Number.parseInt(firstHextetStr, 16) : 0;
    // fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast)
    if ((firstHextet & 0xfe00) === 0xfc00) {
      return true;
    }
    if ((firstHextet & 0xffc0) === 0xfe80) {
      return true;
    }
    if ((firstHextet & 0xff00) === 0xff00) {
      return true;
    }
    return false;
  }

  return true;
}

export async function assertWebhookTargetAllowed(
  targetUrl: string,
  allowPrivateNetworks: boolean,
  lookupImpl?: LookupAllFn,
): Promise<void> {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported webhook URL protocol "${parsed.protocol}".`);
  }

  if (allowPrivateNetworks) {
    return;
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(
      `Webhook host "${host}" resolves to a private/local address; set WEBHOOK_ALLOW_PRIVATE_NETWORKS=true to allow internal targets.`,
    );
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(
        `Webhook IP "${host}" is in a private or reserved range; set WEBHOOK_ALLOW_PRIVATE_NETWORKS=true to allow internal targets.`,
      );
    }
    return;
  }

  const resolved = lookupImpl
    ? await lookupImpl(host)
    : await dns.lookup(host, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error(`Unable to resolve webhook host "${host}".`);
  }
  for (const record of resolved) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(
        `Webhook host "${host}" resolved to private/reserved IP "${record.address}"; set WEBHOOK_ALLOW_PRIVATE_NETWORKS=true to allow internal targets.`,
      );
    }
  }
}

export function signWebhookPayload(
  secret: string,
  timestampSec: string,
  rawBody: string,
): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestampSec}.${rawBody}`, 'utf8')
    .digest('hex');
  return `sha256=${digest}`;
}

/**
 * Extracts strictly public, zero-PII polygon metadata matching the public ODbL-1.0 export
 * so outbound webhooks never transmit personal data (no pseudonyms, emails, user IDs, or IPs).
 */
export function buildPublicPolygonWebhookData(
  feature: PolygonFeature,
): Record<string, unknown> {
  return {
    id: feature.id,
    geometry: feature.geometry,
    surfaceType: feature.properties.surfaceType,
    status: feature.properties.status,
    origin: feature.properties.origin,
    wasAutoClipped: feature.properties.wasAutoClipped,
    clippedAreaM2: feature.properties.clippedAreaM2,
    finishedAt: feature.properties.finishedAt,
    note: feature.properties.note,
    areaM2: feature.properties.areaM2,
    municipalityAgs: feature.properties.municipalityAgs,
    municipalityName: feature.properties.municipalityName,
    upvotes: feature.properties.upvotes,
    downvotes: feature.properties.downvotes,
    score: feature.properties.score,
    createdAt: feature.properties.createdAt,
    updatedAt: feature.properties.updatedAt,
  };
}

export function createNoopWebhookDispatcher(): WebhookDispatcher {
  return {
    emit(): void {
      // Disabled
    },
    async flush(): Promise<void> {
      // No pending deliveries
    },
  };
}

export function createMemoryWebhookDispatcher(
  instance: WebhookInstanceMetadata = {
    appName: 'OpenUnseal',
    publicBaseUrl: 'http://127.0.0.1:3000',
  },
  subscribedEvents?: readonly WebhookEventType[],
): MemoryWebhookDispatcher {
  const deliveries: WebhookEnvelope[] = [];
  const allowedSet = subscribedEvents ? new Set(subscribedEvents) : null;
  return {
    deliveries,
    emit(event: WebhookEventType, data: Record<string, unknown>): void {
      if (allowedSet && !allowedSet.has(event)) {
        return;
      }
      deliveries.push({
        event,
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        instance,
        data,
      });
    },
    async flush(): Promise<void> {
      // In-memory deliveries are recorded synchronously
    },
    clear(): void {
      deliveries.length = 0;
    },
  };
}

export function createWebhookDispatcher(
  options: CreateWebhookDispatcherOptions,
): WebhookDispatcher {
  const { config, instance, logger } = options;
  if (!config || config.events.length === 0) {
    return createNoopWebhookDispatcher();
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 400;
  const subscribed = new Set<WebhookEventType>(config.events);
  const inFlight = new Set<Promise<void>>();

  const deliver = async (envelope: WebhookEnvelope): Promise<void> => {
    try {
      await assertWebhookTargetAllowed(
        config.url,
        config.allowPrivateNetworks,
        options.lookupImpl,
      );
    } catch (err: unknown) {
      logger.warn(
        { event: envelope.event, eventId: envelope.eventId, err },
        'Outbound webhook blocked by SSRF network guard',
      );
      return;
    }

    const rawBody = JSON.stringify(envelope);
    const timestampSec = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'OpenUnseal-Webhook/1.0',
      'X-OpenUnseal-Event': envelope.event,
      'X-OpenUnseal-Delivery': envelope.eventId,
      'X-OpenUnseal-Timestamp': timestampSec,
    };
    if (config.secret) {
      headers['X-OpenUnseal-Signature-256'] = signWebhookPayload(
        config.secret,
        timestampSec,
        rawBody,
      );
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetchImpl(config.url, {
          method: 'POST',
          headers,
          body: rawBody,
          redirect: 'error',
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (response.ok) {
          return;
        }
        if (response.status >= 400 && response.status < 500) {
          logger.warn(
            {
              event: envelope.event,
              eventId: envelope.eventId,
              status: response.status,
            },
            'Outbound webhook rejected by receiver (4xx; not retrying)',
          );
          return;
        }
        if (attempt === 2) {
          logger.warn(
            {
              event: envelope.event,
              eventId: envelope.eventId,
              status: response.status,
            },
            'Outbound webhook delivery failed after retry',
          );
          return;
        }
      } catch (err: unknown) {
        if (attempt === 2) {
          logger.warn(
            { event: envelope.event, eventId: envelope.eventId, err },
            'Outbound webhook delivery error after retry',
          );
          return;
        }
      }
      if (retryDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  };

  return {
    emit(event: WebhookEventType, data: Record<string, unknown>): void {
      if (!subscribed.has(event)) {
        return;
      }
      const envelope: WebhookEnvelope = {
        event,
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        instance,
        data,
      };
      const task = deliver(envelope).finally(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    },
    async flush(): Promise<void> {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}
