import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTranslations } from '../src/i18n/translations';
import {
  createAlwaysPlayIntroStorage,
  createMemoryIntroStorage,
  createWebIntroStorage,
  formatLocalDateKey,
  INTRO_LAST_PLAYED_DATE_KEY,
  isSameLocalCalendarDay,
  parseSavedIntroDateKey,
  resolveDefaultIntroStorage,
  type WebIntroStorageLike,
} from '../src/storage/introStorage';

function createFakeLocalStorage(): WebIntroStorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };
}

describe('introStorage same-day browser policy & native startup playback', () => {
  it('formats local calendar dates as YYYY-MM-DD without UTC drift', () => {
    const earlyMorning = new Date(2026, 0, 5, 0, 15, 0);
    assert.equal(formatLocalDateKey(earlyMorning), '2026-01-05');

    const lateNight = new Date(2026, 10, 17, 23, 59, 59);
    assert.equal(formatLocalDateKey(lateNight), '2026-11-17');
  });

  it('validates stored date keys and compares local calendar days', () => {
    const today = new Date(2026, 10, 17, 9, 30, 0);
    assert.equal(parseSavedIntroDateKey(' 2026-11-17 '), '2026-11-17');
    assert.equal(parseSavedIntroDateKey('not-a-date'), null);
    assert.equal(parseSavedIntroDateKey(null), null);

    assert.equal(isSameLocalCalendarDay('2026-11-17', today), true);
    assert.equal(isSameLocalCalendarDay('2026-11-16', today), false);
    assert.equal(isSameLocalCalendarDay('invalid', today), false);
  });

  it('plays once per local calendar day in the browser and skips same-day refreshes', () => {
    const fakeStorage = createFakeLocalStorage();
    const morning = new Date(2026, 10, 17, 8, 15, 0);
    const eveningSameDay = new Date(2026, 10, 17, 22, 45, 0);
    const nextDay = new Date(2026, 10, 18, 0, 5, 0);

    // First browser load today
    const firstLoadStorage = createWebIntroStorage(() => fakeStorage);
    assert.equal(firstLoadStorage.shouldPlayIntro(morning), true);
    firstLoadStorage.markIntroPlayed(morning);
    assert.equal(
      fakeStorage.store.get(INTRO_LAST_PLAYED_DATE_KEY),
      '2026-11-17',
    );

    // Simulated page refresh later the same day
    const refreshedLoadStorage = createWebIntroStorage(() => fakeStorage);
    assert.equal(refreshedLoadStorage.shouldPlayIntro(eveningSameDay), false);

    // Next calendar day plays again
    const nextDayStorage = createWebIntroStorage(() => fakeStorage);
    assert.equal(nextDayStorage.shouldPlayIntro(nextDay), true);
    nextDayStorage.markIntroPlayed(nextDay);
    assert.equal(
      fakeStorage.store.get(INTRO_LAST_PLAYED_DATE_KEY),
      '2026-11-18',
    );

    nextDayStorage.clearIntroPlayed();
    assert.equal(fakeStorage.store.has(INTRO_LAST_PLAYED_DATE_KEY), false);
    assert.equal(nextDayStorage.shouldPlayIntro(nextDay), true);
  });

  it('falls back safely to in-memory tracking if localStorage throws or is absent', () => {
    const day = new Date(2026, 10, 17, 12, 0, 0);
    const throwingStorage: WebIntroStorageLike = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
    };

    const webWithError = createWebIntroStorage(() => throwingStorage);
    assert.equal(webWithError.shouldPlayIntro(day), true);
    webWithError.markIntroPlayed(day);
    assert.equal(webWithError.shouldPlayIntro(day), false);

    const webWithoutStorage = createWebIntroStorage(() => null);
    assert.equal(webWithoutStorage.shouldPlayIntro(day), true);
    webWithoutStorage.markIntroPlayed(day);
    assert.equal(webWithoutStorage.shouldPlayIntro(day), false);
  });

  it('always plays on native app launches and supports memory intro storage', () => {
    const day = new Date(2026, 10, 17, 14, 0, 0);
    const always = createAlwaysPlayIntroStorage();
    assert.equal(always.shouldPlayIntro(day), true);
    always.markIntroPlayed(day);
    assert.equal(always.shouldPlayIntro(day), true);

    const androidStore = resolveDefaultIntroStorage('android');
    androidStore.markIntroPlayed(day);
    assert.equal(androidStore.shouldPlayIntro(day), true);

    const iosStore = resolveDefaultIntroStorage('ios');
    iosStore.markIntroPlayed(day);
    assert.equal(iosStore.shouldPlayIntro(day), true);

    const memStore = createMemoryIntroStorage('2026-11-17');
    assert.equal(memStore.shouldPlayIntro(day), false);
    memStore.clearIntroPlayed();
    assert.equal(memStore.shouldPlayIntro(day), true);
  });

  it('provides localized DE and EN intro copy', () => {
    const de = getTranslations('de').intro;
    const en = getTranslations('en').intro;

    assert.equal(de.title, 'Unseal');
    assert.equal(en.title, 'Unseal');
    assert.ok(de.subtitle.length > 0);
    assert.ok(en.subtitle.length > 0);
    assert.ok(de.tagline.length > 0);
    assert.ok(en.tagline.length > 0);
    assert.ok(de.skipButton.length > 0);
    assert.ok(en.skipButton.length > 0);
    assert.ok(de.skipA11y.length > 0);
    assert.ok(en.skipA11y.length > 0);
    assert.ok(de.overlayA11y.length > 0);
    assert.ok(en.overlayA11y.length > 0);
  });
});
