import {
  ApiError,
  AUTH_LIMITS,
  type LoginRequest,
  type RegisterRequest,
} from '@entsiegelung/shared';
import React, { useEffect, useState } from 'react';
import {
  Linking,
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
import type { AuthModalView } from '../state/appState';
import {
  MIN_TOUCH_TARGET_DP,
  type AuthModalModel,
} from '../state/viewModels';
import { PALETTE, RADII } from '../theme/tokens';

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthAndAccountModalProps {
  modal: AuthModalModel;
  privacyPolicyUrl?: string;
  locale?: Locale;
  compact?: boolean;
  onSelectView: (view: AuthModalView) => void;
  onClose: () => void;
  onRegister: (input: RegisterRequest) => Promise<void>;
  onResendVerification: (email: string) => Promise<void>;
  onLogin: (input: LoginRequest) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}

export function AuthAndAccountModal({
  modal,
  privacyPolicyUrl,
  locale = DEFAULT_LOCALE,
  compact = false,
  onSelectView,
  onClose,
  onRegister,
  onResendVerification,
  onLogin,
  onForgotPassword,
  onLogout,
  onDeleteAccount,
}: AuthAndAccountModalProps): React.JSX.Element | null {
  const [identifier, setIdentifier] = useState<string>('');
  const [pseudonym, setPseudonym] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [privacyConsent, setPrivacyConsent] = useState<boolean>(false);
  const [confirmingAccountDelete, setConfirmingAccountDelete] =
    useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [unverifiedIdentifier, setUnverifiedIdentifier] = useState<
    string | null
  >(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);

  useEffect(() => {
    setLocalError(null);
    setInfoBanner(null);
    setUnverifiedIdentifier(null);
    setConfirmingAccountDelete(false);
    if (!modal.visible) {
      setPassword('');
    }
  }, [modal.visible, modal.view, locale]);

  useEffect(() => {
    if (
      modal.view === 'login' &&
      identifier.trim().length === 0 &&
      modal.pendingVerificationPseudonym
    ) {
      setIdentifier(modal.pendingVerificationPseudonym);
    }
  }, [identifier, modal.pendingVerificationPseudonym, modal.view]);

  if (!modal.visible) {
    return null;
  }

  const t = getTranslations(locale).auth;
  const displayedError = localError ?? modal.errorMessage;

  const handleOpenPrivacyPolicy = (): void => {
    if (privacyPolicyUrl) {
      void Linking.openURL(privacyPolicyUrl);
    }
  };

  const handleRegisterSubmit = (): void => {
    setLocalError(null);
    setInfoBanner(null);
    const trimmedPseudonym = pseudonym.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!AUTH_LIMITS.PSEUDONYM_REGEX.test(trimmedPseudonym)) {
      setLocalError(t.invalidPseudonym);
      return;
    }
    if (!SIMPLE_EMAIL_RE.test(trimmedEmail)) {
      setLocalError(t.invalidEmail);
      return;
    }
    if (password.length < AUTH_LIMITS.MIN_PASSWORD_LENGTH) {
      setLocalError(t.shortPassword(AUTH_LIMITS.MIN_PASSWORD_LENGTH));
      return;
    }
    if (!privacyConsent) {
      setLocalError(t.privacyConsentRequired);
      return;
    }

    setIsSubmitting(true);
    void onRegister({
      pseudonym: trimmedPseudonym,
      email: trimmedEmail,
      password,
      acceptedPrivacyPolicy: true,
    })
      .then(() => {
        setIdentifier(trimmedPseudonym);
      })
      .catch((err: unknown) => {
        setLocalError(localizeError(err, t.registerFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleResendVerificationPress = (targetEmail: string): void => {
    const cleaned = targetEmail.trim().toLowerCase();
    if (!SIMPLE_EMAIL_RE.test(cleaned)) {
      setLocalError(t.invalidEmail);
      return;
    }
    setLocalError(null);
    setInfoBanner(null);
    setIsSubmitting(true);

    void onResendVerification(cleaned)
      .then(() => {
        setInfoBanner(t.resendVerificationSent);
        setUnverifiedIdentifier(null);
      })
      .catch((err: unknown) => {
        setLocalError(localizeError(err, t.registerFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleLoginSubmit = (): void => {
    setLocalError(null);
    setInfoBanner(null);
    setUnverifiedIdentifier(null);
    const trimmedIdentifier = identifier.trim();
    if (trimmedIdentifier.length === 0 || password.length === 0) {
      setLocalError(t.missingCredentials);
      return;
    }

    setIsSubmitting(true);
    void onLogin({
      identifier: trimmedIdentifier,
      password,
    })
      .then(() => {
        setPassword('');
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'AUTH_EMAIL_UNVERIFIED') {
          const fallbackEmail =
            modal.pendingVerificationEmail ?? email.trim().toLowerCase();
          if (SIMPLE_EMAIL_RE.test(trimmedIdentifier)) {
            setUnverifiedIdentifier(trimmedIdentifier.toLowerCase());
          } else if (SIMPLE_EMAIL_RE.test(fallbackEmail)) {
            setUnverifiedIdentifier(fallbackEmail);
          }
        }
        setLocalError(localizeError(err, t.loginFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleForgotPasswordSubmit = (): void => {
    setLocalError(null);
    setInfoBanner(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!SIMPLE_EMAIL_RE.test(trimmedEmail)) {
      setLocalError(t.invalidEmail);
      return;
    }

    setIsSubmitting(true);
    void onForgotPassword(trimmedEmail)
      .then(() => {
        setInfoBanner(t.resetLinkSentBanner(trimmedEmail));
      })
      .catch((err: unknown) => {
        setLocalError(localizeError(err, t.recoverFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleLogoutPress = (): void => {
    setLocalError(null);
    setIsSubmitting(true);
    void onLogout()
      .catch((err: unknown) => {
        setLocalError(localizeError(err, t.logoutFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleDeleteAccountConfirm = (): void => {
    setLocalError(null);
    setIsSubmitting(true);
    void onDeleteAccount()
      .catch((err: unknown) => {
        setLocalError(localizeError(err, t.deleteAccountFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const pendingEmailDisplay =
    modal.pendingVerificationEmail ?? email.trim().toLowerCase();

  return (
    <View
      style={[styles.modalCard, compact ? styles.modalCardCompact : null]}
      accessibilityLabel={t.modalA11y}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleCol}>
          <View style={styles.titleWithRoleRow}>
            <Text style={styles.modalTitle}>
              {modal.view === 'verify_pending'
                ? t.titleVerifyPending
                : modal.view === 'account'
                  ? `@${modal.currentUser?.pseudonym ?? ''}`
                  : modal.view === 'register'
                    ? t.titleRegister
                    : modal.view === 'recover'
                      ? t.titleRecover
                      : t.titleLogin}
            </Text>
            {modal.view === 'account' && modal.currentUser?.role === 'admin' ? (
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeLabel}>{t.adminRoleBadge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.zeroPiiSubtitle}>{t.privacySubtitle}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.closeA11y}
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeButtonLabel}>{t.close}</Text>
        </Pressable>
      </View>

      {modal.hasPendingIntent && modal.pendingIntentSummary ? (
        <View style={styles.intentBanner}>
          <Text style={styles.intentBannerText}>
            {modal.pendingIntentSummary}
          </Text>
        </View>
      ) : null}

      {infoBanner ? (
        <View style={styles.successBox} accessibilityRole="alert">
          <Text style={styles.successText}>{infoBanner}</Text>
        </View>
      ) : null}

      {displayedError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{displayedError}</Text>
          {unverifiedIdentifier ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() =>
                handleResendVerificationPress(unverifiedIdentifier)
              }
              style={styles.inlineResendButton}
            >
              <Text style={styles.inlineResendButtonLabel}>
                {isSubmitting
                  ? t.resendingVerification
                  : t.resendVerificationButton}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {modal.view !== 'verify_pending' && modal.view !== 'account' ? (
        <View style={styles.tabWell} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={t.tabSignInA11y}
            accessibilityState={{ selected: modal.view === 'login' }}
            onPress={() => onSelectView('login')}
            style={[
              styles.tabButton,
              modal.view === 'login' ? styles.tabButtonActive : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.tabButtonLabel,
                compact ? styles.tabButtonLabelCompact : null,
                modal.view === 'login' ? styles.tabButtonLabelActive : null,
              ]}
            >
              {t.tabSignIn}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={t.tabRegisterA11y}
            accessibilityState={{ selected: modal.view === 'register' }}
            onPress={() => onSelectView('register')}
            style={[
              styles.tabButton,
              modal.view === 'register' ? styles.tabButtonActive : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.tabButtonLabel,
                compact ? styles.tabButtonLabelCompact : null,
                modal.view === 'register' ? styles.tabButtonLabelActive : null,
              ]}
            >
              {t.tabRegister}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={t.tabRecoverA11y}
            accessibilityState={{ selected: modal.view === 'recover' }}
            onPress={() => onSelectView('recover')}
            style={[
              styles.tabButton,
              modal.view === 'recover' ? styles.tabButtonActive : null,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.tabButtonLabel,
                compact ? styles.tabButtonLabelCompact : null,
                modal.view === 'recover' ? styles.tabButtonLabelActive : null,
              ]}
            >
              {t.tabRecover}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'verify_pending' ? (
        <View style={styles.formSection}>
          <View style={styles.verifyInfoCard}>
            <Text style={styles.verifyInfoText}>
              {t.verifyPendingBody(pendingEmailDisplay || '-')}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || !pendingEmailDisplay}
            onPress={() => handleResendVerificationPress(pendingEmailDisplay)}
            style={[styles.touchButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {isSubmitting
                ? t.resendingVerification
                : t.resendVerificationButton}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => onSelectView('login')}
            style={[styles.touchButton, styles.primaryButton]}
          >
            <Text style={styles.primaryButtonLabel}>{t.backToSignIn}</Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'register' ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>{t.registerHint}</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.publicPseudonymLabel}</Text>
            <TextInput
              accessibilityLabel={t.pseudonymA11y}
              value={pseudonym}
              onChangeText={setPseudonym}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              textContentType="username"
              placeholder={t.pseudonymPlaceholderRegister}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.emailLabel}</Text>
            <TextInput
              accessibilityLabel={t.emailA11y}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              placeholder={t.emailPlaceholder}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.passwordLabel}</Text>
            <TextInput
              accessibilityLabel={t.passwordA11y}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder={t.passwordPlaceholderMin}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.checkboxRow}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={t.privacyConsentA11y}
              accessibilityState={{ checked: privacyConsent }}
              onPress={() => setPrivacyConsent((prev) => !prev)}
              style={styles.checkboxHitArea}
            >
              <View
                style={[
                  styles.checkboxIndicator,
                  privacyConsent ? styles.checkboxIndicatorChecked : null,
                ]}
              >
                <Text style={styles.checkboxMark}>
                  {privacyConsent ? '✓' : ''}
                </Text>
              </View>
            </Pressable>

            <Text style={styles.checkboxLabel}>
              {t.privacyConsentPrefix}
              <Text
                accessibilityRole="link"
                onPress={handleOpenPrivacyPolicy}
                style={styles.privacyLinkText}
              >
                {t.privacyPolicyLinkText}
              </Text>
              .
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.createAccountA11y}
            disabled={isSubmitting}
            onPress={handleRegisterSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? t.creatingAccount : t.createAccount}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'login' ? (
        <View style={styles.formSection}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.identifierLabel}</Text>
            <TextInput
              accessibilityLabel={t.identifierA11y}
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder={t.identifierPlaceholder}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <View style={styles.passwordLabelRow}>
              <Text style={styles.fieldLabel}>{t.passwordLabel}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelectView('recover')}
              >
                <Text style={styles.forgotPasswordLink}>
                  {t.forgotPasswordLink}
                </Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={t.passwordA11y}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              placeholder={t.passwordPlaceholderLogin}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.signInButtonA11y}
            disabled={isSubmitting}
            onPress={handleLoginSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? t.signingIn : t.signInButton}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'recover' ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>{t.forgotPasswordHint}</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.emailLabel}</Text>
            <TextInput
              accessibilityLabel={t.emailA11y}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              placeholder={t.emailPlaceholder}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.resetPasswordA11y}
            disabled={isSubmitting}
            onPress={handleForgotPasswordSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? t.sendingResetLink : t.sendResetLinkButton}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'account' && modal.currentUser ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            {t.accountSignedInHint(modal.currentUser.pseudonym)}
          </Text>

          {modal.currentUser.email ? (
            <View style={styles.accountEmailBox}>
              <Text style={styles.accountEmailLabel}>
                {t.accountEmailLabel}
              </Text>
              <Text style={styles.accountEmailValue}>
                {modal.currentUser.email}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.logoutA11y}
            disabled={isSubmitting}
            onPress={handleLogoutPress}
            style={[styles.touchButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {isSubmitting ? t.loggingOut : t.logout}
            </Text>
          </Pressable>

          {confirmingAccountDelete ? (
            <View style={styles.deleteWarningBox} accessibilityRole="alert">
              <Text style={styles.deleteWarningText}>
                {t.deleteAccountWarning}
              </Text>

              <View style={styles.confirmRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.cancelDeleteAccountA11y}
                  disabled={isSubmitting}
                  onPress={() => setConfirmingAccountDelete(false)}
                  style={[styles.touchButton, styles.secondaryButton]}
                >
                  <Text style={styles.secondaryButtonLabel}>{t.cancel}</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.confirmDeleteAccountA11y}
                  disabled={isSubmitting}
                  onPress={handleDeleteAccountConfirm}
                  style={[styles.touchButton, styles.dangerButton]}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {isSubmitting ? t.deletingAccount : t.confirmDeleteAccount}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.deleteAccountA11y}
              disabled={isSubmitting}
              onPress={() => setConfirmingAccountDelete(true)}
              style={[styles.touchButton, styles.dangerOutlineButton]}
            >
              <Text style={styles.dangerOutlineLabel}>{t.deleteAccount}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  modalCard: {
    padding: 18,
    borderRadius: RADII.lg,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 12,
  },
  modalCardCompact: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  titleWithRoleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.25,
    color: PALETTE.inkPrimary,
    flexShrink: 1,
  },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.finishedBg,
    borderWidth: 1,
    borderColor: PALETTE.finishedBorder,
  },
  adminBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.finishedText,
  },
  zeroPiiSubtitle: {
    fontSize: 11.5,
    color: PALETTE.inkMuted,
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  intentBanner: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.infoBg,
    borderWidth: 1,
    borderColor: PALETTE.infoBorder,
  },
  intentBannerText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.infoText,
  },
  successBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.positiveBg,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
  },
  successText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.positiveText,
  },
  errorBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
    gap: 8,
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PALETTE.dangerText,
  },
  inlineResendButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  inlineResendButtonLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.dangerText,
  },
  tabWell: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgRecessed,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 4,
  },
  tabButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  tabButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: PALETTE.inkSecondary,
  },
  tabButtonLabelCompact: {
    fontSize: 12,
  },
  tabButtonLabelActive: {
    color: PALETTE.inkPrimary,
    fontWeight: '700',
  },
  formSection: {
    gap: 10,
  },
  verifyInfoCard: {
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.positiveBg,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
  },
  verifyInfoText: {
    fontSize: 13,
    lineHeight: 19,
    color: PALETTE.positiveText,
    fontWeight: '600',
  },
  privacyHint: {
    fontSize: 12.5,
    lineHeight: 18,
    color: PALETTE.inkSecondary,
  },
  fieldGroup: {
    gap: 4,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  forgotPasswordLink: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.accentPrimary,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  inputField: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    fontSize: 14,
    color: PALETTE.inkPrimary,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  checkboxHitArea: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxIndicator: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxIndicatorChecked: {
    backgroundColor: PALETTE.accentPrimary,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  checkboxMark: {
    color: PALETTE.inkOnAccent,
    fontSize: 13,
    fontWeight: '800',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: PALETTE.inkSecondary,
  },
  privacyLinkText: {
    color: PALETTE.accentPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  accountEmailBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    gap: 2,
  },
  accountEmailLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: PALETTE.inkMuted,
  },
  accountEmailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
  },
  primaryButtonDisabled: {
    backgroundColor: PALETTE.accentDisabled,
  },
  primaryButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  secondaryButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
  },
  secondaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  deleteWarningBox: {
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
    gap: 10,
  },
  deleteWarningText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: PALETTE.dangerText,
  },
  confirmRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dangerButton: {
    backgroundColor: PALETTE.dangerSolid,
  },
  dangerOutlineButton: {
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  dangerOutlineLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: PALETTE.dangerText,
  },
});
