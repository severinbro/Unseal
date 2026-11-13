import {
  AUTH_LIMITS,
  type LoginRequest,
  type RecoverRequest,
  type RegisterRequest,
} from '@entsiegelung/shared';
import React, { useEffect, useState } from 'react';
import {
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
import {
  formatRecoveryCodeBlocks,
  MONO_FONT_FAMILY,
  PALETTE,
  RADII,
  TABULAR_NUMS_STYLE,
} from '../theme/tokens';

interface ClipboardNavigatorLike {
  clipboard?: {
    writeText?(text: string): Promise<void>;
  };
}

export interface AuthAndAccountModalProps {
  modal: AuthModalModel;
  locale?: Locale;
  compact?: boolean;
  onSelectView: (view: Exclude<AuthModalView, 'recovery_code'>) => void;
  onToggleRecoveryCodeSaved: (checked: boolean) => void;
  onClose: () => void;
  onRegister: (input: RegisterRequest) => Promise<void>;
  onLogin: (input: LoginRequest) => Promise<void>;
  onRecover: (input: RecoverRequest) => Promise<void>;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}

export function AuthAndAccountModal({
  modal,
  locale = DEFAULT_LOCALE,
  compact = false,
  onSelectView,
  onToggleRecoveryCodeSaved,
  onClose,
  onRegister,
  onLogin,
  onRecover,
  onLogout,
  onDeleteAccount,
}: AuthAndAccountModalProps): React.JSX.Element | null {
  const [pseudonym, setPseudonym] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [recoveryCodeInput, setRecoveryCodeInput] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmingAccountDelete, setConfirmingAccountDelete] =
    useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  useEffect(() => {
    setLocalError(null);
    setConfirmingAccountDelete(false);
    setCopiedCode(false);
    if (!modal.visible) {
      setPassword('');
      setRecoveryCodeInput('');
      setNewPassword('');
    }
  }, [modal.visible, modal.view, locale]);

  if (!modal.visible) {
    return null;
  }

  const t = getTranslations(locale).auth;
  const displayedError = localError ?? modal.errorMessage;
  const formattedRecoveryCode = modal.recoveryCode
    ? formatRecoveryCodeBlocks(modal.recoveryCode)
    : '';

  const handleCopyRecoveryCode = (): void => {
    if (!modal.recoveryCode) {
      return;
    }
    const nav = (globalThis as { navigator?: ClipboardNavigatorLike })
      .navigator;
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      void nav.clipboard
        .writeText(formattedRecoveryCode)
        .then(() => {
          setCopiedCode(true);
        })
        .catch(() => {
          setLocalError(t.clipboardBlocked);
        });
    }
  };

  const handleRegisterSubmit = (): void => {
    setLocalError(null);
    const trimmedPseudonym = pseudonym.trim();
    if (!AUTH_LIMITS.PSEUDONYM_REGEX.test(trimmedPseudonym)) {
      setLocalError(t.invalidPseudonym);
      return;
    }
    if (password.length < AUTH_LIMITS.MIN_PASSWORD_LENGTH) {
      setLocalError(t.shortPassword(AUTH_LIMITS.MIN_PASSWORD_LENGTH));
      return;
    }

    setIsSubmitting(true);
    void onRegister({
      pseudonym: trimmedPseudonym,
      password,
    })
      .then(() => {
        setPassword('');
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
    const trimmedPseudonym = pseudonym.trim();
    if (trimmedPseudonym.length === 0 || password.length === 0) {
      setLocalError(t.missingCredentials);
      return;
    }

    setIsSubmitting(true);
    void onLogin({
      pseudonym: trimmedPseudonym,
      password,
    })
      .then(() => {
        setPassword('');
      })
      .catch((err: unknown) => {
        setLocalError(localizeError(err, t.loginFailed, locale));
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleRecoverSubmit = (): void => {
    setLocalError(null);
    const trimmedPseudonym = pseudonym.trim();
    const trimmedCode = recoveryCodeInput.trim();
    if (
      trimmedPseudonym.length === 0 ||
      trimmedCode.length === 0 ||
      newPassword.length < AUTH_LIMITS.MIN_PASSWORD_LENGTH
    ) {
      setLocalError(t.missingRecoveryFields(AUTH_LIMITS.MIN_PASSWORD_LENGTH));
      return;
    }

    setIsSubmitting(true);
    void onRecover({
      pseudonym: trimmedPseudonym,
      recoveryCode: trimmedCode,
      newPassword,
    })
      .then(() => {
        setRecoveryCodeInput('');
        setNewPassword('');
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

  const hasClipboardApi = Boolean(
    (globalThis as { navigator?: ClipboardNavigatorLike }).navigator?.clipboard
      ?.writeText,
  );

  return (
    <View
      style={[styles.modalCard, compact ? styles.modalCardCompact : null]}
      accessibilityLabel={t.modalA11y}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleCol}>
          <Text style={styles.modalTitle}>
            {modal.view === 'recovery_code'
              ? t.titleRecovery
              : modal.view === 'account'
                ? `@${modal.currentUser?.pseudonym ?? ''}`
                : modal.view === 'register'
                  ? t.titleRegister
                  : modal.view === 'recover'
                    ? t.titleRecover
                    : t.titleLogin}
          </Text>
          <Text style={styles.zeroPiiSubtitle}>{t.zeroPiiSubtitle}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.closeA11y}
          accessibilityState={{ disabled: !modal.canClose }}
          disabled={!modal.canClose}
          onPress={onClose}
          style={[
            styles.closeButton,
            !modal.canClose ? styles.disabledButton : null,
          ]}
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

      {displayedError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{displayedError}</Text>
        </View>
      ) : null}

      {modal.view !== 'recovery_code' && modal.view !== 'account' ? (
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

      {modal.view === 'recovery_code' && modal.recoveryCode ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>{t.recoveryVaultHint}</Text>

          <View style={styles.recoveryCodeVault}>
            <Text selectable style={styles.recoveryCodeValue}>
              {formattedRecoveryCode}
            </Text>
            {hasClipboardApi ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.copyCodeA11y}
                onPress={handleCopyRecoveryCode}
                style={styles.copyCodeButton}
              >
                <Text style={styles.copyCodeButtonLabel}>
                  {copiedCode ? t.copiedCode : t.copyCode}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={t.savedCheckboxA11y}
            accessibilityState={{ checked: modal.recoveryCodeSavedChecked }}
            onPress={() =>
              onToggleRecoveryCodeSaved(!modal.recoveryCodeSavedChecked)
            }
            style={styles.checkboxRow}
          >
            <View
              style={[
                styles.checkboxIndicator,
                modal.recoveryCodeSavedChecked
                  ? styles.checkboxIndicatorChecked
                  : null,
              ]}
            >
              <Text style={styles.checkboxMark}>
                {modal.recoveryCodeSavedChecked ? '✓' : ''}
              </Text>
            </View>
            <Text style={styles.checkboxLabel}>{t.savedCheckboxLabel}</Text>
          </Pressable>

          {!modal.canClose && modal.closeBlockedReason ? (
            <Text style={styles.blockedReasonText}>
              {modal.closeBlockedReason}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.continueA11y}
            accessibilityState={{ disabled: !modal.canClose }}
            disabled={!modal.canClose}
            onPress={onClose}
            style={[
              styles.touchButton,
              styles.primaryButton,
              !modal.canClose ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>{t.continueToMap}</Text>
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
            <Text style={styles.fieldLabel}>{t.pseudonymLabel}</Text>
            <TextInput
              accessibilityLabel={t.pseudonymA11y}
              value={pseudonym}
              onChangeText={setPseudonym}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder={t.pseudonymPlaceholderLogin}
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
          <Text style={styles.privacyHint}>{t.recoverHint}</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.pseudonymLabel}</Text>
            <TextInput
              accessibilityLabel={t.pseudonymA11y}
              value={pseudonym}
              onChangeText={setPseudonym}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder={t.pseudonymPlaceholderLogin}
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.recoveryCodeLabel}</Text>
            <TextInput
              accessibilityLabel={t.recoveryCodeA11y}
              value={recoveryCodeInput}
              onChangeText={setRecoveryCodeInput}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              textContentType="oneTimeCode"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              placeholderTextColor={PALETTE.inkMuted}
              style={[styles.inputField, styles.monoInputField]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t.newPasswordLabel}</Text>
            <TextInput
              accessibilityLabel={t.newPasswordA11y}
              value={newPassword}
              onChangeText={setNewPassword}
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

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.resetPasswordA11y}
            disabled={isSubmitting}
            onPress={handleRecoverSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? t.resettingPassword : t.resetPassword}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'account' && modal.currentUser ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            {t.accountSignedInHint(modal.currentUser.pseudonym)}
          </Text>

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
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.25,
    color: PALETTE.inkPrimary,
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
  disabledButton: {
    opacity: 0.42,
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
  errorBox: {
    padding: 10,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.dangerBg,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: '600',
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
  privacyHint: {
    fontSize: 12.5,
    lineHeight: 18,
    color: PALETTE.inkSecondary,
  },
  fieldGroup: {
    gap: 4,
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
  monoInputField: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 13,
  },
  recoveryCodeVault: {
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.bgSubtle,
    borderWidth: 1,
    borderColor: PALETTE.positiveBorder,
    gap: 10,
    alignItems: 'center',
  },
  recoveryCodeValue: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
    lineHeight: 21,
    textAlign: 'center',
    color: PALETTE.positiveText,
  },
  copyCodeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    alignSelf: 'stretch',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyCodeButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  checkboxRow: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  checkboxIndicator: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: PALETTE.accentPrimary,
    backgroundColor: PALETTE.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxIndicatorChecked: {
    backgroundColor: PALETTE.accentPrimary,
  },
  checkboxMark: {
    color: PALETTE.inkOnAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  blockedReasonText: {
    fontSize: 12,
    color: PALETTE.neutralText,
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PALETTE.accentPrimary,
    borderWidth: 1,
    borderColor: PALETTE.accentPrimaryStrong,
  },
  primaryButtonDisabled: {
    backgroundColor: PALETTE.accentDisabled,
    borderColor: PALETTE.accentDisabled,
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
  dangerOutlineButton: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.dangerBorder,
  },
  dangerOutlineLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: PALETTE.dangerText,
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
});
