// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import {
  RADII,
  type ThemePalette,
} from '../theme/tokens';

export function useSocialStyles() {
  const { palette } = useTheme();
  const styles = useMemo(() => createSocialStyles(palette), [palette]);
  return { palette, styles };
}

export function SocialButton(props: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  selected?: boolean;
  testID?: string;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const active = props.primary === true || props.selected === true;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{
        disabled: props.disabled === true,
        ...(props.selected !== undefined ? { selected: props.selected } : {}),
      }}
      // The web renderer only passes on aria-* props, not accessibilityState.
      {...(props.selected !== undefined ? { 'aria-pressed': props.selected } : {})}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        active ? styles.buttonActive : null,
        pressed && !props.disabled ? styles.buttonPressed : null,
        props.disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={[styles.buttonLabel, active ? styles.buttonLabelActive : null]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export function SocialCheckbox(props: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testID?: string;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{
        checked: props.checked,
        disabled: props.disabled === true,
      }}
      aria-checked={props.checked}
      disabled={props.disabled}
      onPress={props.onToggle}
      style={styles.checkboxRow}
    >
      <View style={[styles.checkbox, props.checked ? styles.checkboxOn : null]}>
        {props.checked ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <Text style={styles.checkboxLabel}>{props.label}</Text>
    </Pressable>
  );
}

function createSocialStyles(p: ThemePalette) {
  return StyleSheet.create({
    card: {
      padding: 14,
      gap: 10,
      borderRadius: RADII.lg,
      backgroundColor: p.bgSurface,
      borderWidth: 1.5,
      borderBottomWidth: 3.5,
      borderColor: p.borderStrong,
    },
    section: { gap: 9 },
    grow: { flex: 1 },
    divider: {
      alignSelf: 'stretch',
      textAlign: 'center',
      fontSize: 12,
      fontWeight: '700',
      color: p.accentPrimary,
      borderTopWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: p.accentPrimary,
      paddingTop: 5,
    },
    notice: {
      padding: 11,
      borderRadius: RADII.md,
      backgroundColor: p.bgTinted,
      borderWidth: 1.5,
      borderColor: p.positiveBorder,
      gap: 8,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
    spread: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      letterSpacing: -0.3,
      color: p.inkPrimary,
    },
    subtitle: {
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: -0.15,
      color: p.inkPrimary,
    },
    body: { fontSize: 14, lineHeight: 20, color: p.inkPrimary },
    hint: { fontSize: 12, lineHeight: 17, color: p.inkMuted },
    error: { fontSize: 13, lineHeight: 18, color: p.dangerText },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: RADII.sm,
      borderWidth: 1.5,
      borderBottomWidth: 2.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSubtle,
      fontSize: 11.5,
      fontWeight: '700',
      color: p.inkPrimary,
    },
    badgePublic: {
      backgroundColor: p.positiveBg,
      borderColor: p.positiveBorder,
      color: p.positiveText,
    },
    badgePrivate: {
      backgroundColor: p.neutralBg,
      borderColor: p.neutralBorder,
      color: p.neutralText,
    },
    badgeAccess: {
      backgroundColor: p.infoBg,
      borderColor: p.infoBorder,
      color: p.infoText,
    },
    badgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    layerSection: {
      gap: 8,
      paddingTop: 6,
      borderTopWidth: 1.5,
      borderColor: p.borderSubtle,
    },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    legendSwatch: {
      width: 26,
      height: 16,
      borderWidth: 1.5,
      borderRadius: RADII.xs,
      overflow: 'hidden',
    },
    legendSwatchFill: { flex: 1 },
    legendText: { fontSize: 13, color: p.inkPrimary },
    newEntriesAnchor: {
      position: 'absolute',
      top: 12,
      left: 0,
      right: 0,
      alignItems: 'center',
      zIndex: 5,
    },
    newEntriesPill: {
      minHeight: MIN_TOUCH_TARGET_DP,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 4,
      borderColor: p.accentPrimaryStrong,
      backgroundColor: p.accentPrimary,
      ...(Platform.OS === 'web'
        ? { boxShadow: '0 4px 0 rgba(14, 68, 43, 0.35)' }
        : { elevation: 6 }),
    },
    newEntriesLabel: { fontSize: 13.5, fontWeight: '800', color: p.inkOnAccent },
    button: {
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 14,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 3.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
    },
    buttonActive: {
      backgroundColor: p.accentPrimary,
      borderColor: p.accentPrimaryStrong,
    },
    buttonPressed: {
      transform: [{ translateY: 1.5 }],
      borderBottomWidth: 2,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonLabel: { fontSize: 13.5, fontWeight: '700', color: p.inkPrimary },
    buttonLabelActive: { color: p.inkOnAccent, fontWeight: '800' },
    checkboxRow: {
      minHeight: MIN_TOUCH_TARGET_DP,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: RADII.sm,
      borderWidth: 1.5,
      borderBottomWidth: 2.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: p.accentPrimary,
      borderColor: p.accentPrimaryStrong,
    },
    checkmark: { color: p.inkOnAccent, fontSize: 14, fontWeight: '800' },
    checkboxLabel: { flex: 1, fontSize: 14, lineHeight: 19, color: p.inkPrimary },
    input: {
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
      color: p.inkPrimary,
      fontSize: 15,
    },
    photo: { width: '100%', height: 180, borderRadius: RADII.md },
    thumb: { width: 72, height: 72, borderRadius: RADII.md },
    silhouette: {
      width: 120,
      height: 90,
      alignSelf: 'center',
    },
    bubble: {
      maxWidth: '88%',
      padding: 11,
      gap: 6,
      borderRadius: RADII.md,
      borderWidth: 1.5,
      borderBottomWidth: 3,
      borderColor: p.borderStrong,
      backgroundColor: p.bgSurface,
    },
    bubbleOwn: {
      alignSelf: 'flex-end',
      backgroundColor: p.positiveBg,
      borderColor: p.positiveBorder,
    },
    bubbleOther: { alignSelf: 'flex-start', backgroundColor: p.bgSurface },
    link: { fontSize: 13, fontWeight: '700', color: p.accentPrimary },
    fill: { flex: 1, backgroundColor: p.bgGround },
    feedContent: {
      padding: 16,
      gap: 16,
      paddingBottom: 96,
      width: '100%',
      maxWidth: 960,
      alignSelf: 'center',
    },
  });
}
