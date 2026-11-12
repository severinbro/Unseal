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
  }, [modal.visible, modal.view]);

  if (!modal.visible) {
    return null;
  }

  const displayedError = localError ?? modal.errorMessage;
  const formattedRecoveryCode = modal.recoveryCode
    ? formatRecoveryCodeBlocks(modal.recoveryCode)
    : '';

  const handleCopyRecoveryCode = (): void => {
    if (!modal.recoveryCode) {
      return;
    }
    const nav = (globalThis as { navigator?: ClipboardNavigatorLike }).navigator;
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      void nav.clipboard
        .writeText(formattedRecoveryCode)
        .then(() => {
          setCopiedCode(true);
        })
        .catch(() => {
          setLocalError(
            'Automatic clipboard copy was blocked; select and copy the code manually above.',
          );
        });
    }
  };

  const handleRegisterSubmit = (): void => {
    setLocalError(null);
    const trimmedPseudonym = pseudonym.trim();
    if (!AUTH_LIMITS.PSEUDONYM_REGEX.test(trimmedPseudonym)) {
      setLocalError(
        'Pseudonym must be 3–32 characters using letters, digits, underscores (_), or hyphens (-).',
      );
      return;
    }
    if (password.length < AUTH_LIMITS.MIN_PASSWORD_LENGTH) {
      setLocalError(
        `Password must be at least ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} characters.`,
      );
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
        setLocalError(
          err instanceof Error ? err.message : 'Registration failed.',
        );
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  const handleLoginSubmit = (): void => {
    setLocalError(null);
    const trimmedPseudonym = pseudonym.trim();
    if (trimmedPseudonym.length === 0 || password.length === 0) {
      setLocalError('Enter your pseudonym and password.');
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
        setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
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
      setLocalError(
        `Enter your pseudonym, 32-character recovery code, and a new password (at least ${AUTH_LIMITS.MIN_PASSWORD_LENGTH} characters).`,
      );
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
        setLocalError(
          err instanceof Error ? err.message : 'Password recovery failed.',
        );
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
        setLocalError(err instanceof Error ? err.message : 'Logout failed.');
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
        setLocalError(
          err instanceof Error ? err.message : 'Account deletion failed.',
        );
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
      accessibilityLabel="Pseudonymous account modal"
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleCol}>
          <Text style={styles.modalTitle}>
            {modal.view === 'recovery_code'
              ? 'Save One-Time Recovery Code'
              : modal.view === 'account'
                ? `@${modal.currentUser?.pseudonym ?? ''}`
                : modal.view === 'register'
                  ? 'Create Pseudonym'
                  : modal.view === 'recover'
                    ? 'Recover Password'
                    : 'Contributor Sign In'}
          </Text>
          <Text style={styles.zeroPiiSubtitle}>
            Zero email · Zero phone · Open civic mapping
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close account modal"
          accessibilityState={{ disabled: !modal.canClose }}
          disabled={!modal.canClose}
          onPress={onClose}
          style={[
            styles.closeButton,
            !modal.canClose ? styles.disabledButton : null,
          ]}
        >
          <Text style={styles.closeButtonLabel}>Close</Text>
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
            accessibilityLabel="Sign In tab"
            accessibilityState={{ selected: modal.view === 'login' }}
            onPress={() => onSelectView('login')}
            style={[
              styles.tabButton,
              modal.view === 'login' ? styles.tabButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.tabButtonLabel,
                modal.view === 'login' ? styles.tabButtonLabelActive : null,
              ]}
            >
              Sign In
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Register tab"
            accessibilityState={{ selected: modal.view === 'register' }}
            onPress={() => onSelectView('register')}
            style={[
              styles.tabButton,
              modal.view === 'register' ? styles.tabButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.tabButtonLabel,
                modal.view === 'register' ? styles.tabButtonLabelActive : null,
              ]}
            >
              Register
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Recover password tab"
            accessibilityState={{ selected: modal.view === 'recover' }}
            onPress={() => onSelectView('recover')}
            style={[
              styles.tabButton,
              modal.view === 'recover' ? styles.tabButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.tabButtonLabel,
                modal.view === 'recover' ? styles.tabButtonLabelActive : null,
              ]}
            >
              Recover
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'recovery_code' && modal.recoveryCode ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Store this 32-character hexadecimal recovery code in your password
            manager now. Because no email or phone number is collected, losing
            both your password and this code permanently locks this pseudonym.
          </Text>

          <View style={styles.recoveryCodeVault}>
            <Text selectable style={styles.recoveryCodeValue}>
              {formattedRecoveryCode}
            </Text>
            {hasClipboardApi ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy recovery code to clipboard"
                onPress={handleCopyRecoveryCode}
                style={styles.copyCodeButton}
              >
                <Text style={styles.copyCodeButtonLabel}>
                  {copiedCode ? 'Copied ✓' : 'Copy Code'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I have saved my recovery code"
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
            <Text style={styles.checkboxLabel}>
              I have saved my recovery code in a safe place
            </Text>
          </Pressable>

          {!modal.canClose && modal.closeBlockedReason ? (
            <Text style={styles.blockedReasonText}>
              {modal.closeBlockedReason}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue after saving recovery code"
            accessibilityState={{ disabled: !modal.canClose }}
            disabled={!modal.canClose}
            onPress={onClose}
            style={[
              styles.touchButton,
              styles.primaryButton,
              !modal.canClose ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>Continue to Map</Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'register' ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Choose a public pseudonym (3–32 letters, digits, _ or -) and a
            password (8+ characters). Your recovery code is generated next.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Public Pseudonym</Text>
            <TextInput
              accessibilityLabel="Pseudonym"
              value={pseudonym}
              onChangeText={setPseudonym}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              textContentType="username"
              placeholder="e.g. courtyard_mapper"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder="At least 8 characters"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create pseudonymous account"
            disabled={isSubmitting}
            onPress={handleRegisterSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? 'Creating Account…' : 'Create Account'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'login' ? (
        <View style={styles.formSection}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Pseudonym</Text>
            <TextInput
              accessibilityLabel="Pseudonym"
              value={pseudonym}
              onChangeText={setPseudonym}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder="Your pseudonym"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              placeholder="Your password"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in with pseudonym and password"
            disabled={isSubmitting}
            onPress={handleLoginSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? 'Signing In…' : 'Sign In'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'recover' ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Enter your pseudonym, saved 32-hex recovery code, and a new
            password. Your recovery code and active sessions rotate immediately.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Pseudonym</Text>
            <TextInput
              accessibilityLabel="Pseudonym"
              value={pseudonym}
              onChangeText={setPseudonym}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder="Your pseudonym"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>32-Hex Recovery Code</Text>
            <TextInput
              accessibilityLabel="32-hex recovery code"
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
            <Text style={styles.fieldLabel}>New Password</Text>
            <TextInput
              accessibilityLabel="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder="At least 8 characters"
              placeholderTextColor={PALETTE.inkMuted}
              style={styles.inputField}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset password using recovery code"
            disabled={isSubmitting}
            onPress={handleRecoverSubmit}
            style={[
              styles.touchButton,
              styles.primaryButton,
              isSubmitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? 'Resetting Password…' : 'Reset Password'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'account' && modal.currentUser ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Signed in as pseudonymous contributor @
            {modal.currentUser.pseudonym}. Zero personal contact information is
            stored on this server.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log out of current session"
            disabled={isSubmitting}
            onPress={handleLogoutPress}
            style={[styles.touchButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {isSubmitting ? 'Signing Out…' : 'Log Out'}
            </Text>
          </Pressable>

          {confirmingAccountDelete ? (
            <View style={styles.deleteWarningBox} accessibilityRole="alert">
              <Text style={styles.deleteWarningText}>
                Deleting your account permanently erases your credentials,
                active sessions, and votes (recomputing affected proposal
                scores), reserves a cryptographic tombstone of your pseudonym to
                prevent impersonation, and keeps your authored proposals public
                under &ldquo;deleted&rdquo;.
              </Text>

              <View style={styles.confirmRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel account deletion"
                  disabled={isSubmitting}
                  onPress={() => setConfirmingAccountDelete(false)}
                  style={[styles.touchButton, styles.secondaryButton]}
                >
                  <Text style={styles.secondaryButtonLabel}>Cancel</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm permanent account deletion"
                  disabled={isSubmitting}
                  onPress={handleDeleteAccountConfirm}
                  style={[styles.touchButton, styles.dangerButton]}
                >
                  <Text style={styles.primaryButtonLabel}>
                    {isSubmitting ? 'Deleting…' : 'Confirm Delete Account'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              disabled={isSubmitting}
              onPress={() => setConfirmingAccountDelete(true)}
              style={[styles.touchButton, styles.dangerOutlineButton]}
            >
              <Text style={styles.dangerOutlineLabel}>Delete Account</Text>
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
    flex: 1,
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
