import { isIP } from 'node:net';

function parseIpv4Hextets(ipv4Part: string): [number, number] | null {
  const octets = ipv4Part.split('.');
  if (octets.length !== 4) {
    return null;
  }
  const nums: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      return null;
    }
    const n = Number(octet);
    if (n < 0 || n > 255) {
      return null;
    }
    nums.push(n);
  }
  return [(nums[0]! << 8) | nums[1]!, (nums[2]! << 8) | nums[3]!];
}

function expandIpv6ToHextets(ipv6: string): number[] | null {
  let working = ipv6;

  // Convert trailing dotted IPv4 (e.g. ::ffff:203.0.113.7) into two hex groups
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const ipv4Hextets = parseIpv4Hextets(working.slice(lastColon + 1));
    if (!ipv4Hextets) {
      return null;
    }
    working = `${working.slice(0, lastColon)}:${ipv4Hextets[0].toString(16)}:${ipv4Hextets[1].toString(16)}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) {
    return null;
  }

  const parseSegmentList = (segmentStr: string): number[] | null => {
    if (segmentStr === '') {
      return [];
    }
    const tokens = segmentStr.split(':');
    const values: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(token)) {
        return null;
      }
      values.push(parseInt(token, 16));
    }
    return values;
  };

  if (doubleColonParts.length === 2) {
    const left = parseSegmentList(doubleColonParts[0]!);
    const right = parseSegmentList(doubleColonParts[1]!);
    if (!left || !right || left.length + right.length >= 8) {
      return null;
    }
    const missingZeros = 8 - left.length - right.length;
    return [...left, ...new Array<number>(missingZeros).fill(0), ...right];
  }

  const full = parseSegmentList(working);
  if (!full || full.length !== 8) {
    return null;
  }
  return full;
}

export function normalizeRateLimitIp(ip: string): string {
  let cleaned = ip.trim();
  if (!cleaned) {
    return 'unknown';
  }

  // Strip bracket wrapper if present (e.g. "[2001:db8::1]")
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }

  // Strip IPv6 zone index if present (e.g. "fe80::1%eth0")
  const zoneIndex = cleaned.indexOf('%');
  if (zoneIndex !== -1) {
    cleaned = cleaned.slice(0, zoneIndex);
  }

  const ipVersion = isIP(cleaned);
  if (ipVersion === 4) {
    return cleaned;
  }

  if (ipVersion === 6) {
    const hextets = expandIpv6ToHextets(cleaned);
    if (!hextets) {
      return cleaned.toLowerCase();
    }

    // Unwrap IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) to canonical IPv4
    if (
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0xffff
    ) {
      const high = hextets[6]!;
      const low = hextets[7]!;
      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    }

    // Collapse standard IPv6 addresses to their /64 subnet prefix (first 4 hextets)
    const prefix = hextets
      .slice(0, 4)
      .map((group) => group.toString(16).padStart(4, '0'))
      .join(':');
    return `${prefix}::/64`;
  }

  return cleaned.toLowerCase();
}

export function normalizeRateLimitSubnet(ip: string): string {
  const normalized = normalizeRateLimitIp(ip);
  if (normalized === 'unknown') {
    return 'unknown';
  }
  const octets = normalized.split('.');
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (normalized.endsWith('::/64')) {
    const groups = normalized.slice(0, -5).split(':');
    if (groups.length >= 3) {
      return `${groups.slice(0, 3).join(':')}::/48`;
    }
  }
  return normalized;
}
