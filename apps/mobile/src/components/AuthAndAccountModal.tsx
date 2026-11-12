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

export interface AuthAndAccountModalProps {
  modal: AuthModalModel;
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

  useEffect(() => {
    setLocalError(null);
    setConfirmingAccountDelete(false);
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

  return (
    <View
      style={styles.modalCard}
      accessibilityLabel="Pseudonymous account modal"
    >
      <View style={styles.headerRow}>
        <Text style={styles.modalTitle}>
          {modal.view === 'recovery_code'
            ? 'Save Your One-Time Recovery Code'
            : modal.view === 'account'
              ? `Account · ${modal.currentUser?.pseudonym ?? ''}`
              : modal.view === 'register'
                ? 'Register Pseudonymous Account'
                : modal.view === 'recover'
                  ? 'Reset Password via Recovery Code'
                  : 'Sign In'}
        </Text>

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
        <View style={styles.tabRow} accessibilityRole="tablist">
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
            manager now. Entsiegelungskartierung collects no email or phone
            number — losing both your password and recovery code permanently
            locks this pseudonym.
          </Text>

          <View style={styles.recoveryCodeBox}>
            <Text selectable style={styles.recoveryCodeValue}>
              {modal.recoveryCode}
            </Text>
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
              I have saved my recovery code
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
            <Text style={styles.primaryButtonLabel}>Continue</Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'register' ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Zero email or real name required. Choose a public pseudonym (3–32
            letters, digits, _ or -) and a password (8+ characters).
          </Text>

          <TextInput
            accessibilityLabel="Pseudonym"
            value={pseudonym}
            onChangeText={setPseudonym}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            textContentType="username"
            placeholder="Pseudonym (e.g. courtyard_mapper)"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

          <TextInput
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="Password (at least 8 characters)"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

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
              {isSubmitting ? 'Creating account…' : 'Create Account'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'login' ? (
        <View style={styles.formSection}>
          <TextInput
            accessibilityLabel="Pseudonym"
            value={pseudonym}
            onChangeText={setPseudonym}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            placeholder="Pseudonym"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

          <TextInput
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            placeholder="Password"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

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
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'recover' ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Enter your pseudonym, saved 32-hex recovery code, and a new
            password. Your previous recovery code and sessions will be rotated.
          </Text>

          <TextInput
            accessibilityLabel="Pseudonym"
            value={pseudonym}
            onChangeText={setPseudonym}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            placeholder="Pseudonym"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

          <TextInput
            accessibilityLabel="32-hex recovery code"
            value={recoveryCodeInput}
            onChangeText={setRecoveryCodeInput}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            textContentType="oneTimeCode"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

          <TextInput
            accessibilityLabel="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="New password (at least 8 characters)"
            placeholderTextColor="#6c7b73"
            style={styles.inputField}
          />

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
              {isSubmitting ? 'Resetting password…' : 'Reset Password'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {modal.view === 'account' && modal.currentUser ? (
        <View style={styles.formSection}>
          <Text style={styles.privacyHint}>
            Signed in as pseudonymous contributor{' '}
            {modal.currentUser.pseudonym}. No email address or contact data is
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
              {isSubmitting ? 'Working…' : 'Log Out'}
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
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cdd9d2',
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#1b2a22',
  },
  closeButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1b2a22',
  },
  disabledButton: {
    opacity: 0.45,
  },
  intentBanner: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#e8eef5',
  },
  intentBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1f3a5c',
  },
  errorBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fdecec',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8a1f1f',
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b7c7be',
    backgroundColor: '#f9fbfa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    borderColor: '#1f6f4a',
    backgroundColor: '#e6f2ec',
  },
  tabButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#34473e',
  },
  tabButtonLabelActive: {
    color: '#134c31',
    fontWeight: '700',
  },
  formSection: {
    gap: 10,
  },
  privacyHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#3c4a42',
  },
  inputField: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b7c7be',
    backgroundColor: '#ffffff',
    fontSize: 14,
    color: '#1b2a22',
  },
  recoveryCodeBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f1f5f3',
    borderWidth: 1,
    borderColor: '#9ab5a8',
    alignItems: 'center',
  },
  recoveryCodeValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#133b27',
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
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#1f6f4a',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxIndicatorChecked: {
    backgroundColor: '#1f6f4a',
  },
  checkboxMark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1b2a22',
  },
  blockedReasonText: {
    fontSize: 12,
    color: '#7a4f00',
  },
  touchButton: {
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#1f6f4a',
  },
  primaryButtonDisabled: {
    backgroundColor: '#9ab5a8',
  },
  primaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b7c7be',
  },
  secondaryButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1b2a22',
  },
  dangerOutlineButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#b53838',
  },
  dangerOutlineLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9c2222',
  },
  deleteWarningBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fdecec',
    gap: 10,
  },
  deleteWarningText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7a1c1c',
  },
  confirmRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dangerButton: {
    backgroundColor: '#a62626',
  },
});
