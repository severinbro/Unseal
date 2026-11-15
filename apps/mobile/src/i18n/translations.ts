import {
  ApiError,
  type ErrorCode,
  type PolygonFlagReason,
  type SurfaceType,
} from '@entsiegelung/shared';

export type Locale = 'de' | 'en';

export const DEFAULT_LOCALE: Locale = 'de';
export const LOCALE_STORAGE_KEY = 'entsiegelung.locale';

export const BUILTIN_SERVER_DISCLAIMER_EN =
  'Community unsealing suggestions - non-binding public input, regardless of property ownership.';

export const BUILTIN_DISCLAIMER_DE =
  'Gemeinschaftliche Entsiegelungsvorschläge - unverbindliche Hinweise der Öffentlichkeit, unabhängig von den Eigentumsverhältnissen.';

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
    readonly legendInProgress: string;
    readonly legendFinished: string;
    readonly nativeAttributionOsm: string;
    readonly nativeAttributionOrtho: string;
  };
  readonly controls: {
    readonly signInShort: string;
    readonly inViewSuffix: string;
    readonly subtitleOrthophoto: string;
    readonly subtitleOsm: string;
    readonly subtitleRegistry: string;
    readonly osmAttributionShort: string;
    readonly imageryPrefix: string;
    readonly switchLocaleA11y: string;
    readonly aboutButtonA11y: string;
    readonly bugReportButtonA11y: string;
    readonly bugReportButtonTooltip: string;
    readonly searchAddressA11y: string;
    readonly apkDownloadA11y: string;
    readonly apkDownloadCompact: string;
    readonly apkDownloadFull: string;
    readonly apkDownloadErrorFallback: string;
    readonly installAppA11y: string;
    readonly installAppFull: string;
    readonly accountSettingsA11y: (pseudonym: string) => string;
    readonly signInOrRegisterA11y: string;
    readonly switchToOrthoA11y: string;
    readonly switchToOsmA11y: string;
    readonly aerialCompact: string;
    readonly streetCompact: string;
    readonly aerialFull: string;
    readonly streetFull: string;
    readonly locateA11y: string;
    readonly gnssA11y: string;
    readonly northA11y: string;
    readonly locateCompact: string;
    readonly locateBusy: string;
    readonly locateFull: string;
    readonly exportA11y: string;
    readonly exportCompact: string;
    readonly exportFull: string;
    readonly exportErrorFallback: string;
    readonly importA11y: string;
    readonly importCompact: string;
    readonly importFull: string;
    readonly importingBusy: string;
    readonly importSuccess: (imported: number, skipped: number) => string;
    readonly importErrorFallback: string;
    readonly proposeA11y: string;
    readonly proposeCompact: string;
    readonly proposeFull: string;
    readonly zoomInPrompt: string;
    readonly filterGroupA11y: string;
    readonly filterAll: string;
    readonly filterAllA11y: string;
    readonly filterNewCompact: string;
    readonly filterNewFull: string;
    readonly filterNewA11y: string;
    readonly filterEstablishedCompact: string;
    readonly filterEstablishedFull: string;
    readonly filterEstablishedA11y: string;
    readonly filterNeedsReviewCompact: string;
    readonly filterNeedsReviewFull: string;
    readonly filterNeedsReviewA11y: string;
    readonly polygonOpacityLabel: string;
    readonly polygonOpacityA11y: string;
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
    readonly stepGeometryLabel: string;
    readonly stepDetailsLabel: string;
    readonly nextStep: string;
    readonly nextStepA11y: string;
    readonly closeAndNext: string;
    readonly backToGeometry: string;
    readonly backToGeometryA11y: string;
    readonly photosSectionTitle: string;
    readonly takePhoto: string;
    readonly pickPhoto: string;
    readonly removeDraftPhotoA11y: string;
    readonly photoPrivacyHint: string;
  };
  readonly inspector: {
    readonly sheetA11y: string;
    readonly proposedBy: (pseudonym: string, isAuthor: boolean) => string;
    readonly overlapA11y: (pos: number, count: number) => string;
    readonly overlapNext: (pos: number, count: number) => string;
    readonly closeA11y: string;
    readonly close: string;
    readonly tabOverview: string;
    readonly tabComments: (count: number) => string;
    readonly tabPhotos: (count: number) => string;
    readonly tabManage: string;
    readonly openCommentsBanner: (count: number) => string;
    readonly topCommentBadge: string;
    readonly replyingToLabel: (pseudonym: string) => string;
    readonly commentAuthorLabel: (pseudonym: string, isAuthor: boolean) => string;
    readonly commentInputPlaceholder: string;
    readonly commentInputA11y: string;
    readonly replyInputPlaceholder: (pseudonym: string) => string;
    readonly postComment: string;
    readonly postReply: string;
    readonly postingComment: string;
    readonly replyButton: string;
    readonly cancelReplyButton: string;
    readonly upvoteCommentA11y: (count: number) => string;
    readonly deleteComment: string;
    readonly deleteCommentA11y: string;
    readonly noCommentsYet: string;
    readonly commentSignInPrompt: string;
    readonly commentErrorFallback: string;
    readonly statusProposedBadge: string;
    readonly statusInProgressBadge: string;
    readonly statusFinishedBadge: string;
    readonly municipalityRankHint: (
      score: number,
      maxScore: number,
      municipalityName: string,
    ) => string;
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
    readonly noPhotosYet: string;
    readonly addPhotoCamera: string;
    readonly addPhotoGallery: string;
    readonly uploadingPhoto: string;
    readonly gpsVerifiedBadge: string;
    readonly rateReal: string;
    readonly rateFake: string;
    readonly rateRealA11y: (count: number) => string;
    readonly rateFakeA11y: (count: number) => string;
    readonly flaggedFakeWarning: string;
    readonly revealFlaggedPhoto: string;
    readonly hideFlaggedPhoto: string;
    readonly deletePhoto: string;
    readonly deletePhotoA11y: string;
    readonly photoSignInPrompt: string;
    readonly adminSectionTitle: string;
    readonly statusSelectorLabel: string;
    readonly setStatusProposed: string;
    readonly setStatusInProgress: string;
    readonly setStatusFinished: string;
    readonly markFinishedButton: string;
    readonly markProposedButton: string;
    readonly updatingStatus: string;
    readonly authorSectionTitle: string;
    readonly manageReadonlyHint: string;
    readonly photoErrorFallback: string;
    readonly statusErrorFallback: string;
    readonly entryDateLabel: string;
    readonly creatorSectionLabel: string;
    readonly newContributorBadge: string;
    readonly creatorActivityLabel: string;
    readonly creatorActivityRecent: (days: number) => string;
    readonly creatorActivityInactive: string;
    readonly creatorActivityUnknown: string;
    readonly needsReviewBadge: (count: number) => string;
    readonly flagForReviewButton: string;
    readonly flagForReviewA11y: string;
    readonly removeFlagButton: string;
    readonly removeFlagA11y: string;
    readonly flagReasonPrompt: string;
    readonly flagReasonLabels: Readonly<Record<PolygonFlagReason, string>>;
    readonly submitFlagButton: string;
    readonly submittingFlag: string;
    readonly cancelFlagButton: string;
    readonly clearFlagsAdminButton: (count: number) => string;
    readonly clearingFlags: string;
    readonly flagErrorFallback: string;
    readonly selfVoteDisabledHint: string;
    readonly votingClosedInProgressHint: string;
    readonly votingClosedFinishedHint: string;
    readonly commentsClosedFinishedHint: string;
  };
  readonly auth: {
    readonly modalA11y: string;
    readonly titleRecovery: string;
    readonly titleVerifyPending: string;
    readonly titleRegister: string;
    readonly titleRecover: string;
    readonly titleLogin: string;
    readonly zeroPiiSubtitle: string;
    readonly privacySubtitle: string;
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
    readonly emailLabel: string;
    readonly recoverEmailLabel: string;
    readonly emailA11y: string;
    readonly emailPlaceholder: string;
    readonly identifierLabel: string;
    readonly identifierA11y: string;
    readonly identifierPlaceholder: string;
    readonly privacyConsentA11y: string;
    readonly privacyConsentPrefix: string;
    readonly privacyPolicyLinkText: string;
    readonly termsConsentConnector: string;
    readonly termsLinkText: string;
    readonly verifyPendingBody: (email: string) => string;
    readonly resendVerificationButton: string;
    readonly resendingVerification: string;
    readonly resendVerificationSent: string;
    readonly backToSignIn: string;
    readonly forgotPasswordLink: string;
    readonly forgotPasswordHint: string;
    readonly sendResetLinkButton: string;
    readonly sendingResetLink: string;
    readonly resetLinkSentBanner: (email: string) => string;
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
    readonly adminRoleBadge: string;
    readonly accountEmailLabel: string;
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
    readonly invalidEmail: string;
    readonly privacyConsentRequired: string;
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
    readonly webApproximateLocationNotice: (accuracyKm: number) => string;
    readonly webGenericError: (detail: string) => string;
    readonly webRequestFailed: (detail: string) => string;
    readonly nativePermissionDeniedSettings: string;
    readonly nativePermissionDeniedPrompt: string;
    readonly nativeInvalidCoords: string;
    readonly nativeGenericError: (suffix: string) => string;
  };
  readonly about: {
    readonly modalA11y: string;
    readonly title: string;
    readonly subtitle: string;
    readonly closeA11y: string;
    readonly close: string;
    readonly introBody: string;
    readonly featuresTitle: string;
    readonly featureMapBullet: string;
    readonly featureReviewBullet: string;
    readonly featureControlsBullet: string;
    readonly featureDataBullet: string;
    readonly legendTitle: string;
    readonly legendSupported: string;
    readonly legendNewContested: string;
    readonly legendLifecycle: string;
    readonly footerTitle: string;
    readonly privacyAndLicenseBody: string;
    readonly attributionOsmShort: string;
    readonly attributionDop20Short: string;
    readonly attributionVg250Short: string;
    readonly impressumLinkLabel: string;
    readonly privacyLinkLabel: string;
    readonly termsLinkLabel: string;
    readonly licensesLinkLabel: string;
    readonly sourceCodeLinkLabel: string;
    readonly apkDownloadButton: string;
    readonly installAppButton: string;
  };
  readonly installApp: {
    readonly modalA11y: string;
    readonly title: string;
    readonly subtitle: string;
    readonly closeA11y: string;
    readonly close: string;
    readonly androidPwaTitle: string;
    readonly androidPwaSteps: readonly string[];
    readonly iosPwaTitle: string;
    readonly iosPwaSteps: readonly string[];
    readonly androidApkTitle: string;
    readonly androidApkBody: string;
    readonly apkSha256Label: string;
    readonly apkDownloadButton: string;
  };
  readonly search: {
    readonly modalA11y: string;
    readonly title: string;
    readonly subtitle: string;
    readonly closeA11y: string;
    readonly close: string;
    readonly inputPlaceholder: string;
    readonly inputA11y: string;
    readonly submitButton: string;
    readonly searchingBusy: string;
    readonly minCharsError: string;
    readonly noResults: string;
    readonly attributionNote: string;
    readonly errorFallback: string;
  };
  readonly bugReport: {
    readonly modalA11y: string;
    readonly title: string;
    readonly subtitle: string;
    readonly closeA11y: string;
    readonly close: string;
    readonly descriptionLabel: string;
    readonly descriptionPlaceholder: string;
    readonly descriptionA11y: string;
    readonly contactEmailLabel: string;
    readonly contactEmailPlaceholder: string;
    readonly contactEmailA11y: string;
    readonly submitButton: string;
    readonly submittingBusy: string;
    readonly successTitle: string;
    readonly successBody: string;
    readonly tooShortError: string;
    readonly invalidEmailError: string;
    readonly errorFallback: string;
  };
}

