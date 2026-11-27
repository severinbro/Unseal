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
  fullWidth?: boolean;
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
          props.fullWidth ? styles.triggerFullWidth : null,
          isActive ? styles.triggerActive : null,
          pressed ? styles.keycapPressed : null,
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
                      isSelected ? styles.menuItemSelected : null,
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
  /** Stacks controls as a vertical Field-Compass rail on wide viewports. */
  vertical?: boolean;
  onScopeAll: () => void;
  onScopeNear: () => void;
  onFilter: (filter: PolygonFilter) => void;
  onSpaceFilter: (filter: SpaceFilter) => void;
}): React.JSX.Element {
  const { palette, isDark } = useTheme();
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const t = getSocialCopy(props.locale);
  const { scope, filter, spaceFilter, vertical = false } = props;
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
          vertical ? styles.segmentFlex : null,
          isSelected ? styles.segmentSelected : null,
          disabled ? styles.disabled : null,
          pressed && !disabled ? styles.pressed : null,
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
    <View
      testID="feed-filter-bar"
      style={[styles.bar, vertical ? styles.barVertical : null]}
    >
      {vertical ? (
        <View style={styles.railHeaderRow}>
          <View style={styles.railHeaderSquare} />
          <Text style={styles.railHeaderTitle}>{t.scopeLabel}</Text>
        </View>
      ) : null}

      <View style={[styles.controls, vertical ? styles.controlsVertical : null]}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t.scopeLabel}
          style={[styles.segments, vertical ? styles.segmentsVertical : null]}
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
              vertical ? styles.triggerFullWidth : null,
              styles.triggerActive,
              pressed ? styles.keycapPressed : null,
            ]}
          >
            <Text numberOfLines={1} style={[styles.triggerValue, styles.accentText]}>
              ⌖ {t.scopeMunicipality(scope.name)}
            </Text>
            <Text style={styles.accentText}>✕</Text>
          </Pressable>
        ) : null}
        <FilterMenu
          testID="feed-filter-menu"
          label={t.statusFilter}
          value={filter}
          neutral="all"
          fullWidth={vertical}
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
          fullWidth={vertical}
          options={SPACE_FILTERS.map((value) => ({
            value,
            label: value === 'all' ? t.filters.all : groundLabel(value, t),
            testID: `space-filter-${value}`,
          }))}
          onChange={props.onSpaceFilter}
        />
      </View>

      <View style={[styles.captionRow, vertical ? styles.captionRowVertical : null]}>
        <Text style={styles.caption}>{props.caption}</Text>
        {isFiltered ? (
          <Pressable
            testID="feed-filter-reset"
            accessibilityRole="button"
            accessibilityLabel={t.resetFilters}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              props.onScopeAll();
              props.onFilter('all');
              props.onSpaceFilter('all');
            }}
            style={({ pressed }) => [
              styles.resetKeycap,
              pressed ? styles.keycapPressed : null,
            ]}
          >
            <Text style={styles.resetLabel}>↺ {t.resetFilters}</Text>
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
      borderWidth: 1.5,
      borderBottomWidth: 3.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
      ...(Platform.OS === 'web'
        ? {
            boxShadow: isDark
              ? '0 3px 0 rgba(0, 0, 0, 0.42)'
              : '0 3px 0 rgba(17, 31, 24, 0.1)',
          }
        : { elevation: 2 }),
    },
    barVertical: {
      padding: 14,
      gap: 12,
    },
    railHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingBottom: 8,
      borderBottomWidth: 1.5,
      borderBottomColor: p.borderSubtle,
    },
    railHeaderSquare: {
      width: 8,
      height: 8,
      borderRadius: 1.5,
      backgroundColor: p.accentPrimary,
    },
    railHeaderTitle: {
      fontSize: 11.5,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: p.inkSecondary,
    },
    controls: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    controlsVertical: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 9,
    },
    segments: {
      flexDirection: 'row',
      minHeight: MIN_TOUCH_TARGET_DP,
      padding: 3,
      gap: 3,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgRecessed,
    },
    segmentsVertical: {
      width: '100%',
    },
    segment: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 13,
      borderRadius: RADII.sm,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    segmentFlex: {
      flex: 1,
      paddingHorizontal: 7,
    },
    segmentSelected: {
      backgroundColor: p.accentPrimary,
      borderColor: p.accentPrimaryStrong,
      borderBottomWidth: 2.5,
    },
    segmentLabel: { fontSize: 12, fontWeight: '700', color: p.inkSecondary },
    segmentLabelSelected: {
      color: p.inkOnAccent,
      fontWeight: '800',
    },
    trigger: {
      minHeight: MIN_TOUCH_TARGET_DP,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 12,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 3,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSubtle,
    },
    triggerFullWidth: {
      width: '100%',
      justifyContent: 'space-between',
    },
    triggerActive: {
      borderColor: p.accentPrimary,
      backgroundColor: p.bgTinted,
    },
    triggerText: { flexShrink: 1 },
    triggerLabel: { fontSize: 12.5, fontWeight: '600', color: p.inkSecondary },
    triggerValue: { fontSize: 13, fontWeight: '700', color: p.inkPrimary },
    accentText: { color: p.positiveText, fontWeight: '800' },
    chevron: {
      width: 7,
      height: 7,
      marginTop: -3,
      borderRightWidth: 2,
      borderBottomWidth: 2,
      borderColor: p.inkSecondary,
      transform: [{ rotate: '45deg' }],
    },
    chevronOpen: { marginTop: 4, transform: [{ rotate: '225deg' }] },
    menu: {
      position: 'absolute',
      paddingVertical: 4,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 4,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
      ...(Platform.OS === 'web'
        ? {
            boxShadow: isDark
              ? '0 5px 0 rgba(0, 0, 0, 0.5)'
              : '0 5px 0 rgba(17, 31, 24, 0.16)',
          }
        : { elevation: 10 }),
    },
    menuItem: {
      minHeight: MIN_TOUCH_TARGET_DP,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 14,
    },
    menuItemSelected: {
      backgroundColor: p.bgTinted,
    },
    menuItemPressed: { backgroundColor: p.bgRecessed },
    menuItemLabel: { flexShrink: 1, fontSize: 13.5, fontWeight: '600', color: p.inkPrimary },
    menuItemLabelSelected: { fontWeight: '800', color: p.positiveText },
    menuCheck: { fontSize: 14, fontWeight: '800', color: p.accentPrimary },
    captionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingTop: 8,
      borderTopWidth: 1.5,
      borderStyle: 'dashed',
      borderTopColor: p.borderStrong,
    },
    captionRowVertical: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 8,
    },
    caption: { flexShrink: 1, fontSize: 12, lineHeight: 17, color: p.inkMuted },
    resetKeycap: {
      minHeight: 36,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: RADII.sm,
      borderWidth: 1.5,
      borderBottomWidth: 2.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSubtle,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    resetLabel: { fontSize: 12, fontWeight: '800', color: p.accentPrimary },
    keycapPressed: {
      transform: [{ translateY: 1.5 }],
      borderBottomWidth: 1.5,
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
  });
}
