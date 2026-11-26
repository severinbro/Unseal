// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  POLYGON_FILTERS,
  SPACE_FILTERS,
  type PolygonFilter,
  type SpaceFilter,
} from '@openunseal/shared';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getSocialCopy } from '../i18n/social';
import type { Locale } from '../i18n/translations';
import type { FeedScope } from '../state/feedScope';
import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { RADII, type ThemePalette } from '../theme/tokens';
import { groundLabel } from './SpaceSections';

const MENU_MIN_WIDTH = 220;
const SCREEN_MARGIN = 12;

interface Option<T extends string> {
  value: T;
  label: string;
  testID: string;
}

/** One filter as a button that opens a list with a single choice. */
function FilterMenu<T extends string>(props: {
  testID: string;
  label: string;
  value: T;
  /** The value that filters nothing. */
  neutral: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const window = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const isOpen = anchor !== null;
  const isActive = props.value !== props.neutral;
  const current = props.options.find((option) => option.value === props.value);

  useEffect(() => {
    // The list is placed below the button once; it would be off after a resize.
    setAnchor(null);
  }, [window.width, window.height]);

  const open = (): void => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      const menuWidth = Math.max(MENU_MIN_WIDTH, width);
      setAnchor({
        left: Math.max(
          SCREEN_MARGIN,
          Math.min(x, window.width - menuWidth - SCREEN_MARGIN),
        ),
        top: y + height + 6,
        width: menuWidth,
      });
    });
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        testID={props.testID}
        accessibilityRole="button"
        accessibilityLabel={`${props.label}: ${current?.label ?? ''}`}
        accessibilityState={{ expanded: isOpen }}
        aria-expanded={isOpen}
        onPress={open}
        style={({ pressed }) => [
          styles.trigger,
          isActive ? styles.triggerActive : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Text numberOfLines={1} style={styles.triggerText}>
          <Text style={styles.triggerLabel}>{props.label}: </Text>
          <Text style={[styles.triggerValue, isActive ? styles.accentText : null]}>
            {current?.label}
          </Text>
        </Text>
        <View style={[styles.chevron, isOpen ? styles.chevronOpen : null]} />
      </Pressable>
      {anchor !== null ? (
        <Modal
          visible
          transparent
          animationType="none"
          onRequestClose={() => setAnchor(null)}
        >
          <Pressable
            accessible={false}
            testID="filter-menu-backdrop"
            onPress={() => setAnchor(null)}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={props.label}
            style={[
              styles.menu,
              {
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
                maxHeight: Math.max(160, window.height - anchor.top - SCREEN_MARGIN),
              },
            ]}
          >
            <ScrollView>
              {props.options.map((option) => {
                const isSelected = option.value === props.value;
                return (
                  <Pressable
                    key={option.value}
                    testID={option.testID}
                    accessibilityRole="radio"
                    aria-checked={isSelected}
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: isSelected }}
                    onPress={() => {
                      setAnchor(null);
                      props.onChange(option.value);
                    }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      pressed ? styles.menuItemPressed : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.menuItemLabel,
                        isSelected ? styles.menuItemLabelSelected : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {isSelected ? <Text style={styles.menuCheck}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

/** What the feed shows: where, in which state, and on which kind of ground. */
export function FeedFilterBar(props: {
  locale: Locale;
  scope: FeedScope;
  filter: PolygonFilter;
  spaceFilter: SpaceFilter;
  canUseNear: boolean;
  /** What the list contains and how it is ordered. */
  caption: string;
  onScopeAll: () => void;
  onScopeNear: () => void;
  onFilter: (filter: PolygonFilter) => void;
  onSpaceFilter: (filter: SpaceFilter) => void;
}): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const t = getSocialCopy(props.locale);
  const { scope, filter, spaceFilter } = props;
  const isFiltered =
    scope.kind !== 'all' || filter !== 'all' || spaceFilter !== 'all';

  const segment = (
    kind: 'all' | 'near',
    label: string,
    disabled: boolean,
    onPress: () => void,
  ): React.JSX.Element => {
    const isSelected = scope.kind === kind;
    return (
      <Pressable
        testID={`feed-scope-${kind}`}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: isSelected, disabled }}
        aria-checked={isSelected}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.segment,
          isSelected ? styles.segmentSelected : null,
          disabled ? styles.disabled : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.segmentLabel,
            isSelected ? styles.segmentLabelSelected : null,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View testID="feed-filter-bar" style={styles.bar}>
      <View style={styles.controls}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t.scopeLabel}
          style={styles.segments}
        >
          {segment('all', t.scopeAll, false, props.onScopeAll)}
          {segment('near', t.scopeNear, !props.canUseNear, props.onScopeNear)}
        </View>
        {scope.kind === 'municipality' ? (
          <Pressable
            testID="feed-scope-municipality"
            accessibilityRole="button"
            accessibilityLabel={t.scopeMunicipalityClear(scope.name)}
            onPress={props.onScopeAll}
            style={({ pressed }) => [
              styles.trigger,
              styles.triggerActive,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text numberOfLines={1} style={[styles.triggerValue, styles.accentText]}>
              {t.scopeMunicipality(scope.name)}
            </Text>
            <Text style={styles.accentText}>✕</Text>
          </Pressable>
        ) : null}
        <FilterMenu
          testID="feed-filter-menu"
          label={t.statusFilter}
          value={filter}
          neutral="all"
          options={POLYGON_FILTERS.map((value) => ({
            value,
            label: t.filters[value],
            testID: `feed-filter-${value}`,
          }))}
          onChange={props.onFilter}
        />
        <FilterMenu
          testID="space-filter-menu"
          label={t.groundFilter}
          value={spaceFilter}
          neutral="all"
          options={SPACE_FILTERS.map((value) => ({
            value,
            label: value === 'all' ? t.filters.all : groundLabel(value, t),
            testID: `space-filter-${value}`,
          }))}
          onChange={props.onSpaceFilter}
        />
      </View>
      <View style={styles.captionRow}>
        <Text style={styles.caption}>{props.caption}</Text>
        {isFiltered ? (
          <Pressable
            testID="feed-filter-reset"
            accessibilityRole="button"
            accessibilityLabel={t.resetFilters}
            hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
            onPress={() => {
              props.onScopeAll();
              props.onFilter('all');
              props.onSpaceFilter('all');
            }}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={styles.resetLabel}>{t.resetFilters}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(p: ThemePalette, isDark: boolean) {
  return StyleSheet.create({
    bar: {
      gap: 10,
      padding: 13,
      borderRadius: RADII.lg,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.bgSurface,
    },
    controls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    segments: {
      flexDirection: 'row',
      minHeight: MIN_TOUCH_TARGET_DP,
      padding: 3,
      gap: 3,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.bgGround,
    },
    segment: {
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    segmentSelected: {
      backgroundColor: p.inkPrimary,
      borderColor: p.inkPrimary,
    },
    segmentLabel: { fontSize: 13, fontWeight: '600', color: p.inkSecondary },
    segmentLabelSelected: {
      color: p.bgSurface,
      fontWeight: '700',
    },
    trigger: {
      minHeight: MIN_TOUCH_TARGET_DP,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 14,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.bgGround,
    },
    triggerActive: {
      borderColor: p.accentPrimary,
      backgroundColor: p.infoBg,
    },
    triggerText: { flexShrink: 1 },
    triggerLabel: { fontSize: 13, color: p.inkMuted },
    triggerValue: { fontSize: 13, fontWeight: '600', color: p.inkPrimary },
    accentText: { color: p.accentPrimary, fontWeight: '700' },
    chevron: {
      width: 7,
      height: 7,
      marginTop: -3,
      borderRightWidth: 1.8,
      borderBottomWidth: 1.8,
      borderColor: p.inkMuted,
      transform: [{ rotate: '45deg' }],
    },
    chevronOpen: { marginTop: 4, transform: [{ rotate: '225deg' }] },
    menu: {
      position: 'absolute',
      paddingVertical: 6,
      borderRadius: RADII.lg,
      borderWidth: 1,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
      ...(Platform.OS === 'web'
        ? {
            boxShadow: isDark
              ? '0 8px 28px rgba(0, 0, 0, 0.55)'
              : '0 8px 24px rgba(18, 19, 22, 0.14)',
          }
        : { elevation: 10 }),
    },
    menuItem: {
      minHeight: MIN_TOUCH_TARGET_DP,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
    },
    menuItemPressed: { backgroundColor: p.bgRecessed },
    menuItemLabel: { flexShrink: 1, fontSize: 14, color: p.inkPrimary },
    menuItemLabelSelected: { fontWeight: '700', color: p.accentPrimary },
    menuCheck: { fontSize: 14, fontWeight: '700', color: p.accentPrimary },
    captionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingTop: 4,
      borderTopWidth: 1,
      borderTopColor: p.borderSubtle,
    },
    caption: { flexShrink: 1, fontSize: 12, lineHeight: 17, color: p.inkMuted },
    resetLabel: { fontSize: 12.5, fontWeight: '600', color: p.accentPrimary },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.7 },
  });
}