export const TRANSLATIONS: Readonly<Record<Locale, TranslationDictionary>> = {
  de: {
    app: {
      documentTitle: 'Unseal - Gemeinschaftliche Entsiegelungskarte',
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
      legendInProgress: '⟳ Wird entsiegelt',
      legendFinished: '✓ Entsiegelt',
      nativeAttributionOsm:
        '© OpenStreetMap-Mitwirkende (ODbL) · OpenFreeMap · VG250: © GeoBasis-DE / BKG (dl-de/by-2-0)',
      nativeAttributionOrtho:
        'DOP20: © GeoBasis-DE / Landesvermessungsämter (dl-de/by-2-0) · VG250: © BKG',
    },
    controls: {
      signInShort: 'Anmelden',
      inViewSuffix: 'im Ausschnitt',
      subtitleOrthophoto: 'Luftbild (DOP20)',
      subtitleOsm: 'OpenStreetMap-Straßenkarte',
      subtitleRegistry: 'Offenes Entsiegelungsregister',
      osmAttributionShort: '© OpenStreetMap (ODbL) · OpenFreeMap · VG250 © BKG',
      imageryPrefix: 'Bilddaten:',
      switchLocaleA11y: 'Sprache auf Englisch (EN) umstellen',
      aboutButtonA11y: 'Über Unseal, Kartendaten und Datenschutz öffnen',
      bugReportButtonA11y: 'Fehler melden',
      bugReportButtonTooltip: 'Fehler melden',
      searchAddressA11y: 'Adresse suchen und auf der Karte anzeigen',
      apkDownloadA11y: 'Android-App als APK-Datei herunterladen',
      apkDownloadCompact: 'APK',
      apkDownloadFull: 'Android-APK herunterladen',
      apkDownloadErrorFallback: 'Android-APK konnte nicht heruntergeladen werden.',
      installAppA11y: 'Installationshinweise für Web-App (iOS/Android) und Android-APK öffnen',
      installAppFull: 'App installieren (PWA & Android)',
      accountSettingsA11y: (pseudonym) =>
        `Kontoeinstellungen für ${pseudonym}`,
      signInOrRegisterA11y: 'Anmelden oder Konto erstellen',
      switchToOrthoA11y: 'Zur Luftbildansicht wechseln',
      switchToOsmA11y: 'Zur OpenStreetMap-Straßenkarte wechseln',
      aerialCompact: 'Luftbild',
      streetCompact: 'Karte',
      aerialFull: 'Luftbildansicht',
      streetFull: 'Straßenkarte',
      locateA11y: 'Eigenen Standort per GNSS bestimmen',
      gnssA11y: 'Auf meinen GNSS-Standort zentrieren',
      northA11y: 'Karte nach Norden ausrichten',
      locateCompact: 'GPS',
      locateBusy: 'GPS…',
      locateFull: 'Standort',
      exportA11y: 'Alle Vorschläge als GeoJSON exportieren',
      exportCompact: 'GeoJSON',
      exportFull: 'GeoJSON-Export',
      exportErrorFallback: 'GeoJSON-Export konnte nicht geöffnet werden.',
      importA11y: 'Polygone aus GeoJSON oder GeoPackage importieren (Admin)',
      importCompact: 'Import',
      importFull: 'Import (.geojson/.gpkg)',
      importingBusy: 'Import…',
      importSuccess: (imported, skipped) =>
        skipped > 0
          ? `${imported} Flächen importiert (${skipped} übersprungen).`
          : `${imported} Flächen erfolgreich importiert.`,
      importErrorFallback: 'Import fehlgeschlagen.',
      proposeA11y: 'Entsiegelungsfläche auf der Karte einzeichnen',
      proposeCompact: '+ Vorschlag',
      proposeFull: '+ Fläche vorschlagen',
      zoomInPrompt:
        'Bitte näher heranzoomen, um Vorschläge zu sehen und einzutragen',
      filterGroupA11y: 'Flächenfilter (Einzelauswahl)',
      filterAll: 'Alle',
      filterAllA11y: 'Alle Flächen anzeigen',
      filterNewCompact: 'Neu',
      filterNewFull: 'Neu (7 Tage)',
      filterNewA11y: 'Neue Flächen der letzten 7 Tage anzeigen',
      filterEstablishedCompact: 'Etabliert',
      filterEstablishedFull: 'Etabliert',
      filterEstablishedA11y:
        'Etablierte Flächen (alle außer den letzten 7 Tagen) anzeigen',
      filterNeedsReviewCompact: 'Prüfbedarf',
      filterNeedsReviewFull: 'Prüfbedarf',
      filterNeedsReviewA11y:
        'Flächen mit Prüfbedarf (Bewertung 0 und ohne Stimmen) anzeigen',
      polygonOpacityLabel: 'Deckkraft',
      polygonOpacityA11y: 'Deckkraft der Polygone anpassen',
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
        'Fläche geschlossen - Versiegelungsart prüfen & einreichen',
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
        'Geschätzte Fläche liegt nahe an der Grenze (2–20.000 m²); beim Einreichen wird die exakte PostGIS-Ellipsoidfläche geprüft.',
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
      stepGeometryLabel: '1. Umriss',
      stepDetailsLabel: '2. Details',
      nextStep: 'Weiter →',
      nextStepA11y: 'Weiter zu Material, Hinweis und Fotos',
      closeAndNext: 'Schließen & Weiter →',
      backToGeometry: '← Umriss ändern',
      backToGeometryA11y: 'Zurück zur Umrissbearbeitung auf der Karte',
      photosSectionTitle: 'Vor-Ort-Fotos (optional)',
      takePhoto: 'Kamera',
      pickPhoto: 'Galerie',
      removeDraftPhotoA11y: 'Angehängtes Foto entfernen',
      photoPrivacyHint:
        'Alle EXIF-Metadaten werden beim Upload entfernt; bei Aufnahme im Polygon (bis 3 m Toleranz) erscheint „GPS verified“.',
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
      tabOverview: 'Übersicht',
      tabComments: (count) => `Kommentare (${count})`,
      tabPhotos: (count) => `Fotos (${count})`,
      tabManage: 'Verwaltung',
      openCommentsBanner: (count) =>
        count === 1
          ? '1 Kommentar zu dieser Fläche anzeigen →'
          : `${count} Kommentare zu dieser Fläche anzeigen →`,
      topCommentBadge: '★ Top-Kommentar',
      replyingToLabel: (pseudonym) => {
        const displayHandle = pseudonym === 'deleted' ? 'gelöscht' : pseudonym;
        return `Antwort an @${displayHandle}`;
      },
      commentAuthorLabel: (pseudonym, isAuthor) => {
        const displayHandle = pseudonym === 'deleted' ? 'gelöscht' : pseudonym;
        return `@${displayHandle}${isAuthor ? ' · Du' : ''}`;
      },
      commentInputPlaceholder: 'Kommentar zu dieser Fläche schreiben…',
      commentInputA11y: 'Neuer Kommentar zu dieser Fläche',
      replyInputPlaceholder: (pseudonym) => {
        const displayHandle = pseudonym === 'deleted' ? 'gelöscht' : pseudonym;
        return `Antwort an @${displayHandle} schreiben…`;
      },
      postComment: 'Kommentar senden',
      postReply: 'Antwort senden',
      postingComment: 'Sendet…',
      replyButton: 'Antworten',
      cancelReplyButton: 'Abbrechen',
      upvoteCommentA11y: (count) =>
        `Kommentar hochwählen (+1), aktuell ${count} Stimmen`,
      deleteComment: 'Löschen',
      deleteCommentA11y: 'Kommentar löschen',
      noCommentsYet:
        'Noch keine Kommentare zu dieser Fläche. Starte die Diskussion!',
      commentSignInPrompt:
        'Melde dich an, um Flächen zu kommentieren, auf Kommentare zu antworten oder Kommentare hochzuwählen.',
      commentErrorFallback: 'Kommentaraktion fehlgeschlagen.',
      statusProposedBadge: 'Vorgeschlagen',
      statusInProgressBadge: '⟳ Wird entsiegelt',
      statusFinishedBadge: '✓ Entsiegelt',
      municipalityRankHint: (score, maxScore, municipalityName) =>
        `Farbskala relativ zu ${municipalityName} (Score +${score} von max. +${maxScore} vor Ort)`,
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
      noPhotosYet:
        'Noch keine Fotos zu dieser Fläche vorhanden. Hilf mit einer Aufnahme vor Ort!',
      addPhotoCamera: 'Foto aufnehmen',
      addPhotoGallery: 'Aus Galerie',
      uploadingPhoto: 'Lädt hoch…',
      gpsVerifiedBadge: 'GPS verified',
      rateReal: 'Echt',
      rateFake: 'Fake',
      rateRealA11y: (count) =>
        `Foto als echt bestätigen (+1), aktuell ${count} Echt-Stimmen`,
      rateFakeA11y: (count) =>
        `Foto als Fake melden (-1), aktuell ${count} Fake-Meldungen`,
      flaggedFakeWarning:
        'Von der Community als mutmaßlich unecht („Fake“) markiert.',
      revealFlaggedPhoto: 'Trotzdem anzeigen',
      hideFlaggedPhoto: 'Ausblenden',
      deletePhoto: 'Löschen',
      deletePhotoA11y: 'Foto löschen',
      photoSignInPrompt:
        'Melde dich an, um eigene Fotos hochzuladen oder Aufnahmen als „Echt“ / „Fake“ zu bewerten.',
      adminSectionTitle: 'Kommunale / Admin-Verwaltung',
      statusSelectorLabel: 'Flächenstatus setzen:',
      setStatusProposed: 'Vorgeschlagen',
      setStatusInProgress: '⟳ Wird entsiegelt',
      setStatusFinished: '✓ Entsiegelt',
      markFinishedButton: '✓ Als „Entsiegelt“ markieren',
      markProposedButton: 'Auf „Vorgeschlagen“ zurücksetzen',
      updatingStatus: 'Aktualisiert…',
      authorSectionTitle: 'Dein Vorschlag',
      manageReadonlyHint:
        'Nur die erstellende Person kann diesen Vorschlag bearbeiten oder löschen. Administratoren können Flächen als „Wird entsiegelt“ oder „Entsiegelt“ markieren.',
      photoErrorFallback: 'Fotoaktion fehlgeschlagen.',
      statusErrorFallback: 'Status konnte nicht geändert werden.',
      entryDateLabel: 'Eingetragen am',
      creatorSectionLabel: 'Vorgeschlagen von',
      newContributorBadge: 'Neuer Beitragender',
      creatorActivityLabel: 'Aktivität',
      creatorActivityRecent: (days) => `Aktiv in den letzten ${days} Tagen`,
      creatorActivityInactive: 'Länger nicht aktiv',
      creatorActivityUnknown: 'Unbekannt',
      needsReviewBadge: (count) =>
        count > 1 ? `Prüfbedarf (${count})` : 'Prüfbedarf',
      flagForReviewButton: 'Zur Prüfung melden',
      flagForReviewA11y: 'Fläche zur gemeinschaftlichen Prüfung melden',
      removeFlagButton: 'Meldung zurückziehen',
      removeFlagA11y: 'Eigene Prüfmeldung zurückziehen',
      flagReasonPrompt: 'Grund für den Prüfbedarf auswählen:',
      flagReasonLabels: {
        implausible: 'Unplausible Fläche',
        already_unsealed: 'Bereits entsiegelt / Grün',
        duplicate: 'Duplikat / Überlappung',
        spam: 'Spam / Sinnloser Eintrag',
      },
      submitFlagButton: 'Meldung absenden',
      submittingFlag: 'Meldet…',
      cancelFlagButton: 'Abbrechen',
      clearFlagsAdminButton: (count) => `Prüfmeldungen zurücksetzen (${count})`,
      clearingFlags: 'Setzt zurück…',
      flagErrorFallback: 'Prüfmeldung konnte nicht aktualisiert werden.',
      selfVoteDisabledHint:
        'Eigene Vorschläge können nicht selbst bewertet werden.',
      votingClosedInProgressHint:
        'Abstimmung geschlossen – diese Fläche wird bereits entsiegelt.',
      votingClosedFinishedHint:
        'Abstimmung geschlossen – diese Fläche wurde bereits entsiegelt.',
      commentsClosedFinishedHint:
        'Kommentare sind für bereits entsiegelte Flächen geschlossen.',
    },
    auth: {
      modalA11y: 'Benutzerkonto',
      titleRecovery: 'Einmaligen Wiederherstellungscode sichern',
      titleVerifyPending: 'Bestätigungslink gesendet',
      titleRegister: 'Konto registrieren',
      titleRecover: 'Passwort zurücksetzen',
      titleLogin: 'Anmelden',
      zeroPiiSubtitle:
        'Öffentliches Pseudonym · E-Mail nur für Bestätigung & Recovery',
      privacySubtitle:
        'Öffentliches Pseudonym · E-Mail niemals öffentlich sichtbar',
      closeA11y: 'Kontofenster schließen',
      close: 'Schließen',
      tabSignInA11y: 'Tab Anmelden',
      tabSignIn: 'Anmelden',
      tabRegisterA11y: 'Tab Registrieren',
      tabRegister: 'Registrieren',
      tabRecoverA11y: 'Tab Passwort zurücksetzen',
      tabRecover: 'Passwort',
      recoveryVaultHint:
        'Speichere diesen Wiederherstellungscode sicher ab.',
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
      continueA11y: 'Nach dem Speichern fortfahren',
      continueToMap: 'Weiter zur Karte',
      pendingDraftSummary:
        'Dein Flächenentwurf bleibt gespeichert und wird nach der Anmeldung automatisch eingereicht.',
      pendingVoteSummary:
        'Deine Stimme wird nach der Anmeldung automatisch abgegeben.',
      sessionExpired:
        'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      registerHint:
        'Wähle ein öffentliches Pseudonym (3–32 Zeichen) und gib deine E-Mail-Adresse ein. Du erhältst einen Bestätigungslink per E-Mail; deine E-Mail wird niemals öffentlich angezeigt.',
      publicPseudonymLabel: 'Öffentliches Pseudonym',
      pseudonymLabel: 'Pseudonym',
      pseudonymA11y: 'Pseudonym',
      pseudonymPlaceholderRegister: 'z. B. innenhof_initiative',
      pseudonymPlaceholderLogin: 'Pseudonym oder E-Mail',
      emailLabel: 'E-Mail-Adresse (nur für Bestätigung & Recovery)',
      recoverEmailLabel: 'E-Mail-Adresse',
      emailA11y: 'E-Mail-Adresse',
      emailPlaceholder: 'name@beispiel.de',
      identifierLabel: 'Pseudonym oder E-Mail-Adresse',
      identifierA11y: 'Pseudonym oder E-Mail-Adresse',
      identifierPlaceholder: 'Pseudonym oder name@beispiel.de',
      privacyConsentA11y:
        'Ich stimme der Datenschutzerklärung und den Nutzungsbedingungen zu',
      privacyConsentPrefix:
        'Ich stimme der E-Mail-Verarbeitung gemäß ',
      privacyPolicyLinkText: 'Datenschutzerklärung',
      termsConsentConnector: ' sowie den ',
      termsLinkText: 'Nutzungsbedingungen (inkl. CC0 / CC BY 4.0)',
      verifyPendingBody: (email) =>
        `Wir haben einen Bestätigungslink an ${email} gesendet. Bitte klicke auf den Link in deiner E-Mail und melde dich anschließend hier an.`,
      resendVerificationButton: 'Bestätigungslink erneut senden',
      resendingVerification: 'Sendet Link…',
      resendVerificationSent:
        'Neuer Bestätigungslink wurde gesendet. Bitte prüfe auch deinen Spam-Ordner.',
      backToSignIn: 'Zur Anmeldung',
      forgotPasswordLink: 'Passwort vergessen?',
      forgotPasswordHint:
        'Gib deine registrierte E-Mail-Adresse ein. Wir senden dir einen Link, über den du ein neues Passwort vergeben kannst.',
      sendResetLinkButton: 'Wiederherstellungslink senden',
      sendingResetLink: 'Sendet Link…',
      resetLinkSentBanner: (email) =>
        `Falls ein Konto für ${email} existiert, wurde ein Link zum Zurücksetzen des Passworts gesendet.`,
      passwordLabel: 'Passwort',
      passwordA11y: 'Passwort',
      passwordPlaceholderMin: 'Mindestens 8 Zeichen',
      passwordPlaceholderLogin: 'Dein Passwort',
      createAccountA11y: 'Konto erstellen und Bestätigungs-E-Mail anfordern',
      creatingAccount: 'Konto wird erstellt…',
      createAccount: 'Registrieren',
      signInButtonA11y: 'Mit Pseudonym oder E-Mail und Passwort anmelden',
      signingIn: 'Anmeldung läuft…',
      signInButton: 'Anmelden',
      recoverHint:
        'Gib deine registrierte E-Mail-Adresse ein, um einen Link zum Zurücksetzen deines Passworts zu erhalten.',
      recoveryCodeLabel: '32-stelliger Wiederherstellungscode',
      recoveryCodeA11y: '32-stelliger Wiederherstellungscode',
      newPasswordLabel: 'Neues Passwort',
      newPasswordA11y: 'Neues Passwort',
      resetPasswordA11y: 'Wiederherstellungslink per E-Mail anfordern',
      resettingPassword: 'Sendet Link…',
      resetPassword: 'Link zum Zurücksetzen senden',
      accountSignedInHint: (pseudonym) =>
        `Angemeldet als @${pseudonym}. Auf der Karte und im GeoJSON-Export erscheint ausschließlich dein Pseudonym.`,
      adminRoleBadge: 'Administrator',
      accountEmailLabel: 'Bestätigte E-Mail:',
      logoutA11y: 'Aus aktueller Sitzung abmelden',
      loggingOut: 'Abmeldung läuft…',
      logout: 'Abmelden',
      deleteAccountWarning:
        'Das Löschen deines Kontos entfernt dauerhaft deine E-Mail-Adresse, Zugangsdaten, Sitzungen und Stimmen (Art. 17 DSGVO), sperrt dein Pseudonym gegen Nachahmung und erhält deine eingereichten Flächen und Kommentare anonym unter „gelöscht“.',
      cancelDeleteAccountA11y: 'Kontolöschung abbrechen',
      cancel: 'Abbrechen',
      confirmDeleteAccountA11y: 'Endgültige Kontolöschung bestätigen',
      deletingAccount: 'Wird gelöscht…',
      confirmDeleteAccount: 'Konto endgültig löschen',
      deleteAccountA11y: 'Konto löschen',
      deleteAccount: 'Konto löschen',
      invalidPseudonym:
        'Das Pseudonym muss 3–32 Zeichen lang sein (Buchstaben, Ziffern, Unterstrich _ oder Bindestrich -).',
      invalidEmail: 'Bitte gib eine gültige E-Mail-Adresse ein.',
      privacyConsentRequired:
        'Bitte bestätige Datenschutzerklärung und Nutzungsbedingungen, um fortzufahren.',
      shortPassword: (min) =>
        `Das Passwort muss mindestens ${min} Zeichen lang sein.`,
      missingCredentials:
        'Bitte Pseudonym (oder E-Mail) und Passwort eingeben.',
      missingRecoveryFields: (min) =>
        `Bitte gültige Eingaben machen (Passwort mind. ${min} Zeichen).`,
      registerFailed: 'Registrierung fehlgeschlagen.',
      loginFailed: 'Anmeldung fehlgeschlagen.',
      recoverFailed: 'Anfrage zum Zurücksetzen fehlgeschlagen.',
      logoutFailed: 'Abmeldung fehlgeschlagen.',
      deleteAccountFailed: 'Kontolöschung fehlgeschlagen.',
    },
    location: {
      webHttpsRequired:
        'Die Browser-Standortbestimmung erfordert eine sichere HTTPS-Verbindung (oder localhost). Öffne Unseal über https://, um „Standort“ zu nutzen.',
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
      webApproximateLocationNotice: (accuracyKm) =>
        `Dein Browser hat nur einen ungefähren Netzwerk-/IP-Standort (±${accuracyKm} km, oft am Netzknoten des Internetanbieters) geliefert. Für deinen exakten Standort bitte WLAN/Ortungsdienste und „Genauer Standort“ im Browser aktivieren.`,
      webGenericError: (detail) =>
        detail.length > 0
          ? `Aktueller Standort konnte nicht ermittelt werden: ${detail}`
          : 'Aktueller Standort konnte nicht ermittelt werden.',
      webRequestFailed: (detail) =>
        `Standortabfrage im Browser fehlgeschlagen${detail}`,
      nativePermissionDeniedSettings:
        'Standortberechtigung verweigert. Bitte aktiviere den Standortzugriff für Unseal in den Geräteeinstellungen.',
      nativePermissionDeniedPrompt:
        'Standortberechtigung verweigert. Bitte erlaube den Standortzugriff, um die Karte auf deine GPS-Position zu zentrieren.',
      nativeInvalidCoords:
        'Der Standortdienst des Geräts hat ungültige GPS-Koordinaten geliefert.',
      nativeGenericError: (suffix) =>
        `Aktuelle GPS-Position konnte nicht bestimmt werden. Bitte prüfe, ob die Ortungsdienste aktiviert sind.${suffix}`,
    },
    about: {
      modalA11y: 'Über Unseal',
      title: 'Über Unseal',
      subtitle: 'Offene Entsiegelungskartierung (PPGIS)',
      closeA11y: 'Infofenster schließen',
      close: 'Schließen',
      introBody:
        'Unverbindliche Bürgervorschläge zur Flächenentsiegelung - unabhängig von Eigentumsverhältnissen.',
      featuresTitle: 'Funktionen im Überblick',
      featureMapBullet:
        'Kartieren & Fotos: Flächen in 2 Schritten umreißen, Belag wählen, Vor-Ort-Fotos anhängen (EXIF entfernt, „GPS verified“ im 3-m-Puffer) und kommentieren.',
      featureReviewBullet:
        'Bewerten & Prüfen: Vorschläge mit +1/−1 gewichten, Fotos als Echt/Fake einstufen oder Unstimmigkeiten zur Prüfung melden.',
      featureControlsBullet:
        'Ansicht & Filter: Straßenkarte/Luftbild (DOP20), stufenloser Deckkraft-Regler sowie Einzelauswahl-Filter (Alle, Neu: letzte 7 Tage, Etabliert: älter als 7 Tage, Prüfbedarf: Bewertung 0 ohne Stimmen).',
      featureDataBullet:
        'Offene Geodaten: Ein-Klick-GeoJSON-Export (sowie .geojson/.gpkg-Import für Admins).',
      legendTitle: 'Farben & Status',
      legendSupported:
        '+ Unterstützt: Positiver Saldo (Grünton skaliert am Gemeindehöchstwert)',
      legendNewContested:
        '0 Neu / − Umstritten: Unbewertet (orange) bzw. negativer Saldo (rot)',
      legendLifecycle:
        '⟳ Wird entsiegelt / ✓ Entsiegelt: Im Rückbau (blau) bzw. umgesetzt (türkis)',
      footerTitle: 'Datenschutz, Rechtliches & App',
      privacyAndLicenseBody:
        'Öffentlich erscheint nur dein Pseudonym; E-Mails dienen nur Bestätigung & Recovery (jederzeit nach Art. 17 DSGVO löschbar). Beiträge: CC0 1.0 (Geometrien/Notizen) & CC BY 4.0 (Fotos/Kommentare). Software: AGPL-3.0 (API) & MPL-2.0 (App).',
      attributionOsmShort: '© OpenStreetMap / OpenFreeMap (ODbL)',
      attributionDop20Short: 'DOP20 © Länder (dl-de/by-2-0)',
      attributionVg250Short: 'VG250 © BKG (dl-de/by-2-0)',
      impressumLinkLabel: 'Impressum',
      privacyLinkLabel: 'Datenschutz',
      termsLinkLabel: 'Nutzungsbedingungen',
      licensesLinkLabel: 'OSS-Lizenzen',
      sourceCodeLinkLabel: 'Quellcode',
      apkDownloadButton: 'Android-APK herunterladen',
      installAppButton: 'App installieren',
    },
    search: {
      modalA11y: 'Adresssuche',
      title: 'Adresse suchen',
      subtitle: 'Straßenname, Hausnummer oder Ort eingeben',
      closeA11y: 'Adresssuche schließen',
      close: 'Schließen',
      inputPlaceholder: 'z. B. Domstraße 12, Mainz',
      inputA11y: 'Adresse oder Ort suchen',
      submitButton: 'Suchen',
      searchingBusy: 'Sucht…',
      minCharsError: 'Bitte mindestens 2 Zeichen eingeben.',
      noResults: 'Keine passenden Adressen gefunden.',
      attributionNote: 'Geocodierung via OpenStreetMap Nominatim (ODbL)',
      errorFallback: 'Adresssuche momentan nicht verfügbar.',
    },
    bugReport: {
      modalA11y: 'Fehler melden',
      title: 'Fehler melden',
      subtitle:
        'Deine Meldung wird per E-Mail an die Betreiberstelle dieser Unseal-Instanz gesendet.',
      closeA11y: 'Fehlermeldung schließen',
      close: 'Schließen',
      descriptionLabel: 'Was ist passiert?',
      descriptionPlaceholder:
        'Beschreibe kurz den Fehler und wie er aufgetreten ist…',
      descriptionA11y: 'Fehlerbeschreibung',
      contactEmailLabel: 'Deine E-Mail für Rückfragen (optional)',
      contactEmailPlaceholder: 'name@beispiel.de (optional)',
      contactEmailA11y: 'Optionale Kontakt-E-Mail',
      submitButton: 'Fehlermeldung senden',
      submittingBusy: 'Sendet…',
      successTitle: 'Vielen Dank!',
      successBody:
        'Deine Fehlermeldung wurde an die Betreiberstelle übermittelt.',
      tooShortError:
        'Bitte beschreibe den Fehler mit mindestens 5 Zeichen.',
      invalidEmailError: 'Bitte gib eine gültige E-Mail-Adresse ein oder lasse das Feld leer.',
      errorFallback: 'Fehlermeldung konnte nicht gesendet werden.',
    },
    installApp: {
      modalA11y: 'Unseal als App installieren',
      title: 'Unseal installieren',
      subtitle:
        'Nutze die Web-App direkt auf deinem Startbildschirm (PWA) oder lade die Android-APK herunter.',
      closeA11y: 'Installationsdialog schließen',
      close: 'Schließen',
      androidPwaTitle: 'Android: Browser-App (PWA) installieren',
      androidPwaSteps: [
        'Öffne Unseal in Chrome (oder einem anderen Chromium-Browser wie Edge oder Brave).',
        'Tippe oben rechts auf das Menü (⋮) und wähle „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.',
        'Bestätige mit „Installieren“ — danach startet Unseal im Vollbild wie eine eigene App.',
      ],
      iosPwaTitle: 'iOS (iPhone / iPad): Browser-App (PWA) installieren',
      iosPwaSteps: [
        'Öffne Unseal in Safari.',
        'Tippe auf das Teilen-Symbol (Quadrat mit Pfeil nach oben in der Browser-Leiste).',
        'Scrolle nach unten, wähle „Zum Home-Bildschirm“ und bestätige mit „Hinzufügen“.',
      ],
      androidApkTitle: 'Android: Direkter APK-Download',
      androidApkBody:
        'Alternativ zur Browser-App kannst du die Android-App direkt als APK-Datei installieren (Android fragt ggf. nach der Erlaubnis zum Installieren über deinen Browser).',
      apkSha256Label: 'SHA-256-Prüfsumme:',
      apkDownloadButton: 'Android-APK herunterladen',
    },
  },
  en: {
    app: {
      documentTitle: 'Unseal - Civic Unsealing Map',
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
      legendInProgress: '⟳ In progress',
      legendFinished: '✓ Finished',
      nativeAttributionOsm:
        '© OpenStreetMap contributors (ODbL) · OpenFreeMap · VG250: © GeoBasis-DE / BKG (dl-de/by-2-0)',
      nativeAttributionOrtho:
        'DOP20: © GeoBasis-DE / State Survey Offices (dl-de/by-2-0) · VG250: © BKG',
    },
    controls: {
      signInShort: 'Sign in',
      inViewSuffix: 'in view',
      subtitleOrthophoto: 'Aerial Orthophoto (DOP20)',
      subtitleOsm: 'OpenStreetMap Street Layer',
      subtitleRegistry: 'Open civic unsealing registry',
      osmAttributionShort: '© OpenStreetMap (ODbL) · OpenFreeMap · VG250 © BKG',
      imageryPrefix: 'Imagery:',
      switchLocaleA11y: 'Switch language to German (DE)',
      aboutButtonA11y: 'Open About Unseal, map attributions, and privacy',
      bugReportButtonA11y: 'Report a bug',
      bugReportButtonTooltip: 'Report a bug',
      searchAddressA11y: 'Search for an address and jump to it on the map',
      apkDownloadA11y: 'Download Android APK package',
      apkDownloadCompact: 'APK',
      apkDownloadFull: 'Download Android APK',
      apkDownloadErrorFallback: 'Unable to start Android APK download.',
      installAppA11y: 'Open installation guide for web app (iOS/Android) and Android APK',
      installAppFull: 'Install App (PWA & Android)',
      accountSettingsA11y: (pseudonym) => `Account settings for ${pseudonym}`,
      signInOrRegisterA11y: 'Sign in or register account',
      switchToOrthoA11y: 'Switch to aerial orthophoto layer',
      switchToOsmA11y: 'Switch to OpenStreetMap street layer',
      aerialCompact: 'Aerial',
      streetCompact: 'Street',
      aerialFull: 'Aerial View',
      streetFull: 'Street Map',
      locateA11y: 'Locate me using device GNSS',
      gnssA11y: 'Center map on my GNSS position',
      northA11y: 'Orient map to north',
      locateCompact: 'GPS',
      locateBusy: 'GPS…',
      locateFull: 'Locate Me',
      exportA11y: 'Export all proposals as GeoJSON',
      exportCompact: 'GeoJSON',
      exportFull: 'Export GeoJSON',
      exportErrorFallback: 'Unable to open GeoJSON export URL.',
      importA11y: 'Import polygons from GeoJSON or GeoPackage (Admin)',
      importCompact: 'Import',
      importFull: 'Import (.geojson/.gpkg)',
      importingBusy: 'Importing…',
      importSuccess: (imported, skipped) =>
        skipped > 0
          ? `Imported ${imported} polygons (${skipped} skipped).`
          : `Successfully imported ${imported} polygons.`,
      importErrorFallback: 'Polygon import failed.',
      proposeA11y: 'Draw unsealing proposal polygon',
      proposeCompact: '+ Propose',
      proposeFull: '+ Propose Unsealing',
      zoomInPrompt: 'Zoom in to view and add proposals',
      filterGroupA11y: 'Polygon filter (single choice)',
      filterAll: 'All',
      filterAllA11y: 'Show all polygons',
      filterNewCompact: 'New',
      filterNewFull: 'New (7d)',
      filterNewA11y: 'Show new polygons from the past 7 days',
      filterEstablishedCompact: 'Established',
      filterEstablishedFull: 'Established',
      filterEstablishedA11y:
        'Show established polygons (all except past 7 days)',
      filterNeedsReviewCompact: 'Needs review',
      filterNeedsReviewFull: 'Needs review',
      filterNeedsReviewA11y:
        'Show polygons needing review (score of 0 and no ratings)',
      polygonOpacityLabel: 'Opacity',
      polygonOpacityA11y: 'Adjust polygon opacity',
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
      statusClosed: 'Shape closed - review surface type & publish',
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
        'Estimated area is close to the allowed range (2–20,000 m²); exact PostGIS ellipsoid area is verified on submit.',
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
      stepGeometryLabel: '1. Outline',
      stepDetailsLabel: '2. Details',
      nextStep: 'Next →',
      nextStepA11y: 'Continue to surface material, note, and photos',
      closeAndNext: 'Close & Next →',
      backToGeometry: '← Edit Outline',
      backToGeometryA11y: 'Return to outline editing on the map',
      photosSectionTitle: 'Site Photos (Optional)',
      takePhoto: 'Camera',
      pickPhoto: 'Gallery',
      removeDraftPhotoA11y: 'Remove attached photo',
      photoPrivacyHint:
        'All EXIF metadata is stripped on upload; captures inside the polygon (3 m tolerance) earn a “GPS verified” badge.',
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
      tabOverview: 'Overview',
      tabComments: (count) => `Comments (${count})`,
      tabPhotos: (count) => `Photos (${count})`,
      tabManage: 'Manage',
      openCommentsBanner: (count) =>
        count === 1
          ? 'View 1 comment on this site →'
          : `View ${count} comments on this site →`,
      topCommentBadge: '★ Top comment',
      replyingToLabel: (pseudonym) => `Reply to @${pseudonym}`,
      commentAuthorLabel: (pseudonym, isAuthor) =>
        `@${pseudonym}${isAuthor ? ' · You' : ''}`,
      commentInputPlaceholder: 'Write a comment about this site…',
      commentInputA11y: 'New comment on this site',
      replyInputPlaceholder: (pseudonym) => `Write a reply to @${pseudonym}…`,
      postComment: 'Post Comment',
      postReply: 'Post Reply',
      postingComment: 'Posting…',
      replyButton: 'Reply',
      cancelReplyButton: 'Cancel',
      upvoteCommentA11y: (count) =>
        `Upvote comment (+1), current upvotes ${count}`,
      deleteComment: 'Delete',
      deleteCommentA11y: 'Delete comment',
      noCommentsYet:
        'No comments on this site yet. Start the discussion!',
      commentSignInPrompt:
        'Sign in to comment on sites, reply to other comments, or upvote comments.',
      commentErrorFallback: 'Comment action failed.',
      statusProposedBadge: 'Proposed',
      statusInProgressBadge: '⟳ In progress',
      statusFinishedBadge: '✓ Finished',
      municipalityRankHint: (score, maxScore, municipalityName) =>
        `Color scaled within ${municipalityName} (score +${score} of +${maxScore} local max)`,
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
      noPhotosYet:
        'No photos uploaded for this polygon yet. Add an on-site photo to help verify it!',
      addPhotoCamera: 'Take Photo',
      addPhotoGallery: 'From Gallery',
      uploadingPhoto: 'Uploading…',
      gpsVerifiedBadge: 'GPS verified',
      rateReal: 'Real',
      rateFake: 'Fake',
      rateRealA11y: (count) =>
        `Mark photo as real (+1), current real votes ${count}`,
      rateFakeA11y: (count) =>
        `Flag photo as fake (-1), current fake flags ${count}`,
      flaggedFakeWarning:
        'Flagged by the community as likely inauthentic (“Fake”).',
      revealFlaggedPhoto: 'Show anyway',
      hideFlaggedPhoto: 'Hide photo',
      deletePhoto: 'Delete',
      deletePhotoA11y: 'Delete photo',
      photoSignInPrompt:
        'Sign in to upload photos or rate existing photos as “Real” or “Fake”.',
      adminSectionTitle: 'Municipal / Admin Actions',
      statusSelectorLabel: 'Set site status:',
      setStatusProposed: 'Proposed',
      setStatusInProgress: '⟳ In progress',
      setStatusFinished: '✓ Finished',
      markFinishedButton: '✓ Mark as “Finished”',
      markProposedButton: 'Reset to “Proposed”',
      updatingStatus: 'Updating…',
      authorSectionTitle: 'Your Proposal',
      manageReadonlyHint:
        'Only the creator can edit or delete this proposal. Administrators can mark sites as “In progress” or “Finished”.',
      photoErrorFallback: 'Photo action failed.',
      statusErrorFallback: 'Unable to update polygon status.',
      entryDateLabel: 'Submitted on',
      creatorSectionLabel: 'Proposed by',
      newContributorBadge: 'New contributor',
      creatorActivityLabel: 'Activity',
      creatorActivityRecent: (days) => `Active in the last ${days} days`,
      creatorActivityInactive: 'Not active recently',
      creatorActivityUnknown: 'Unknown',
      needsReviewBadge: (count) =>
        count > 1 ? `Needs review (${count})` : 'Needs review',
      flagForReviewButton: 'Flag for review',
      flagForReviewA11y: 'Flag site for community review',
      removeFlagButton: 'Remove flag',
      removeFlagA11y: 'Remove your review flag',
      flagReasonPrompt: 'Select reason for review:',
      flagReasonLabels: {
        implausible: 'Implausible site',
        already_unsealed: 'Already unsealed / green',
        duplicate: 'Duplicate / overlap',
        spam: 'Spam / senseless entry',
      },
      submitFlagButton: 'Submit flag',
      submittingFlag: 'Flagging…',
      cancelFlagButton: 'Cancel',
      clearFlagsAdminButton: (count) => `Clear review flags (${count})`,
      clearingFlags: 'Clearing…',
      flagErrorFallback: 'Unable to update review flag.',
      selfVoteDisabledHint: 'You cannot vote on your own proposal.',
      votingClosedInProgressHint:
        'Voting closed — unsealing is already in progress for this area.',
      votingClosedFinishedHint:
        'Voting closed — this area has already been unsealed.',
      commentsClosedFinishedHint:
        'Comments are closed for finished areas.',
    },
    auth: {
      modalA11y: 'Contributor account modal',
      titleRecovery: 'Save One-Time Recovery Code',
      titleVerifyPending: 'Confirmation Link Sent',
      titleRegister: 'Create Account',
      titleRecover: 'Reset Password',
      titleLogin: 'Contributor Sign In',
      zeroPiiSubtitle:
        'Public pseudonym · Email used only for confirmation & recovery',
      privacySubtitle:
        'Public pseudonym · Email is never displayed publicly',
      closeA11y: 'Close account modal',
      close: 'Close',
      tabSignInA11y: 'Sign In tab',
      tabSignIn: 'Sign In',
      tabRegisterA11y: 'Register tab',
      tabRegister: 'Register',
      tabRecoverA11y: 'Recover password tab',
      tabRecover: 'Reset',
      recoveryVaultHint:
        'Store this recovery code in a safe place.',
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
        'Choose a public pseudonym (3–32 characters) and enter your email address. We will send you a confirmation link; your email is never shown publicly.',
      publicPseudonymLabel: 'Public Pseudonym',
      pseudonymLabel: 'Pseudonym',
      pseudonymA11y: 'Pseudonym',
      pseudonymPlaceholderRegister: 'e.g. courtyard_mapper',
      pseudonymPlaceholderLogin: 'Pseudonym or email',
      emailLabel: 'Email Address (confirmation & recovery only)',
      recoverEmailLabel: 'Email Address',
      emailA11y: 'Email address',
      emailPlaceholder: 'name@example.org',
      identifierLabel: 'Pseudonym or Email Address',
      identifierA11y: 'Pseudonym or email address',
      identifierPlaceholder: 'Pseudonym or name@example.org',
      privacyConsentA11y: 'I agree to the Privacy Policy and Terms of Use',
      privacyConsentPrefix:
        'I consent to email processing under the ',
      privacyPolicyLinkText: 'Privacy Policy',
      termsConsentConnector: ' and accept the ',
      termsLinkText: 'Terms of Use (incl. CC0 / CC BY 4.0)',
      verifyPendingBody: (email) =>
        `We sent a confirmation link to ${email}. Click the link in your email, then return here to sign in.`,
      resendVerificationButton: 'Resend Confirmation Link',
      resendingVerification: 'Sending…',
      resendVerificationSent:
        'A fresh confirmation link has been sent. Please check your inbox and spam folder.',
      backToSignIn: 'Back to Sign In',
      forgotPasswordLink: 'Forgot password?',
      forgotPasswordHint:
        'Enter your registered email address and we will send you a one-click password reset link.',
      sendResetLinkButton: 'Send Recovery Link',
      sendingResetLink: 'Sending…',
      resetLinkSentBanner: (email) =>
        `If an account exists for ${email}, a password reset link has been sent.`,
      passwordLabel: 'Password',
      passwordA11y: 'Password',
      passwordPlaceholderMin: 'At least 8 characters',
      passwordPlaceholderLogin: 'Your password',
      createAccountA11y: 'Create account and send confirmation email',
      creatingAccount: 'Creating Account…',
      createAccount: 'Create Account',
      signInButtonA11y: 'Sign in with pseudonym or email and password',
      signingIn: 'Signing In…',
      signInButton: 'Sign In',
      recoverHint:
        'Enter your registered email address to receive a password recovery link.',
      recoveryCodeLabel: '32-Hex Recovery Code',
      recoveryCodeA11y: '32-hex recovery code',
      newPasswordLabel: 'New Password',
      newPasswordA11y: 'New password',
      resetPasswordA11y: 'Send password recovery email link',
      resettingPassword: 'Sending…',
      resetPassword: 'Send Recovery Link',
      accountSignedInHint: (pseudonym) =>
        `Signed in as @${pseudonym}. Only your pseudonym appears publicly on polygons, photos, and GeoJSON exports.`,
      adminRoleBadge: 'Administrator',
      accountEmailLabel: 'Verified email:',
      logoutA11y: 'Log out of current session',
      loggingOut: 'Signing Out…',
      logout: 'Log Out',
      deleteAccountWarning:
        'Deleting your account permanently erases your email address, credentials, active sessions, and votes (GDPR Art. 17), reserves a cryptographic tombstone of your pseudonym to prevent impersonation, and keeps your authored proposals and comments public under “deleted”.',
      cancelDeleteAccountA11y: 'Cancel account deletion',
      cancel: 'Cancel',
      confirmDeleteAccountA11y: 'Confirm permanent account deletion',
      deletingAccount: 'Deleting…',
      confirmDeleteAccount: 'Confirm Delete Account',
      deleteAccountA11y: 'Delete account',
      deleteAccount: 'Delete Account',
      invalidPseudonym:
        'Pseudonym must be 3–32 characters using letters, digits, underscores (_), or hyphens (-).',
      invalidEmail: 'Please enter a valid email address.',
      privacyConsentRequired:
        'Please accept the Privacy Policy and Terms of Use to continue.',
      shortPassword: (min) => `Password must be at least ${min} characters.`,
      missingCredentials: 'Enter your pseudonym (or email) and password.',
      missingRecoveryFields: (min) =>
        `Please enter valid recovery details (password at least ${min} characters).`,
      registerFailed: 'Registration failed.',
      loginFailed: 'Sign-in failed.',
      recoverFailed: 'Password recovery request failed.',
      logoutFailed: 'Logout failed.',
      deleteAccountFailed: 'Account deletion failed.',
    },
    location: {
      webHttpsRequired:
        'Browser geolocation requires a secure HTTPS connection (or localhost). Open Unseal over https:// to use "Locate me".',
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
      webApproximateLocationNotice: (accuracyKm) =>
        `Your browser only provided an approximate network/IP location (±${accuracyKm} km, often at your ISP’s regional hub). Enable Wi-Fi / location services and “Precise location” in your browser for your exact position.`,
      webGenericError: (detail) =>
        detail.length > 0
          ? `Unable to retrieve your current location: ${detail}`
          : 'Unable to retrieve your current location.',
      webRequestFailed: (detail) =>
        `Unable to request browser geolocation${detail}`,
      nativePermissionDeniedSettings:
        'Location permission was denied. Enable foreground location access for Unseal in your device settings to center the map on your GPS position.',
      nativePermissionDeniedPrompt:
        'Location permission was denied. Grant foreground location access to center the map on your current GPS position.',
      nativeInvalidCoords:
        'Device location provider returned invalid GPS coordinates.',
      nativeGenericError: (suffix) =>
        `Unable to determine your current GPS position. Ensure device location services are enabled and try again.${suffix}`,
    },
    about: {
      modalA11y: 'About Unseal',
      title: 'About Unseal',
      subtitle: 'Open Civic Ground-Unsealing Map (PPGIS)',
      closeA11y: 'Close About dialog',
      close: 'Close',
      introBody:
        'Non-binding public unsealing suggestions — regardless of property ownership.',
      featuresTitle: 'Key Features',
      featureMapBullet:
        'Map & document: Outline sites in 2 steps, pick surface material, attach on-site photos (EXIF stripped, “GPS verified” within 3 m), and comment.',
      featureReviewBullet:
        'Vote & review: Score proposals +1/−1, rate photos Real/Fake, or flag questionable entries for community review.',
      featureControlsBullet:
        'View & filters: Street/DOP20 aerial toggle, dynamic polygon opacity slider, plus single-choice filters (All, New: past 7 days, Established: older than 7 days, Needs review: score 0 with no ratings).',
      featureDataBullet:
        'Open geodata: One-click GeoJSON export (plus .geojson/.gpkg import for admins).',
      legendTitle: 'Colors & Status',
      legendSupported:
        '+ Backed: Positive net score (green scaled to municipal maximum)',
      legendNewContested:
        '0 New / − Contested: Unrated (amber) or negative score (red)',
      legendLifecycle:
        '⟳ In progress / ✓ Finished: Active depaving (blue) or completed (mint)',
      footerTitle: 'Privacy, Legal & App',
      privacyAndLicenseBody:
        'Only your pseudonym is public; emails are used strictly for confirmation & recovery (erasable anytime under GDPR Art. 17). Contributions: CC0 1.0 (geometries/notes) & CC BY 4.0 (photos/comments). Code: AGPL-3.0 (API) & MPL-2.0 (App).',
      attributionOsmShort: '© OpenStreetMap / OpenFreeMap (ODbL)',
      attributionDop20Short: 'DOP20 © State Surveys (dl-de/by-2-0)',
      attributionVg250Short: 'VG250 © BKG (dl-de/by-2-0)',
      impressumLinkLabel: 'Impressum',
      privacyLinkLabel: 'Privacy Policy',
      termsLinkLabel: 'Terms of Use',
      licensesLinkLabel: 'OSS Licenses',
      sourceCodeLinkLabel: 'Source Code',
      apkDownloadButton: 'Download Android APK',
      installAppButton: 'Install App',
    },
    search: {
      modalA11y: 'Address search',
      title: 'Search Address',
      subtitle: 'Enter a street, house number, or place',
      closeA11y: 'Close address search',
      close: 'Close',
      inputPlaceholder: 'e.g. Domstraße 12, Mainz',
      inputA11y: 'Search address or place',
      submitButton: 'Search',
      searchingBusy: 'Searching…',
      minCharsError: 'Please enter at least 2 characters.',
      noResults: 'No matching addresses found.',
      attributionNote: 'Geocoding powered by OpenStreetMap Nominatim (ODbL)',
      errorFallback: 'Address search is temporarily unavailable.',
    },
    bugReport: {
      modalA11y: 'Report a bug',
      title: 'Report a Bug',
      subtitle: 'Your report will be emailed to the operator of this Unseal instance.',
      closeA11y: 'Close bug report dialog',
      close: 'Close',
      descriptionLabel: 'What went wrong?',
      descriptionPlaceholder:
        'Briefly describe the issue and how to reproduce it…',
      descriptionA11y: 'Bug description',
      contactEmailLabel: 'Your email for follow-up (optional)',
      contactEmailPlaceholder: 'name@example.org (optional)',
      contactEmailA11y: 'Optional contact email',
      submitButton: 'Send Bug Report',
      submittingBusy: 'Sending…',
      successTitle: 'Thank you!',
      successBody:
        'Your bug report has been sent to the instance operator.',
      tooShortError: 'Please describe the bug in at least 5 characters.',
      invalidEmailError: 'Please enter a valid email address or leave it blank.',
      errorFallback: 'Could not send bug report.',
    },
    installApp: {
      modalA11y: 'Install Unseal app',
      title: 'Install Unseal',
      subtitle:
        'Add the web app (PWA) to your home screen on iOS or Android, or download the Android APK directly.',
      closeA11y: 'Close install instructions dialog',
      close: 'Close',
      androidPwaTitle: 'Android: Install Browser App (PWA)',
      androidPwaSteps: [
        'Open Unseal in Chrome (or a Chromium-based browser such as Edge or Brave).',
        'Tap the menu (⋮) in the top-right corner and select “Add to Home screen” or “Install app”.',
        'Confirm with “Install” — Unseal will launch full-screen from your home screen.',
      ],
      iosPwaTitle: 'iOS (iPhone / iPad): Install Browser App (PWA)',
      iosPwaSteps: [
        'Open Unseal in Safari.',
        'Tap the Share button (the square with an upward arrow in the toolbar).',
        'Scroll down, tap “Add to Home Screen”, and confirm with “Add”.',
      ],
      androidApkTitle: 'Android: Direct APK Download',
      androidApkBody:
        'As an alternative to the browser app, Android users can download and install the APK package directly (Android may prompt you to allow installs from your browser).',
      apkSha256Label: 'SHA-256 checksum:',
      apkDownloadButton: 'Download Android APK',
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
  const compactnessMatch =
    /^Polygon shape is too thin or irregular \(compactness ([0-9.]+) is below ([0-9.]+)\)\.$/.exec(
      msg,
    );
  if (compactnessMatch?.[1] && compactnessMatch[2]) {
    return `Die Polygonform ist zu schmal oder ausgefranst (Kompaktheit ${compactnessMatch[1]} liegt unter ${compactnessMatch[2]}).`;
  }
  const narrowMatch =
    /^Polygon is too narrow \(minimum width must exceed ([0-9.]+) m\)\.$/.exec(
      msg,
    );
  if (narrowMatch?.[1]) {
    return `Das Polygon ist zu schmal (Mindestbreite muss über ${narrowMatch[1]} m liegen).`;
  }
  const noteLenMatch = /^Note must be at most (\d+) characters\.$/.exec(msg);
  if (noteLenMatch?.[1]) {
    return `Der Standorthinweis darf höchstens ${noteLenMatch[1]} Zeichen lang sein.`;
  }
  const commentLenMatch =
    /^Comment body must be between 1 and (\d+) characters\.$/.exec(msg);
  if (commentLenMatch?.[1]) {
    return `Der Kommentar muss zwischen 1 und ${commentLenMatch[1]} Zeichen lang sein.`;
  }
  const maxCommentsMatch =
    /^Maximum of (\d+) comments per polygon reached\.$/.exec(msg);
  if (maxCommentsMatch?.[1]) {
    return `Das Maximum von ${maxCommentsMatch[1]} Kommentaren für diese Fläche wurde erreicht.`;
  }
  const maxReplyDepthMatch =
    /^Maximum reply nesting depth of (\d+) reached\.$/.exec(msg);
  if (maxReplyDepthMatch?.[1]) {
    return `Die maximale Antworttiefe von ${maxReplyDepthMatch[1]} Ebenen wurde erreicht.`;
  }
  return msg;
}

const GERMAN_API_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: 'Bitte melde dich an, um fortzufahren.',
  AUTH_INVALID_CREDENTIALS: 'Ungültiges Pseudonym, E-Mail oder Passwort.',
  AUTH_PSEUDONYM_TAKEN: 'Dieses Pseudonym ist bereits vergeben oder reserviert.',
  AUTH_EMAIL_TAKEN: 'Diese E-Mail-Adresse ist bereits registriert.',
  AUTH_EMAIL_UNVERIFIED:
    'Bitte bestätige zuerst deine E-Mail-Adresse über den zugesandten Bestätigungslink.',
  AUTH_DISPOSABLE_EMAIL:
    'Wegwerf-E-Mail-Adressen sind für die Registrierung nicht zugelassen.',
  AUTH_CAPTCHA_REQUIRED:
    'Bitte führe die automatische Sicherheitsprüfung für die Registrierung durch.',
  AUTH_CAPTCHA_INVALID:
    'Die Sicherheitsprüfung ist ungültig oder abgelaufen. Bitte erneut versuchen.',
  AUTH_TOKEN_INVALID:
    'Dieser Bestätigungs- oder Wiederherstellungslink ist ungültig oder abgelaufen.',
  FORBIDDEN_PSEUDONYM_BANNED: 'Dieses Pseudonym oder diese E-Mail ist gesperrt.',
  AUTH_RECOVERY_INVALID:
    'Ungültige Wiederherstellungsangaben.',
  AUTH_BUSY:
    'Anmeldedienst ist ausgelastet. Bitte kurz warten und erneut versuchen.',
  FORBIDDEN_NOT_AUTHOR:
    'Nur die erstellende Person kann diesen Eintrag bearbeiten oder löschen.',
  FORBIDDEN_SELF_FLAG:
    'Eigene Vorschläge können nicht selbst zur Prüfung gemeldet werden.',
  FORBIDDEN_SELF_VOTE:
    'Eigene Vorschläge und Kommentare können nicht selbst bewertet werden.',
  FORBIDDEN_ADMIN_ONLY:
    'Diese Funktion steht nur Administrator-Konten zur Verfügung.',
  VOTING_CLOSED:
    'Für Flächen mit dem Status „Wird entsiegelt“ oder „Entsiegelt“ ist keine Abstimmung mehr möglich.',
  COMMENTS_CLOSED:
    'Für bereits entsiegelte Flächen können keine neuen Kommentare mehr hinzugefügt werden.',
  NOT_FOUND: 'Der angeforderte Eintrag wurde nicht gefunden.',
  VALIDATION_ERROR: 'Ungültige Eingabedaten.',
  UNSUPPORTED_MEDIA_TYPE:
    'Nicht unterstütztes Dateiformat (erlaubt: JPEG, PNG, WebP, HEIC bzw. .geojson/.gpkg).',
  GEOMETRY_INVALID:
    'Ungültige Polygongeometrie: Kanten dürfen sich nicht selbst schneiden.',
  GEOMETRY_SLIVER:
    'Das Polygon ist zu schmal (Mindestbreite über 1,0 m erforderlich).',
  GEOMETRY_NOT_COMPACT:
    'Die Polygonform ist zu dünn oder ausgefranst. Bitte eine zusammenhängende Fläche einzeichnen.',
  AREA_OUT_OF_BOUNDS:
    'Die Polygonfläche liegt außerhalb des zulässigen Bereichs (2–20.000 m²).',
  POLYGON_OVERLAP:
    'Dieser Vorschlag überlappt zu stark mit einer bereits eingetragenen Fläche.',
  SPATIAL_CLUSTER_LIMIT:
    'In diesem unmittelbaren Umkreis wurden kürzlich zu viele Flächen eingereicht. Bitte später erneut versuchen.',
  OUTSIDE_JURISDICTION:
    'Die Fläche liegt außerhalb des unterstützten Kartierungsgebiets.',
  LAND_COVER_EXCLUDED:
    'Diese Fläche liegt überwiegend auf Gewässern, Wald, Grünflächen, Ackerland, Bahnanlagen oder Gebäuden.',
  BBOX_TOO_LARGE: 'Kartenausschnitt zu groß - bitte näher heranzoomen.',
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
