// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET_DP } from '../state/viewModels';
import { useTheme } from '../theme/themeContext';
import { RADII, type ThemePalette } from '../theme/tokens';

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
      style={[
        styles.button,
        active ? styles.buttonActive : null,
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
      borderWidth: 1,
      borderColor: p.borderSubtle,
    },
    section: { gap: 8 },
    grow: { flex: 1 },
    divider: {
      alignSelf: 'stretch',
      textAlign: 'center',
      fontSize: 12,
      fontWeight: '700',
      color: p.accentPrimary,
      borderTopWidth: 1,
      borderColor: p.accentPrimary,
      paddingTop: 4,
    },
    notice: {
      padding: 10,
      borderRadius: RADII.md,
      backgroundColor: p.bgTinted,
      gap: 8,
    },
    tabBar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: p.bgSurface,
      borderColor: p.borderSubtle,
    },
    tabBarBottom: { borderTopWidth: 1, justifyContent: 'space-around' },
    tabBarItem: { flex: 1 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    spread: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    title: { fontSize: 16, fontWeight: '700', color: p.inkPrimary },
    subtitle: { fontSize: 14, fontWeight: '600', color: p.inkPrimary },
    body: { fontSize: 14, lineHeight: 20, color: p.inkPrimary },
    hint: { fontSize: 12, lineHeight: 17, color: p.inkMuted },
    error: { fontSize: 13, lineHeight: 18, color: p.dangerText },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      fontSize: 12,
      color: p.inkPrimary,
    },
    button: {
      minHeight: MIN_TOUCH_TARGET_DP,
      paddingHorizontal: 14,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: p.borderSubtle,
      backgroundColor: p.bgSurface,
    },
    buttonActive: { backgroundColor: p.accentPrimary, borderColor: p.accentPrimary },
    buttonDisabled: { opacity: 0.5 },
    buttonLabel: { fontSize: 14, fontWeight: '600', color: p.inkPrimary },
    buttonLabelActive: { color: p.inkOnAccent },
    checkboxRow: {
      minHeight: MIN_TOUCH_TARGET_DP,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: p.inkMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: p.accentPrimary, borderColor: p.accentPrimary },
    checkmark: { color: p.inkOnAccent, fontSize: 14, fontWeight: '700' },
    checkboxLabel: { flex: 1, fontSize: 14, lineHeight: 19, color: p.inkPrimary },
    input: {
      minHeight: MIN_TOUCH_TARGET_DP,
      padding: 10,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: p.borderSubtle,
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
      padding: 10,
      gap: 6,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: p.borderSubtle,
    },
    bubbleOwn: { alignSelf: 'flex-end', backgroundColor: p.bgTinted },
    bubbleOther: { alignSelf: 'flex-start' },
    link: { fontSize: 13, fontWeight: '600', color: p.accentPrimary },
    fill: { flex: 1, backgroundColor: p.bgTinted },
    // A reading column: on wide screens the cards do not stretch edge to edge.
    feedContent: {
      padding: 12,
      gap: 12,
      paddingBottom: 96,
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
    },
  });
}
