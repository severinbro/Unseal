export const INTRO_LAST_PLAYED_DATE_KEY = 'entsiegelung.introLastPlayedDate';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface WebIntroStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface IntroStorage {
  shouldPlayIntro(now?: Date): boolean;
  markIntroPlayed(now?: Date): void;
  clearIntroPlayed(): void;
}

export function formatLocalDateKey(date: Date = new Date()): string {
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(validDate.getFullYear()).padStart(4, '0');
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  const day = String(validDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseSavedIntroDateKey(
  raw: string | null | undefined,
): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return DATE_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

export function isSameLocalCalendarDay(
  savedDateKey: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const parsed = parseSavedIntroDateKey(savedDateKey);
  if (parsed === null) {
    return false;
  }
  return parsed === formatLocalDateKey(now);
}

export function createMemoryIntroStorage(
  initialDateKey: string | null = null,
): IntroStorage {
  let lastPlayedDateKey = parseSavedIntroDateKey(initialDateKey);
  return {
    shouldPlayIntro(now: Date = new Date()): boolean {
      return !isSameLocalCalendarDay(lastPlayedDateKey, now);
    },
    markIntroPlayed(now: Date = new Date()): void {
      lastPlayedDateKey = formatLocalDateKey(now);
    },
    clearIntroPlayed(): void {
      lastPlayedDateKey = null;
    },
  };
}

export function createAlwaysPlayIntroStorage(): IntroStorage {
  return {
    shouldPlayIntro(): boolean {
      return true;
    },
    markIntroPlayed(): void {
      // Native app launches always show the intro on startup.
    },
    clearIntroPlayed(): void {
      // Nothing persisted for native intro playback.
    },
  };
}

function defaultWebIntroStorageProvider(): WebIntroStorageLike | null {
  try {
    const scope = globalThis as {
      window?: { localStorage?: WebIntroStorageLike };
      localStorage?: WebIntroStorageLike;
    };
    return scope.window?.localStorage ?? scope.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createWebIntroStorage(
  getStorage: () => WebIntroStorageLike | null = defaultWebIntroStorageProvider,
): IntroStorage {
  const memoryFallback = createMemoryIntroStorage();
  let operational = true;

  const resolveStorage = (): WebIntroStorageLike | null => {
    if (!operational) {
      return null;
    }
    try {
      return getStorage();
    } catch {
      operational = false;
      return null;
    }
  };

  return {
    shouldPlayIntro(now: Date = new Date()): boolean {
      const storage = resolveStorage();
      if (!storage) {
        return memoryFallback.shouldPlayIntro(now);
      }
      try {
        const raw = storage.getItem(INTRO_LAST_PLAYED_DATE_KEY);
        const saved = parseSavedIntroDateKey(raw);
        if (saved !== null) {
          return !isSameLocalCalendarDay(saved, now);
        }
        return memoryFallback.shouldPlayIntro(now);
      } catch {
        operational = false;
        return memoryFallback.shouldPlayIntro(now);
      }
    },
    markIntroPlayed(now: Date = new Date()): void {
      memoryFallback.markIntroPlayed(now);
      const storage = resolveStorage();
      if (!storage) {
        return;
      }
      try {
        storage.setItem(INTRO_LAST_PLAYED_DATE_KEY, formatLocalDateKey(now));
      } catch {
        operational = false;
      }
    },
    clearIntroPlayed(): void {
      memoryFallback.clearIntroPlayed();
      const storage = resolveStorage();
      if (!storage) {
        return;
      }
      try {
        storage.removeItem(INTRO_LAST_PLAYED_DATE_KEY);
      } catch {
        operational = false;
      }
    },
  };
}

export function resolveDefaultIntroStorage(platformOs: string): IntroStorage {
  return platformOs === 'web'
    ? createWebIntroStorage()
    : createAlwaysPlayIntroStorage();
}
