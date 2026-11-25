// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import {
  POLYGON_STATUSES,
  SPACE_FILTERS,
  SPACE_TYPES,
  type ClassifySpaceResponse,
  type PolygonFeature,
  type PolygonStatus,
  type SpaceFilter,
  type SpaceZoneAttribution,
  type SpaceType,
  type StoredSpaceType,
} from '@openunseal/shared';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { getSocialCopy, type SocialCopy } from '../i18n/social';
import { localizeError, type Locale } from '../i18n/translations';
import type { DraftSpace } from '../state/appState';
import { formatInspectorDate } from '../state/viewModels';
import { SocialButton, SocialCheckbox, useSocialStyles } from './SocialUi';

/** Credit line for land-use data on screen (ODbL-1.0 § 4.3). */
export function formatZoneCredits(
  attributions: readonly SpaceZoneAttribution[],
): string {
  return attributions.map((entry) => `${entry.text} (${entry.license})`).join('; ');
}

export function groundLabel(type: StoredSpaceType, t: SocialCopy): string {
  return type === 'public'
    ? t.groundPublic
    : type === 'private'
      ? t.groundPrivate
      : t.groundUnknown;
}

export function SpaceFilterRow(props: {
  locale: Locale;
  value: SpaceFilter;
  onChange: (value: SpaceFilter) => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  return (
    <View style={styles.row} accessibilityLabel={t.groundFilter}>
      {SPACE_FILTERS.map((value) => (
        <SocialButton
          key={value}
          testID={`space-filter-${value}`}
          label={value === 'all' ? t.groundAll : groundLabel(value, t)}
          selected={props.value === value}
          onPress={() => props.onChange(value)}
        />
      ))}
    </View>
  );
}

export type ClassifyState =
  | { status: 'idle' | 'loading' | 'failed' }
  | { status: 'done'; result: ClassifySpaceResponse };

/** Step 2: ground type plus, for private ground, the owner's optional statements. */
export function DraftSpaceSection(props: {
  locale: Locale;
  value: DraftSpace;
  classification: ClassifyState;
  onChange: (patch: Partial<DraftSpace>) => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  const { value, classification } = props;
  const ownerFlags =
    value.openForPublicAccess || value.allowChatContact || value.helpWanted;
  const summary =
    classification.status === 'loading'
      ? t.checking
      : classification.status === 'failed'
        ? t.checkFailed
        : classification.status === 'done'
          ? classification.result.detectedSpaceType === 'unknown'
            ? t.checkUnknown
            : t.checkResult(
                groundLabel(classification.result.detectedSpaceType, t),
                classification.result.privateOverlapRatio,
              )
          : null;
  return (
    <View style={styles.section} testID="draft-space-section">
      <Text style={styles.subtitle}>{t.groundTitle}</Text>
      <View style={styles.row}>
        {SPACE_TYPES.map((type) => (
          <SocialButton
            key={type}
            testID={`draft-space-${type}`}
            label={groundLabel(type, t)}
            selected={value.spaceType === type}
            onPress={() => props.onChange({ spaceType: type })}
          />
        ))}
      </View>
      {summary ? <Text style={styles.hint}>{summary}</Text> : null}
      {classification.status === 'done' && classification.result.overlay ? (
        // The credit sits next to the result: the map may be partly covered here.
        <Text style={styles.hint} testID="draft-overlay-credit">
          {t.overlayHint}{' '}
          {t.zonesCredit(formatZoneCredits(classification.result.overlay.attributions))}
        </Text>
      ) : null}
      <Text style={styles.hint}>{t.groundImmutable}</Text>
      {value.spaceType === 'private' ? (
        <>
          <Text style={styles.hint}>{t.privateHint}</Text>
          <OwnerStatements
            t={t}
            openForPublicAccess={value.openForPublicAccess}
            allowChatContact={value.allowChatContact}
            helpWanted={value.helpWanted}
            onToggleOpen={() =>
              props.onChange({ openForPublicAccess: !value.openForPublicAccess })
            }
            onToggleContact={() =>
              props.onChange({ allowChatContact: !value.allowChatContact })
            }
            onToggleHelp={() => props.onChange({ helpWanted: !value.helpWanted })}
          />
          {ownerFlags ? (
            <SocialCheckbox
              testID="draft-entitlement"
              label={t.entitlement}
              checked={value.entitlementConfirmed}
              onToggle={() =>
                props.onChange({
                  entitlementConfirmed: !value.entitlementConfirmed,
                })
              }
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function OwnerStatements(props: {
  t: SocialCopy;
  openForPublicAccess: boolean;
  allowChatContact: boolean;
  helpWanted: boolean;
  onToggleOpen: () => void;
  onToggleContact: () => void;
  onToggleHelp: () => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  return (
    <>
      <SocialCheckbox
        label={props.t.openAccess}
        checked={props.openForPublicAccess}
        onToggle={props.onToggleOpen}
      />
      <SocialCheckbox
        label={props.t.allowContact}
        checked={props.allowChatContact}
        onToggle={props.onToggleContact}
      />
      <SocialCheckbox
        testID="owner-help-wanted"
        label={props.t.helpWanted}
        checked={props.helpWanted}
        onToggle={props.onToggleHelp}
      />
      {props.helpWanted && !props.allowChatContact ? (
        <Text style={styles.hint}>{props.t.helpContactHint}</Text>
      ) : null}
    </>
  );
}

export function SpaceBadges(props: {
  locale: Locale;
  feature: PolygonFeature;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  const p = props.feature.properties;
  const verification =
    p.spaceVerification === 'gis_verified'
      ? t.verified
      : p.spaceVerification === 'user_override'
        ? t.override
        : p.spaceVerification === 'admin_override'
          ? t.adminSet
          : null;
  return (
    <View style={styles.row}>
      <Text style={styles.badge}>{groundLabel(p.spaceType, t)}</Text>
      {verification ? <Text style={styles.badge}>{verification}</Text> : null}
      {p.openForPublicAccess ? (
        <Text style={styles.badge}>{t.openAccessBadge}</Text>
      ) : null}
      {p.helpWanted ? (
        <Text style={styles.badge} testID="badge-help-wanted">
          {t.helpWantedBadge}
        </Text>
      ) : null}
    </View>
  );
}

/** Inspector card: badges, contact, and controls for private authors and admins. */
export function PolygonSpaceCard(props: {
  locale: Locale;
  feature: PolygonFeature;
  isAdmin: boolean;
  isAuthenticated: boolean;
  onStatus: (
    id: string,
    status: PolygonStatus,
    entitlementConfirmed: boolean,
  ) => Promise<void>;
  onSaveFlags: (
    id: string,
    patch: {
      openForPublicAccess: boolean;
      allowChatContact: boolean;
      helpWanted?: boolean;
      entitlementConfirmed?: boolean;
    },
  ) => Promise<void>;
  onSetSpaceType: (id: string, type: SpaceType) => Promise<void>;
  onMessageAuthor: (feature: PolygonFeature) => void;
  onShareInChat: (feature: PolygonFeature) => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  const { feature, locale } = props;
  const p = feature.properties;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(p.openForPublicAccess);
  const [contact, setContact] = useState(p.allowChatContact === true);
  const [help, setHelp] = useState(p.helpWanted);
  const [entitled, setEntitled] = useState(false);
  const [statusEntitled, setStatusEntitled] = useState(false);

  useEffect(() => {
    setOpen(p.openForPublicAccess);
    setContact(p.allowChatContact === true);
    setHelp(p.helpWanted);
    setEntitled(false);
    setStatusEntitled(false);
    setError(null);
  }, [feature.id, p.openForPublicAccess, p.allowChatContact, p.helpWanted]);

  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    void action()
      .catch((err: unknown) => setError(localizeError(err, t.failed, locale)))
      .finally(() => setBusy(false));
  };

  const ownPrivate = p.isAuthor && p.spaceType === 'private';
  const changed =
    open !== p.openForPublicAccess ||
    contact !== (p.allowChatContact === true) ||
    help !== p.helpWanted;
  const enables =
    (open && !p.openForPublicAccess) ||
    (contact && p.allowChatContact !== true) ||
    (help && !p.helpWanted);
  // Reporting progress needs the confirmation once per area.
  const statusNeedsConfirmation = p.entitlementConfirmed !== true;

  return (
    <View style={styles.card} testID="polygon-space-card">
      <SpaceBadges locale={locale} feature={feature} />
      {p.privateOverlapRatio !== null && p.detectedSpaceType !== null ? (
        <Text style={styles.hint}>
          {t.checkResult(groundLabel(p.detectedSpaceType, t), p.privateOverlapRatio)}
        </Text>
      ) : null}
      {p.canMessageAuthor || props.isAuthenticated ? (
        <View style={styles.row}>
          {p.canMessageAuthor ? (
            <SocialButton
              testID="message-author"
              label={t.startForArea}
              onPress={() => props.onMessageAuthor(feature)}
            />
          ) : null}
          {props.isAuthenticated ? (
            <SocialButton
              testID="share-in-chat"
              label={t.shareArea}
              onPress={() => props.onShareInChat(feature)}
            />
          ) : null}
        </View>
      ) : null}
      {ownPrivate ? (
        <View style={styles.section}>
          {!props.isAdmin ? (
            <>
              <Text style={styles.subtitle}>{t.ownStatus}</Text>
              <View style={styles.row}>
                {POLYGON_STATUSES.map((status) => (
                  <SocialButton
                    key={status}
                    testID={`own-status-${status}`}
                    label={t.status[status]}
                    selected={p.status === status}
                    disabled={
                      busy ||
                      (status !== 'proposed' &&
                        statusNeedsConfirmation &&
                        !statusEntitled)
                    }
                    onPress={() =>
                      run(() =>
                        props.onStatus(
                          feature.id,
                          status,
                          statusNeedsConfirmation && statusEntitled,
                        ),
                      )
                    }
                  />
                ))}
              </View>
              {statusNeedsConfirmation ? (
                <SocialCheckbox
                  testID="status-entitlement"
                  label={t.entitlement}
                  checked={statusEntitled}
                  onToggle={() => setStatusEntitled((v) => !v)}
                />
              ) : null}
              <Text style={styles.hint}>{t.photoNeeded}</Text>
            </>
          ) : null}
          <OwnerStatements
            t={t}
            openForPublicAccess={open}
            allowChatContact={contact}
            helpWanted={help}
            onToggleOpen={() => setOpen((v) => !v)}
            onToggleContact={() => setContact((v) => !v)}
            onToggleHelp={() => setHelp((v) => !v)}
          />
          {p.helpWanted && p.helpWantedUntil ? (
            <View style={styles.spread}>
              <Text style={[styles.hint, styles.grow]}>
                {t.helpWantedUntil(formatInspectorDate(p.helpWantedUntil, locale) ?? '')}
              </Text>
              <SocialButton
                label={t.helpRenew}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    props.onSaveFlags(feature.id, {
                      openForPublicAccess: p.openForPublicAccess,
                      allowChatContact: p.allowChatContact === true,
                      helpWanted: true,
                    }),
                  )
                }
              />
            </View>
          ) : null}
          {enables ? (
            <SocialCheckbox
              label={t.entitlement}
              checked={entitled}
              onToggle={() => setEntitled((v) => !v)}
            />
          ) : null}
          {changed ? (
            <SocialButton
              label={t.save}
              primary
              disabled={busy || (enables && !entitled)}
              onPress={() =>
                run(() =>
                  props.onSaveFlags(feature.id, {
                    openForPublicAccess: open,
                    allowChatContact: contact,
                    ...(help !== p.helpWanted ? { helpWanted: help } : {}),
                    ...(enables ? { entitlementConfirmed: entitled } : {}),
                  }),
                )
              }
            />
          ) : null}
        </View>
      ) : null}
      {props.isAdmin ? (
        <View style={styles.section}>
          <Text style={styles.subtitle}>{t.adminGround}</Text>
          <View style={styles.row}>
            {SPACE_TYPES.map((type) => (
              <SocialButton
                key={type}
                label={groundLabel(type, t)}
                selected={p.spaceType === type}
                disabled={busy}
                onPress={() => run(() => props.onSetSpaceType(feature.id, type))}
              />
            ))}
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}
