// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { AuthUser } from '@openunseal/shared';
import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { getSocialCopy } from '../i18n/social';
import { localizeError, type Locale } from '../i18n/translations';
import { SocialButton, SocialCheckbox, useSocialStyles } from './SocialUi';

export function TermsUpdateModal(props: {
  locale: Locale;
  termsUrl: string;
  privacyUrl: string;
  onAccept: () => Promise<AuthUser>;
  onAccepted: (user: AuthUser) => void;
  onLater: () => void;
}): React.JSX.Element {
  const { styles } = useSocialStyles();
  const t = getSocialCopy(props.locale);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.card} testID="terms-update-modal">
      <Text style={styles.title}>{t.termsTitle}</Text>
      <Text style={styles.body}>{t.termsBody}</Text>
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(props.termsUrl)}
      >
        {t.termsRead}
      </Text>
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(props.privacyUrl)}
      >
        {t.privacyRead}
      </Text>
      <SocialCheckbox
        label={t.termsAccept}
        checked={checked}
        onToggle={() => setChecked((v) => !v)}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <SocialButton
          label={t.termsConfirm}
          primary
          disabled={!checked || busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            props
              .onAccept()
              .then(props.onAccepted)
              .catch((err: unknown) =>
                setError(localizeError(err, t.failed, props.locale)),
              )
              .finally(() => setBusy(false));
          }}
        />
        <SocialButton label={t.termsLater} onPress={props.onLater} />
      </View>
    </View>
  );
}
