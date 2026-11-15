import type { GeocodeResultItem } from '@entsiegelung/shared';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  DEFAULT_LOCALE,
  getTranslations,
  localizeError,
  type Locale,
} from '../i18n/translations';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { PALETTE, RADII } from '../theme/tokens';

export interface AddressSearchModalProps {
  visible: boolean;
  locale?: Locale | undefined;
  compact?: boolean | undefined;
  onSearch: (query: string) => Promise<GeocodeResultItem[]>;
  onSelectResult: (item: GeocodeResultItem) => void;
  onClose: () => void;
}

export function AddressSearchModal({
  visible,
  locale = DEFAULT_LOCALE,
  compact = false,
  onSearch,
  onSelectResult,
  onClose,
}: AddressSearchModalProps): React.JSX.Element | null {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<GeocodeResultItem[]>([]);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setErrorMessage(null);
      setIsSearching(false);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  const t = getTranslations(locale).search;

  const handleSearchSubmit = (): void => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setErrorMessage(t.minCharsError);
      return;
    }

    setErrorMessage(null);
    setIsSearching(true);
    void onSearch(trimmed)
      .then((items) => {
        setResults(items);
        setHasSearched(true);
      })
      .catch((err: unknown) => {
        setErrorMessage(localizeError(err, t.errorFallback, locale));
      })
      .finally(() => {
        setIsSearching(false);
      });
  };

  return (
    <View
      testID="address-search-modal-card"
      accessibilityLabel={t.modalA11y}
      style={[styles.card, compact ? styles.cardCompact : null]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTextGroup}>
          <Text style={styles.title}>{t.title}</Text>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
        </View>
        <Pressable
          testID="address-search-close"
          accessibilityRole="button"
          accessibilityLabel={t.closeA11y}
          onPress={onClose}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text style={styles.closeButtonLabel}>{t.close}</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          testID="address-search-input"
          accessibilityLabel={t.inputA11y}
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            if (errorMessage) {
              setErrorMessage(null);
            }
          }}
          placeholder={t.inputPlaceholder}
          placeholderTextColor={PALETTE.inkMuted}
          returnKeyType="search"
          autoFocus
          autoCorrect={false}
          onSubmitEditing={handleSearchSubmit}
          style={styles.searchInput}
        />
        <Pressable
          testID="address-search-submit"
          accessibilityRole="button"
          accessibilityLabel={t.submitButton}
          disabled={isSearching}
          onPress={handleSearchSubmit}
          style={({ pressed }) => [
            styles.touchButton,
            styles.primaryButton,
            isSearching ? styles.disabledButton : null,
            pressed && !isSearching ? styles.primaryButtonPressed : null,
          ]}
        >
          <Text style={styles.primaryButtonLabel}>
            {isSearching ? t.searchingBusy : t.submitButton}
          </Text>
        </Pressable>
      </View>

      {errorMessage ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {isSearching ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={PALETTE.accentPrimary} />
        </View>
      ) : results.length > 0 ? (
        <View style={styles.resultsList}>
          {results.map((item) => (
            <Pressable
              key={item.placeId}
              testID={`geocode-result-${item.placeId}`}
              accessibilityRole="button"
              accessibilityLabel={item.displayName}
              onPress={() => onSelectResult(item)}
              style={({ pressed }) => [
                styles.resultItem,
                pressed ? styles.resultItemPressed : null,
              ]}
            >
              <Text style={styles.resultLabel} numberOfLines={2}>
                {item.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : hasSearched ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>{t.noResults}</Text>
        </View>
      ) : null}

      <Text style={styles.attributionNote}>{t.attributionNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    padding: 15,
    borderRadius: RADII.sheet,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    gap: 10,
  },
  cardCompact: {
    padding: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTextGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: PALETTE.inkPrimary,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: PALETTE.inkSecondary,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 14,
    color: PALETTE.inkPrimary,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonPressed: {
    backgroundColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  disabledButton: {
    opacity: 0.65,
  },
  buttonPressed: {
    backgroundColor: PALETTE.bgRecessed,
  },
  errorBox: {
    padding: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: PALETTE.dangerText,
  },
  loadingBox: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsList: {
    gap: 6,
  },
  resultItem: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    justifyContent: 'center',
  },
  resultItemPressed: {
    backgroundColor: PALETTE.bgTinted,
    borderColor: PALETTE.accentPrimary,
  },
  resultLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  emptyBox: {
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12.5,
    color: PALETTE.inkMuted,
    textAlign: 'center',
  },
  attributionNote: {
    fontSize: 11,
    color: PALETTE.inkMuted,
  },
});
