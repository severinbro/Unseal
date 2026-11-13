import {
  ApiError,
  type ErrorCode,
  type SurfaceType,
} from '@entsiegelung/shared';

export type Locale = 'de' | 'en';

export const DEFAULT_LOCALE: Locale = 'de';
export const LOCALE_STORAGE_KEY = 'entsiegelung.locale';

export const BUILTIN_SERVER_DISCLAIMER_EN =
  'Community unsealing suggestions — non-binding public input, regardless of property ownership.';

export const BUILTIN_DISCLAIMER_DE =
  'Gemeinschaftliche Entsiegelungsvorschläge — unverbindliche Hinweise der Öffentlichkeit, unabhängig von den Eigentumsverhältnissen.';

interface WebLocaleStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveBrowserLocalStorage(): WebLocaleStorageLike | null {
  try {
    const scope = globalThis as {
      window?: { localStorage?: WebLocaleStorageLike };
      localStorage?: WebLocaleStorageLike;
    };
    return scope.window?.localStorage ?? scope.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en';
}

export function readPersistedLocale(): Locale {
  try {
    const storage = resolveBrowserLocalStorage();
    const raw = storage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage security errors and fall back to German default.
  }
  return DEFAULT_LOCALE;
}

export function writePersistedLocale(locale: Locale): void {
  try {
    const storage = resolveBrowserLocalStorage();
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore quota or private-browsing storage errors.
  }
}

export interface LocalizedSurfaceCopy {
  readonly label: string;
  readonly examples: string;
}

export interface TranslationDictionary {
  readonly app: {
    readonly documentTitle: string;
    readonly loadingTitle: string;
    readonly errorTitle: string;
    readonly errorFallback: string;
    readonly configLoadFallback: string;
    readonly requestFailedFallback: string;
    readonly retryButton: string;
    readonly retryA11y: string;
    readonly legendBacked: string;
    readonly legendNew: string;
    readonly legendContested: string;
  };
  readonly controls: {
    readonly signInShort: string;
    readonly inViewSuffix: string;
    readonly subtitleOrthophoto: string;
    readonly subtitleOsm: string;
    readonly subtitleRegistry: string;
    readonly imageryPrefix: string;
    readonly switchLocaleA11y: string;
    readonly accountSettingsA11y: (pseudonym: string) => string;
    readonly signInOrRegisterA11y: string;
    readonly switchToOrthoA11y: string;
    readonly switchToOsmA11y: string;
    readonly aerialCompact: string;
    readonly streetCompact: string;
    readonly aerialFull: string;
    readonly streetFull: string;
    readonly locateA11y: string;
    readonly locateCompact: string;
    readonly locateBusy: string;
    readonly locateFull: string;
    readonly exportA11y: string;
    readonly exportCompact: string;
    readonly exportFull: string;
    readonly exportErrorFallback: string;
    readonly proposeA11y: string;
    readonly proposeCompact: string;
    readonly proposeFull: string;
    readonly zoomInPrompt: string;
  };
  readonly banners: {
    readonly disclaimerA11y: string;
    readonly dismissDisclaimerA11y: string;
    readonly gotIt: string;
    readonly tileWarningA11y: string;
    readonly dismissTileWarningA11y: string;
    readonly locationNoticeA11y: string;
    readonly dismissLocationA11y: string;
    readonly ok: string;
    readonly truncatedA11y: string;
    readonly truncatedMessage: (limit: number) => string;
  };
  readonly surfaces: Readonly<Record<SurfaceType, LocalizedSurfaceCopy>>;
  readonly drawing: {
    readonly toolbarA11y: string;
    readonly verticesLabel: string;
    readonly areaLabel: string;
    readonly statusClosed: string;
    readonly statusOpen: string;
    readonly expandSheetA11y: string;
    readonly minimizeSheetA11y: string;
    readonly detailsToggle: string;
    readonly mapViewToggle: string;
    readonly undoVertex: string;
    readonly reopenRing: string;
    readonly closeShapeA11y: string;
    readonly closeShape: string;
    readonly ringClosed: string;
    readonly crossingError: (
      lng: string,
      lat: string,
      undoLabel: string,
    ) => string;
    readonly nearBoundNotice: string;
    readonly surfaceSectionTitle: string;
    readonly noteSectionTitle: string;
    readonly noteInputA11y: string;
    readonly notePlaceholder: string;
    readonly discardConfirmTitle: string;
    readonly keepEditingA11y: string;
    readonly keepEditing: string;
    readonly confirmDiscardA11y: string;
    readonly confirmDiscard: string;
    readonly cancelA11y: string;
    readonly cancel: string;
    readonly submitA11y: string;
    readonly submitting: string;
    readonly submit: string;
  };
  readonly inspector: {
    readonly sheetA11y: string;
    readonly proposedBy: (pseudonym: string, isAuthor: boolean) => string;
    readonly overlapA11y: (pos: number, count: number) => string;
    readonly overlapNext: (pos: number, count: number) => string;
    readonly closeA11y: string;
    readonly close: string;
    readonly immutableNotice: string;
    readonly editNoteA11y: string;
    readonly editNotePlaceholder: string;
    readonly cancelEditA11y: string;
    readonly cancel: string;
    readonly saveEditA11y: string;
    readonly saving: string;
    readonly saveChanges: string;
    readonly emptyNote: string;
    readonly netScore: string;
    readonly upvoteA11y: (count: number) => string;
    readonly downvoteA11y: (count: number) => string;
    readonly permanentDisclaimerA11y: string;
    readonly deleteConfirmPrompt: string;
    readonly keepProposalA11y: string;
    readonly keepProposal: string;
    readonly confirmDeleteA11y: string;
    readonly deleting: string;
    readonly confirmDelete: string;
    readonly editDetailsA11y: string;
    readonly editDetails: string;
    readonly deleteProposalA11y: string;
    readonly deleteProposal: string;
    readonly abuseContactPrefix: string;
    readonly voteErrorFallback: string;
    readonly patchErrorFallback: string;
    readonly deleteErrorFallback: string;
  };
  readonly auth: {
    readonly modalA11y: string;
    readonly titleRecovery: string;
    readonly titleRegister: string;
    readonly titleRecover: string;
    readonly titleLogin: string;
    readonly zeroPiiSubtitle: string;
    readonly closeA11y: string;
    readonly close: string;
    readonly tabSignInA11y: string;
    readonly tabSignIn: string;
    readonly tabRegisterA11y: string;
    readonly tabRegister: string;
    readonly tabRecoverA11y: string;
    readonly tabRecover: string;
    readonly recoveryVaultHint: string;
    readonly copyCodeA11y: string;
    readonly copiedCode: string;
    readonly copyCode: string;
    readonly clipboardBlocked: string;
    readonly savedCheckboxA11y: string;
    readonly savedCheckboxLabel: string;
    readonly closeBlockedReason: string;
    readonly continueA11y: string;
    readonly continueToMap: string;
    readonly pendingDraftSummary: string;
    readonly pendingVoteSummary: string;
    readonly sessionExpired: string;
    readonly registerHint: string;
    readonly publicPseudonymLabel: string;
    readonly pseudonymLabel: string;
    readonly pseudonymA11y: string;
    readonly pseudonymPlaceholderRegister: string;
    readonly pseudonymPlaceholderLogin: string;
    readonly passwordLabel: string;
    readonly passwordA11y: string;
    readonly passwordPlaceholderMin: string;
    readonly passwordPlaceholderLogin: string;
    readonly createAccountA11y: string;
    readonly creatingAccount: string;
    readonly createAccount: string;
    readonly signInButtonA11y: string;
    readonly signingIn: string;
    readonly signInButton: string;
    readonly recoverHint: string;
    readonly recoveryCodeLabel: string;
    readonly recoveryCodeA11y: string;
    readonly newPasswordLabel: string;
    readonly newPasswordA11y: string;
    readonly resetPasswordA11y: string;
    readonly resettingPassword: string;
    readonly resetPassword: string;
    readonly accountSignedInHint: (pseudonym: string) => string;
    readonly logoutA11y: string;
    readonly loggingOut: string;
    readonly logout: string;
    readonly deleteAccountWarning: string;
    readonly cancelDeleteAccountA11y: string;
    readonly cancel: string;
    readonly confirmDeleteAccountA11y: string;
    readonly deletingAccount: string;
    readonly confirmDeleteAccount: string;
    readonly deleteAccountA11y: string;
    readonly deleteAccount: string;
    readonly invalidPseudonym: string;
    readonly shortPassword: (min: number) => string;
    readonly missingCredentials: string;
    readonly missingRecoveryFields: (min: number) => string;
    readonly registerFailed: string;
    readonly loginFailed: string;
    readonly recoverFailed: string;
    readonly logoutFailed: string;
    readonly deleteAccountFailed: string;
  };
  readonly location: {
    readonly webHttpsRequired: string;
    readonly webUnsupported: string;
    readonly webInvalidCoords: string;
    readonly webPermissionDenied: string;
    readonly webPositionUnavailable: string;
    readonly webTimeout: string;
    readonly webGenericError: (detail: string) => string;
    readonly webRequestFailed: (detail: string) => string;
    readonly nativePermissionDeniedSettings: string;
    readonly nativePermissionDeniedPrompt: string;
    readonly nativeInvalidCoords: string;
    readonly nativeGenericError: (suffix: string) => string;
  };
}

export const TRANSLATIONS: Readonly<Record<Locale, TranslationDictionary>> = {
  de: {
    app: {
      documentTitle:
        'Entsiegelungskartierung — Gemeinschaftliche Entsiegelungskarte',
      loadingTitle: 'Entsiegelungskarte wird geladen…',
      errorTitle: 'Verbindung zum Kartendienst fehlgeschlagen',
      errorFallback:
        'Bitte prüfe deine Netzwerkverbindung und versuche es erneut.',
      configLoadFallback: 'Kartenkonfiguration konnte nicht geladen werden.',
      requestFailedFallback: 'Anfrage konnte nicht abgeschlossen werden.',
      retryButton: 'Erneut verbinden',
      retryA11y: 'Kartenkonfiguration erneut laden',
      legendBacked: '+ Unterstützt',
      legendNew: '0 Neu',
      legendContested: '− Umstritten',
    },
    controls: {
      signInShort: 'Anmelden',
      inViewSuffix: 'im Ausschnitt',
      subtitleOrthophoto: 'Luftbild (Orthofoto)',
      subtitleOsm: 'OpenStreetMap-Straßenkarte',
      subtitleRegistry: 'Offenes Entsiegelungsregister',
      imageryPrefix: 'Bilddaten:',
      switchLocaleA11y: 'Sprache auf Englisch (EN) umstellen',
      accountSettingsA11y: (pseudonym) =>
        `Kontoeinstellungen für ${pseudonym}`,
      signInOrRegisterA11y: 'Anmelden oder pseudonymes Konto erstellen',
      switchToOrthoA11y: 'Zur Luftbildansicht wechseln',
      switchToOsmA11y: 'Zur OpenStreetMap-Straßenkarte wechseln',
      aerialCompact: 'Luftbild',
      streetCompact: 'Karte',
      aerialFull: 'Luftbildansicht',
      streetFull: 'Straßenkarte',
      locateA11y: 'Eigenen Standort per GPS bestimmen',
      locateCompact: 'GPS',
      locateBusy: 'GPS…',
      locateFull: 'Standort',
      exportA11y: 'Alle Vorschläge als GeoJSON exportieren',
      exportCompact: 'GeoJSON',
      exportFull: 'GeoJSON-Export',
      exportErrorFallback: 'GeoJSON-Export konnte nicht geöffnet werden.',
      proposeA11y: 'Entsiegelungsfläche auf der Karte einzeichnen',
      proposeCompact: '+ Vorschlag',
      proposeFull: '+ Fläche vorschlagen',
      zoomInPrompt:
        'Bitte näher heranzoomen, um Vorschläge zu sehen und einzutragen',
    },
    banners: {
      disclaimerA11y: 'Hinweis zur Öffentlichkeitsbeteiligung',
      dismissDisclaimerA11y: 'Hinweis schließen',
      gotIt: 'Verstanden',
      tileWarningA11y: 'Luftbild-Warnhinweis',
      dismissTileWarningA11y: 'Luftbild-Warnhinweis schließen',
      locationNoticeA11y: 'GPS-Standorthinweis',
      dismissLocationA11y: 'Standorthinweis schließen',
      ok: 'OK',
      truncatedA11y: 'Hinweis zum Anzeigelimit im Kartenausschnitt',
      truncatedMessage: (limit) =>
        `Es werden die ${limit} am besten bewerteten Vorschläge in diesem Ausschnitt gezeigt. Bitte weiter hineinzoomen, um weitere Flächen zu sehen.`,
    },
    surfaces: {
      asphalt: {
        label: 'Asphalt',
        examples: 'Straßenränder, Parkstreifen, Fahrbahnen',
      },
      concrete: {
        label: 'Beton',
        examples: 'Betonplatten, Innenhöfe, Vorplätze',
      },
      pavers: {
        label: 'Pflaster',
        examples: 'Klinker, Kopfstein-, Verbundpflaster',
      },
      other: {
        label: 'Sonstige Versiegelung',
        examples: 'Verdichteter Schotter, Bitumen, Mischbelag',
      },
    },
    drawing: {
      toolbarA11y:
        'Werkzeugleiste zum Einzeichnen eines Entsiegelungsvorschlags',
      verticesLabel: 'Eckpunkte',
      areaLabel: 'Fläche',
      statusClosed:
        'Fläche geschlossen — Versiegelungsart prüfen & einreichen',
      statusOpen:
        'Eckpunkte auf der Karte antippen, um versiegelte Fläche zu umreißen',
      expandSheetA11y: 'Vorschlagsdetails ausklappen',
      minimizeSheetA11y: 'Leiste einklappen, um mehr Karte zu sehen',
      detailsToggle: 'Details',
      mapViewToggle: 'Kartenansicht',
      undoVertex: 'Punkt zurück',
      reopenRing: 'Ring öffnen',
      closeShapeA11y: 'Fläche schließen',
      closeShape: 'Fläche schließen',
      ringClosed: 'Ring geschlossen ✓',
      crossingError: (lng, lat, undoLabel) =>
        `Kanten kreuzen sich nahe [${lng}, ${lat}]. Tippe auf „${undoLabel}“, um die Überschneidung aufzulösen.`,
      nearBoundNotice:
        'Geschätzte Fläche liegt nahe an der Grenze (2–500.000 m²); beim Einreichen wird die exakte PostGIS-Ellipsoidfläche geprüft.',
      surfaceSectionTitle: 'Versiegelungsmaterial',
      noteSectionTitle: 'Standorthinweis (optional)',
      noteInputA11y: 'Optionaler Standorthinweis',
      notePlaceholder:
        'Ungenutzte Parkecke, Hitzeinsel oder Versickerungspotenzial (keine Klarnamen oder Kontaktdaten)',
      discardConfirmTitle:
        'Noch nicht eingereichten Flächenentwurf verwerfen?',
      keepEditingA11y: 'Flächenentwurf weiter bearbeiten',
      keepEditing: 'Weiter bearbeiten',
      confirmDiscardA11y: 'Verwerfen des Entwurfs bestätigen',
      confirmDiscard: 'Entwurf verwerfen',
      cancelA11y: 'Abbrechen oder Entwurf verwerfen',
      cancel: 'Abbrechen',
      submitA11y: 'Entsiegelungsvorschlag einreichen',
      submitting: 'Wird veröffentlicht…',
      submit: 'Vorschlag einreichen',
    },
    inspector: {
      sheetA11y: 'Details des ausgewählten Entsiegelungsvorschlags',
      proposedBy: (pseudonym, isAuthor) => {
        const displayHandle = pseudonym === 'deleted' ? 'gelöscht' : pseudonym;
        return `Vorgeschlagen von @${displayHandle}${isAuthor ? ' · Du' : ''}`;
      },
      overlapA11y: (pos, count) =>
        `Überlappender Vorschlag ${pos} von ${count}. Antippen für nächsten überlappenden Vorschlag.`,
      overlapNext: (pos, count) => `${pos}/${count} · Weiter`,
      closeA11y: 'Vorschlagsansicht schließen',
      close: 'Schließen',
      immutableNotice:
        'Polygonkoordinaten sind nach der Veröffentlichung gesperrt, damit Stimmen fest mit genau dieser Fläche verknüpft bleiben. Zum Anpassen der Grenzen bitte löschen und neu einzeichnen.',
      editNoteA11y: 'Standorthinweis bearbeiten',
      editNotePlaceholder:
        'Optionaler Standorthinweis (leer lassen zum Entfernen)',
      cancelEditA11y: 'Bearbeitung abbrechen',
      cancel: 'Abbrechen',
      saveEditA11y: 'Änderungen am Vorschlag speichern',
      saving: 'Speichert…',
      saveChanges: 'Änderungen speichern',
      emptyNote: 'Kein zusätzlicher Standorthinweis angegeben.',
      netScore: 'Bewertung',
      upvoteA11y: (count) =>
        `Vorschlag unterstützen (+1), aktuell ${count} Pro-Stimmen`,
      downvoteA11y: (count) =>
        `Vorschlag ablehnen (-1), aktuell ${count} Contra-Stimmen`,
      permanentDisclaimerA11y:
        'Dauerhafter Hinweis zur Öffentlichkeitsbeteiligung',
      deleteConfirmPrompt:
        'Diesen Entsiegelungsvorschlag samt allen Stimmen dauerhaft löschen?',
      keepProposalA11y: 'Vorschlag behalten',
      keepProposal: 'Behalten',
      confirmDeleteA11y: 'Löschen des Vorschlags bestätigen',
      deleting: 'Löscht…',
      confirmDelete: 'Endgültig löschen',
      editDetailsA11y: 'Belag oder Standorthinweis bearbeiten',
      editDetails: 'Bearbeiten',
      deleteProposalA11y: 'Vorschlag löschen',
      deleteProposal: 'Vorschlag löschen',
      abuseContactPrefix:
        'Missbrauch oder personenbezogene Daten in Hinweisen melden:',
      voteErrorFallback: 'Stimme konnte momentan nicht gespeichert werden.',
      patchErrorFallback: 'Änderungen konnten nicht gespeichert werden.',
      deleteErrorFallback: 'Vorschlag konnte nicht gelöscht werden.',
    },
    auth: {
      modalA11y: 'Pseudonymes Konto',
      titleRecovery: 'Einmaligen Wiederherstellungscode sichern',
      titleRegister: 'Pseudonym erstellen',
      titleRecover: 'Passwort wiederherstellen',
      titleLogin: 'Anmelden',
      zeroPiiSubtitle:
        'Keine E-Mail · Keine Telefonnummer · Offene Stadtkartierung',
      closeA11y: 'Kontofenster schließen',
      close: 'Schließen',
      tabSignInA11y: 'Tab Anmelden',
      tabSignIn: 'Anmelden',
      tabRegisterA11y: 'Tab Registrieren',
      tabRegister: 'Registrieren',
      tabRecoverA11y: 'Tab Passwort wiederherstellen',
      tabRecover: 'Wiederherstellen',
      recoveryVaultHint:
        'Speichere diesen 32-stelligen Hex-Wiederherstellungscode jetzt in deinem Passwort-Manager. Da weder E-Mail noch Telefonnummer erhoben werden, ist dieses Pseudonym bei Verlust von Passwort und Code dauerhaft gesperrt.',
      copyCodeA11y: 'Wiederherstellungscode in die Zwischenablage kopieren',
      copiedCode: 'Kopiert ✓',
      copyCode: 'Code kopieren',
      clipboardBlocked:
        'Automatisches Kopieren wurde blockiert; bitte den Code oben manuell markieren und kopieren.',
      savedCheckboxA11y: 'Ich habe meinen Wiederherstellungscode gespeichert',
      savedCheckboxLabel:
        'Ich habe meinen Wiederherstellungscode sicher gespeichert',
      closeBlockedReason:
        'Bitte bestätige zuerst „Ich habe meinen Wiederherstellungscode sicher gespeichert“.',
      continueA11y: 'Nach dem Speichern des Wiederherstellungscodes fortfahren',
      continueToMap: 'Weiter zur Karte',
      pendingDraftSummary:
        'Dein Flächenentwurf bleibt gespeichert und wird nach der Anmeldung automatisch eingereicht.',
      pendingVoteSummary:
        'Deine Stimme wird nach der Anmeldung automatisch abgegeben.',
      sessionExpired:
        'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      registerHint:
        'Wähle ein öffentliches Pseudonym (3–32 Buchstaben, Ziffern, _ oder -) und ein Passwort (mind. 8 Zeichen). Dein Wiederherstellungscode wird im nächsten Schritt erzeugt.',
      publicPseudonymLabel: 'Öffentliches Pseudonym',
      pseudonymLabel: 'Pseudonym',
      pseudonymA11y: 'Pseudonym',
      pseudonymPlaceholderRegister: 'z. B. innenhof_initiative',
      pseudonymPlaceholderLogin: 'Dein Pseudonym',
      passwordLabel: 'Passwort',
      passwordA11y: 'Passwort',
      passwordPlaceholderMin: 'Mindestens 8 Zeichen',
      passwordPlaceholderLogin: 'Dein Passwort',
      createAccountA11y: 'Pseudonymes Konto erstellen',
      creatingAccount: 'Konto wird erstellt…',
      createAccount: 'Konto erstellen',
      signInButtonA11y: 'Mit Pseudonym und Passwort anmelden',
      signingIn: 'Anmeldung läuft…',
      signInButton: 'Anmelden',
      recoverHint:
        'Gib dein Pseudonym, deinen gespeicherten 32-stelligen Hex-Wiederherstellungscode und ein neues Passwort ein. Dein Wiederherstellungscode und aktive Sitzungen werden sofort erneuert.',
      recoveryCodeLabel: '32-stelliger Wiederherstellungscode',
      recoveryCodeA11y: '32-stelliger Wiederherstellungscode',
      newPasswordLabel: 'Neues Passwort',
      newPasswordA11y: 'Neues Passwort',
      resetPasswordA11y: 'Passwort mit Wiederherstellungscode zurücksetzen',
      resettingPassword: 'Passwort wird geändert…',
      resetPassword: 'Passwort zurücksetzen',
      accountSignedInHint: (pseudonym) =>
        `Angemeldet als pseudonymes Mitglied @${pseudonym}. Auf diesem Server werden keinerlei persönliche Kontaktdaten gespeichert.`,
      logoutA11y: 'Aus aktueller Sitzung abmelden',
      loggingOut: 'Abmeldung läuft…',
      logout: 'Abmelden',
      deleteAccountWarning:
        'Das Löschen deines Kontos entfernt dauerhaft deine Zugangsdaten, aktiven Sitzungen und Stimmen (betroffene Bewertungen werden neu berechnet), sperrt dein Pseudonym kryptografisch gegen Nachahmung und erhält deine eingereichten Flächen öffentlich unter „gelöscht“.',
      cancelDeleteAccountA11y: 'Kontolöschung abbrechen',
      cancel: 'Abbrechen',
      confirmDeleteAccountA11y: 'Endgültige Kontolöschung bestätigen',
      deletingAccount: 'Wird gelöscht…',
      confirmDeleteAccount: 'Konto endgültig löschen',
      deleteAccountA11y: 'Konto löschen',
      deleteAccount: 'Konto löschen',
      invalidPseudonym:
        'Das Pseudonym muss 3–32 Zeichen lang sein (Buchstaben, Ziffern, Unterstrich _ oder Bindestrich -).',
      shortPassword: (min) =>
        `Das Passwort muss mindestens ${min} Zeichen lang sein.`,
      missingCredentials: 'Bitte Pseudonym und Passwort eingeben.',
      missingRecoveryFields: (min) =>
        `Bitte Pseudonym, 32-stelligen Wiederherstellungscode und ein neues Passwort (mind. ${min} Zeichen) eingeben.`,
      registerFailed: 'Registrierung fehlgeschlagen.',
      loginFailed: 'Anmeldung fehlgeschlagen.',
      recoverFailed: 'Passwort-Wiederherstellung fehlgeschlagen.',
      logoutFailed: 'Abmeldung fehlgeschlagen.',
      deleteAccountFailed: 'Kontolöschung fehlgeschlagen.',
    },
    location: {
      webHttpsRequired:
        'Die Browser-Standortbestimmung erfordert eine sichere HTTPS-Verbindung (oder localhost). Öffne Entsiegelungskartierung über https://, um „Standort“ zu nutzen.',
      webUnsupported:
        'Geolocation wird in diesem Browser nicht unterstützt oder ist nicht verfügbar.',
      webInvalidCoords:
        'Die Browser-Standortbestimmung hat ungültige GPS-Koordinaten geliefert.',
      webPermissionDenied:
        'Standortberechtigung verweigert. Bitte erlaube den Standortzugriff in den Browser-Websiteberechtigungen (über HTTPS), um die Karte auf deine Position zu zentrieren.',
      webPositionUnavailable:
        'Dein aktueller Standort ist nicht verfügbar. Bitte prüfe, ob die Ortungsdienste deines Geräts aktiviert sind, und versuche es erneut.',
      webTimeout:
        'Zeitüberschreitung beim Abrufen der GPS-Koordinaten. Bitte begib dich an einen Ort mit freier Sicht oder versuche es erneut.',
      webGenericError: (detail) =>
        detail.length > 0
          ? `Aktueller Standort konnte nicht ermittelt werden: ${detail}`
          : 'Aktueller Standort konnte nicht ermittelt werden.',
      webRequestFailed: (detail) =>
        `Standortabfrage im Browser fehlgeschlagen${detail}`,
      nativePermissionDeniedSettings:
        'Standortberechtigung verweigert. Bitte aktiviere den Standortzugriff für Entsiegelungskartierung in den Geräteeinstellungen.',
      nativePermissionDeniedPrompt:
        'Standortberechtigung verweigert. Bitte erlaube den Standortzugriff, um die Karte auf deine GPS-Position zu zentrieren.',
      nativeInvalidCoords:
        'Der Standortdienst des Geräts hat ungültige GPS-Koordinaten geliefert.',
      nativeGenericError: (suffix) =>
        `Aktuelle GPS-Position konnte nicht bestimmt werden. Bitte prüfe, ob die Ortungsdienste aktiviert sind.${suffix}`,
    },
  },
  en: {
    app: {
      documentTitle: 'Entsiegelungskartierung — Civic Unsealing Map',
      loadingTitle: 'Loading civic unsealing map…',
      errorTitle: 'Could not connect to map service',
      errorFallback: 'Please verify your network connection and retry.',
      configLoadFallback: 'Unable to load map configuration.',
      requestFailedFallback: 'Request could not be completed.',
      retryButton: 'Retry Connection',
      retryA11y: 'Retry loading map configuration',
      legendBacked: '+ Backed',
      legendNew: '0 New',
      legendContested: '− Contested',
    },
    controls: {
      signInShort: 'Sign in',
      inViewSuffix: 'in view',
      subtitleOrthophoto: 'Aerial Orthophoto',
      subtitleOsm: 'OpenStreetMap Street Layer',
      subtitleRegistry: 'Open civic unsealing registry',
      imageryPrefix: 'Imagery:',
      switchLocaleA11y: 'Switch language to German (DE)',
      accountSettingsA11y: (pseudonym) => `Account settings for ${pseudonym}`,
      signInOrRegisterA11y: 'Sign in or register pseudonymous account',
      switchToOrthoA11y: 'Switch to aerial orthophoto layer',
      switchToOsmA11y: 'Switch to OpenStreetMap street layer',
      aerialCompact: 'Aerial',
      streetCompact: 'Street',
      aerialFull: 'Aerial View',
      streetFull: 'Street Map',
      locateA11y: 'Locate me using device GPS',
      locateCompact: 'GPS',
      locateBusy: 'GPS…',
      locateFull: 'Locate Me',
      exportA11y: 'Export all proposals as GeoJSON',
      exportCompact: 'GeoJSON',
      exportFull: 'Export GeoJSON',
      exportErrorFallback: 'Unable to open GeoJSON export URL.',
      proposeA11y: 'Draw unsealing proposal polygon',
      proposeCompact: '+ Propose',
      proposeFull: '+ Propose Unsealing',
      zoomInPrompt: 'Zoom in to view and add proposals',
    },
    banners: {
      disclaimerA11y: 'Public participation disclaimer',
      dismissDisclaimerA11y: 'Dismiss disclaimer',
      gotIt: 'Got it',
      tileWarningA11y: 'Orthophoto tile warning',
      dismissTileWarningA11y: 'Dismiss tile warning',
      locationNoticeA11y: 'GPS location notice',
      dismissLocationA11y: 'Dismiss location notice',
      ok: 'OK',
      truncatedA11y: 'Viewport proposal limit notice',
      truncatedMessage: (limit) =>
        `Showing top ${limit} highest-rated proposals in this map view. Zoom in further to inspect additional proposals.`,
    },
    surfaces: {
      asphalt: {
        label: 'Asphalt',
        examples: 'Road margins, parking strips, lanes',
      },
      concrete: {
        label: 'Concrete',
        examples: 'Poured slabs, courtyards, forecourts',
      },
      pavers: {
        label: 'Pavers',
        examples: 'Brick, cobble, interlocking stones',
      },
      other: {
        label: 'Other Sealed',
        examples: 'Compacted gravel, bitumen, mixed cover',
      },
    },
    drawing: {
      toolbarA11y: 'Polygon proposal drawing toolbar',
      verticesLabel: 'Vertices',
      areaLabel: 'Area',
      statusClosed: 'Shape closed — review surface type & publish',
      statusOpen: 'Tap corners on the map to outline sealed ground',
      expandSheetA11y: 'Expand proposal details sheet',
      minimizeSheetA11y: 'Minimize sheet to view more map',
      detailsToggle: 'Details',
      mapViewToggle: 'Map View',
      undoVertex: 'Undo vertex',
      reopenRing: 'Reopen ring',
      closeShapeA11y: 'Close shape',
      closeShape: 'Close Shape',
      ringClosed: 'Ring Closed ✓',
      crossingError: (lng, lat, undoLabel) =>
        `Edges cross near [${lng}, ${lat}]. Tap “${undoLabel}” to uncross the boundary.`,
      nearBoundNotice:
        'Estimated area is close to the allowed range (2–500,000 m²); exact PostGIS ellipsoid area is verified on submit.',
      surfaceSectionTitle: 'Sealed Surface Material',
      noteSectionTitle: 'Site Context (Optional)',
      noteInputA11y: 'Optional site context note',
      notePlaceholder:
        'Unused paved corner, heat island, or drainage potential (no personal names or contact data)',
      discardConfirmTitle: 'Discard your unsubmitted polygon draft?',
      keepEditingA11y: 'Keep editing polygon draft',
      keepEditing: 'Keep Editing',
      confirmDiscardA11y: 'Confirm discard polygon draft',
      confirmDiscard: 'Discard Draft',
      cancelA11y: 'Cancel or discard draft',
      cancel: 'Cancel',
      submitA11y: 'Submit unsealing proposal',
      submitting: 'Publishing…',
      submit: 'Submit Proposal',
    },
    inspector: {
      sheetA11y: 'Selected unsealing proposal inspector',
      proposedBy: (pseudonym, isAuthor) =>
        `Proposed by @${pseudonym}${isAuthor ? ' · You' : ''}`,
      overlapA11y: (pos, count) =>
        `Overlapping proposal ${pos} of ${count}. Activate to inspect next overlapping proposal.`,
      overlapNext: (pos, count) => `${pos}/${count} · Next`,
      closeA11y: 'Close proposal inspector',
      close: 'Close',
      immutableNotice:
        'Polygon coordinates are locked after publication so community votes remain anchored to the exact site. Delete and redraw to adjust boundaries.',
      editNoteA11y: 'Edit proposal note',
      editNotePlaceholder: 'Optional site note (leave blank to clear)',
      cancelEditA11y: 'Cancel metadata edit',
      cancel: 'Cancel',
      saveEditA11y: 'Save proposal metadata changes',
      saving: 'Saving…',
      saveChanges: 'Save Changes',
      emptyNote: 'No additional site note provided by the author.',
      netScore: 'net score',
      upvoteA11y: (count) =>
        `Upvote proposal (+1), current upvotes ${count}`,
      downvoteA11y: (count) =>
        `Downvote proposal (-1), current downvotes ${count}`,
      permanentDisclaimerA11y: 'Permanent civic proposal disclaimer',
      deleteConfirmPrompt:
        'Permanently delete this unsealing proposal and its votes?',
      keepProposalA11y: 'Keep proposal',
      keepProposal: 'Keep Proposal',
      confirmDeleteA11y: 'Confirm delete proposal',
      deleting: 'Deleting…',
      confirmDelete: 'Confirm Delete',
      editDetailsA11y: 'Edit proposal surface type or note',
      editDetails: 'Edit Details',
      deleteProposalA11y: 'Delete proposal',
      deleteProposal: 'Delete Proposal',
      abuseContactPrefix: 'Report abuse or personal data in notes:',
      voteErrorFallback: 'Unable to update vote right now.',
      patchErrorFallback: 'Unable to save proposal metadata.',
      deleteErrorFallback: 'Unable to delete proposal.',
    },
    auth: {
      modalA11y: 'Pseudonymous account modal',
      titleRecovery: 'Save One-Time Recovery Code',
      titleRegister: 'Create Pseudonym',
      titleRecover: 'Recover Password',
      titleLogin: 'Contributor Sign In',
      zeroPiiSubtitle: 'Zero email · Zero phone · Open civic mapping',
      closeA11y: 'Close account modal',
      close: 'Close',
      tabSignInA11y: 'Sign In tab',
      tabSignIn: 'Sign In',
      tabRegisterA11y: 'Register tab',
      tabRegister: 'Register',
      tabRecoverA11y: 'Recover password tab',
      tabRecover: 'Recover',
      recoveryVaultHint:
        'Store this 32-character hexadecimal recovery code in your password manager now. Because no email or phone number is collected, losing both your password and this code permanently locks this pseudonym.',
      copyCodeA11y: 'Copy recovery code to clipboard',
      copiedCode: 'Copied ✓',
      copyCode: 'Copy Code',
      clipboardBlocked:
        'Automatic clipboard copy was blocked; select and copy the code manually above.',
      savedCheckboxA11y: 'I have saved my recovery code',
      savedCheckboxLabel: 'I have saved my recovery code in a safe place',
      closeBlockedReason:
        'Please confirm "I have saved my recovery code" before closing.',
      continueA11y: 'Continue after saving recovery code',
      continueToMap: 'Continue to Map',
      pendingDraftSummary:
        'Your polygon draft is preserved and will be submitted once you sign in.',
      pendingVoteSummary:
        'Your vote will be submitted automatically once you sign in.',
      sessionExpired: 'Your session expired. Please sign in to continue.',
      registerHint:
        'Choose a public pseudonym (3–32 letters, digits, _ or -) and a password (8+ characters). Your recovery code is generated next.',
      publicPseudonymLabel: 'Public Pseudonym',
      pseudonymLabel: 'Pseudonym',
      pseudonymA11y: 'Pseudonym',
      pseudonymPlaceholderRegister: 'e.g. courtyard_mapper',
      pseudonymPlaceholderLogin: 'Your pseudonym',
      passwordLabel: 'Password',
      passwordA11y: 'Password',
      passwordPlaceholderMin: 'At least 8 characters',
      passwordPlaceholderLogin: 'Your password',
      createAccountA11y: 'Create pseudonymous account',
      creatingAccount: 'Creating Account…',
      createAccount: 'Create Account',
      signInButtonA11y: 'Sign in with pseudonym and password',
      signingIn: 'Signing In…',
      signInButton: 'Sign In',
      recoverHint:
        'Enter your pseudonym, saved 32-hex recovery code, and a new password. Your recovery code and active sessions rotate immediately.',
      recoveryCodeLabel: '32-Hex Recovery Code',
      recoveryCodeA11y: '32-hex recovery code',
      newPasswordLabel: 'New Password',
      newPasswordA11y: 'New password',
      resetPasswordA11y: 'Reset password using recovery code',
      resettingPassword: 'Resetting Password…',
      resetPassword: 'Reset Password',
      accountSignedInHint: (pseudonym) =>
        `Signed in as pseudonymous contributor @${pseudonym}. Zero personal contact information is stored on this server.`,
      logoutA11y: 'Log out of current session',
      loggingOut: 'Signing Out…',
      logout: 'Log Out',
      deleteAccountWarning:
        'Deleting your account permanently erases your credentials, active sessions, and votes (recomputing affected proposal scores), reserves a cryptographic tombstone of your pseudonym to prevent impersonation, and keeps your authored proposals public under “deleted”.',
      cancelDeleteAccountA11y: 'Cancel account deletion',
      cancel: 'Cancel',
      confirmDeleteAccountA11y: 'Confirm permanent account deletion',
      deletingAccount: 'Deleting…',
      confirmDeleteAccount: 'Confirm Delete Account',
      deleteAccountA11y: 'Delete account',
      deleteAccount: 'Delete Account',
      invalidPseudonym:
        'Pseudonym must be 3–32 characters using letters, digits, underscores (_), or hyphens (-).',
      shortPassword: (min) => `Password must be at least ${min} characters.`,
      missingCredentials: 'Enter your pseudonym and password.',
      missingRecoveryFields: (min) =>
        `Enter your pseudonym, 32-character recovery code, and a new password (at least ${min} characters).`,
      registerFailed: 'Registration failed.',
      loginFailed: 'Sign-in failed.',
      recoverFailed: 'Password recovery failed.',
      logoutFailed: 'Logout failed.',
      deleteAccountFailed: 'Account deletion failed.',
    },
    location: {
      webHttpsRequired:
        'Browser geolocation requires a secure HTTPS connection (or localhost). Open Entsiegelungskartierung over https:// to use "Locate me".',
      webUnsupported:
        'Geolocation is not supported or available in this browser.',
      webInvalidCoords:
        'Browser geolocation returned invalid GPS coordinates.',
      webPermissionDenied:
        'Location permission was denied. Allow location access in your browser site permissions (and ensure HTTPS) to center the map on your position.',
      webPositionUnavailable:
        'Your current position is unavailable. Check that device location services are enabled and try again.',
      webTimeout:
        'Timed out while waiting for GPS coordinates. Move to an area with a clearer view or try again.',
      webGenericError: (detail) =>
        detail.length > 0
          ? `Unable to retrieve your current location: ${detail}`
          : 'Unable to retrieve your current location.',
      webRequestFailed: (detail) =>
        `Unable to request browser geolocation${detail}`,
      nativePermissionDeniedSettings:
        'Location permission was denied. Enable foreground location access for Entsiegelungskartierung in your device settings to center the map on your GPS position.',
      nativePermissionDeniedPrompt:
        'Location permission was denied. Grant foreground location access to center the map on your current GPS position.',
      nativeInvalidCoords:
        'Device location provider returned invalid GPS coordinates.',
      nativeGenericError: (suffix) =>
        `Unable to determine your current GPS position. Ensure device location services are enabled and try again.${suffix}`,
    },
  },
};

export function getTranslations(locale: Locale): TranslationDictionary {
  return TRANSLATIONS[locale];
}

export function localizeDisclaimerText(
  rawText: string | null,
  locale: Locale,
): string | null {
  if (rawText === null) {
    return null;
  }
  if (locale === 'de' && rawText.trim() === BUILTIN_SERVER_DISCLAIMER_EN) {
    return BUILTIN_DISCLAIMER_DE;
  }
  return rawText;
}

export function localizeSystemNotice(
  rawText: string | null,
  locale: Locale,
): string | null {
  if (rawText === null || locale === 'en') {
    return rawText;
  }
  if (
    rawText ===
    'Aerial orthophoto tiles failed to load; reverted to OpenStreetMap basemap.'
  ) {
    return 'Luftbild-Kacheln konnten nicht geladen werden; zurück zur OpenStreetMap-Straßenkarte gewechselt.';
  }
  const detailMatch =
    /^Aerial orthophoto tiles failed to load \((.+)\); reverted to OpenStreetMap basemap\.$/.exec(
      rawText,
    );
  if (detailMatch?.[1]) {
    return `Luftbild-Kacheln konnten nicht geladen werden (${detailMatch[1]}); zurück zur OpenStreetMap-Straßenkarte gewechselt.`;
  }
  return rawText;
}

export function translateValidationMessage(
  msg: string,
  locale: Locale,
): string {
  if (locale === 'en') {
    return msg;
  }
  if (msg === 'Coordinates must be finite numbers.') {
    return 'Koordinaten müssen endliche Zahlen sein.';
  }
  if (msg === 'Longitude must be within [-180, 180] degrees.') {
    return 'Der Längengrad muss zwischen −180° und 180° liegen.';
  }
  const latMatch =
    /^Latitude must be within \[-([0-9.]+), ([0-9.]+)\] degrees\.$/.exec(msg);
  if (latMatch?.[1] && latMatch[2]) {
    return `Der Breitengrad muss zwischen −${latMatch[1]}° und ${latMatch[2]}° liegen.`;
  }
  const minVertMatch =
    /^Polygon requires at least (\d+) distinct vertices\.$/.exec(msg);
  if (minVertMatch?.[1]) {
    return `Ein Polygon benötigt mindestens ${minVertMatch[1]} unterschiedliche Eckpunkte.`;
  }
  const maxVertMatch =
    /^Polygon must have at most (\d+) distinct vertices\.$/.exec(msg);
  if (maxVertMatch?.[1]) {
    return `Ein Polygon darf höchstens ${maxVertMatch[1]} unterschiedliche Eckpunkte haben.`;
  }
  const spanMatch =
    /^Polygon span exceeds maximum of ([0-9.]+)° in longitude or latitude\.$/.exec(
      msg,
    );
  if (spanMatch?.[1]) {
    return `Die Ausdehnung des Polygons überschreitet das Maximum von ${spanMatch[1]}° in Länge oder Breite.`;
  }
  const spikeMatch =
    /^Polygon contains a fold-back spike with interior turn angle below ([0-9.]+)°\.$/.exec(
      msg,
    );
  if (spikeMatch?.[1]) {
    return `Das Polygon enthält eine spitze Rückfaltung mit einem Innenwinkel unter ${spikeMatch[1]}°.`;
  }
  if (msg === 'Polygon edges must not cross or self-intersect.') {
    return 'Polygonkanten dürfen sich nicht kreuzen oder selbst schneiden.';
  }
  if (msg === 'Polygon vertices must not touch or self-intersect.') {
    return 'Polygoneckpunkte dürfen sich nicht berühren oder selbst schneiden.';
  }
  const minAreaMatch =
    /^Polygon area \(([0-9.]+) m²\) is below minimum of ([0-9.,]+) m²\.$/.exec(
      msg,
    );
  if (minAreaMatch?.[1] && minAreaMatch[2]) {
    return `Die Polygonfläche (${minAreaMatch[1]} m²) liegt unter dem Minimum von ${minAreaMatch[2]} m².`;
  }
  const maxAreaMatch =
    /^Polygon area \(([0-9.]+) m²\) exceeds maximum of ([0-9.,]+) m²\.$/.exec(
      msg,
    );
  if (maxAreaMatch?.[1] && maxAreaMatch[2]) {
    const formattedMax = maxAreaMatch[2].replace(/,/g, '.');
    return `Die Polygonfläche (${maxAreaMatch[1]} m²) überschreitet das Maximum von ${formattedMax} m².`;
  }
  const noteLenMatch = /^Note must be at most (\d+) characters\.$/.exec(msg);
  if (noteLenMatch?.[1]) {
    return `Der Standorthinweis darf höchstens ${noteLenMatch[1]} Zeichen lang sein.`;
  }
  return msg;
}

const GERMAN_API_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: 'Bitte melde dich an, um fortzufahren.',
  AUTH_INVALID_CREDENTIALS: 'Ungültiges Pseudonym oder Passwort.',
  AUTH_PSEUDONYM_TAKEN: 'Dieses Pseudonym ist bereits vergeben oder reserviert.',
  FORBIDDEN_PSEUDONYM_BANNED: 'Dieses Pseudonym ist gesperrt.',
  AUTH_RECOVERY_INVALID:
    'Ungültiges Pseudonym oder ungültiger Wiederherstellungscode.',
  AUTH_BUSY:
    'Anmeldedienst ist ausgelastet. Bitte kurz warten und erneut versuchen.',
  FORBIDDEN_NOT_AUTHOR:
    'Nur die erstellende Person kann diesen Vorschlag bearbeiten oder löschen.',
  NOT_FOUND: 'Der angeforderte Eintrag wurde nicht gefunden.',
  VALIDATION_ERROR: 'Ungültige Eingabedaten.',
  GEOMETRY_INVALID:
    'Ungültige Polygongeometrie: Kanten dürfen sich nicht selbst schneiden.',
  AREA_OUT_OF_BOUNDS:
    'Die Polygonfläche liegt außerhalb des zulässigen Bereichs (2–500.000 m²).',
  BBOX_TOO_LARGE: 'Kartenausschnitt zu groß — bitte näher heranzoomen.',
  PAYLOAD_TOO_LARGE: 'Die gesendeten Daten überschreiten die maximale Größe.',
  RATE_LIMITED:
    'Zu viele Anfragen oder Tageslimit erreicht. Bitte später erneut versuchen.',
  SERVICE_UNAVAILABLE:
    'Kartendienst vorübergehend nicht erreichbar. Bitte Verbindung prüfen.',
  INTERNAL_ERROR: 'Interner Serverfehler. Bitte später erneut versuchen.',
};

export function localizeError(
  err: unknown,
  fallback: string,
  locale: Locale,
): string {
  if (err instanceof ApiError) {
    if (locale === 'de') {
      if (err.code === 'VALIDATION_ERROR') {
        const translated = translateValidationMessage(err.message, 'de');
        if (translated !== err.message) {
          return translated;
        }
      }
      return GERMAN_API_ERROR_MESSAGES[err.code] ?? fallback;
    }
    return err.message.trim().length > 0 ? err.message : fallback;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return locale === 'de'
      ? translateValidationMessage(err.message.trim(), 'de')
      : err.message.trim();
  }
  return fallback;
}
