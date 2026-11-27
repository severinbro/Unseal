// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

/**
 * OpenUnseal mobile and web root application shell.
 *
 * Workspace configuration, licensing, container packaging, E2E verification,
 * and operator deployment are defined in `README.md`, `package.json`,
 * `package-lock.json`, `tsconfig.base.json`, `tsconfig.e2e.json`, `app.json`,
 * `LICENSE`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`,
 * `.dockerignore`, `001_initial_schema.sql`, and `002_v2_features.sql`.
 */
import {
  ApiError,
  CHAT_LIMITS,
  closeRingIfNeeded,
  dedupeConsecutivePoints,
  PHOTO_LIMITS,
  polygonMatchesFilters,
  SPACE_ZONE_LIMITS,
  type CommentVoteResponse,
  type CreateContentReportRequest,
  type CreateContentReportResponse,
  type CreatePolygonCommentRequest,
  type FlagPolygonResponse,
  type GeocodeResultItem,
  type LoginRequest,
  type PatchPolygonRequest,
  type PersonalStatsResponse,
  type PhotoVoteResponse,
  type PolygonComment,
  type PolygonCommentListResponse,
  type PolygonFeature,
  type PolygonFlagReason,
  type PolygonPhoto,
  type PolygonStatus,
  type PublicStatsResponse,
  type RegisterRequest,
  type SpaceType,
  type SpaceZoneCollection,
  type VoteResponse,
} from '@openunseal/shared';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  appendHostedPageTheme,
  PpgisApiClient,
  type ImportPolygonsOptions,
  type UploadableFileInput,
} from './src/api/client';
import { saveDataExport } from './src/media/saveDataExport';
import { AboutModal } from './src/components/AboutModal';
import { AddressSearchModal } from './src/components/AddressSearchModal';
import { AdminImportModal } from './src/components/AdminImportModal';
import { AnimatedIntroOverlay } from './src/components/AnimatedIntroOverlay';
import { AuthAndAccountModal } from './src/components/AuthAndAccountModal';
import { BugReportModal } from './src/components/BugReportModal';
import {
  ContentReportModal,
  type ContentReportTarget,
} from './src/components/ContentReportModal';
import {
  DirectChatModal,
  isForeground,
  type ChatStart,
} from './src/components/DirectChatModal';
import { DisclaimerBanner } from './src/components/DisclaimerBanner';
import { DrawingToolbar } from './src/components/DrawingToolbar';
import {
  GnssMapButton,
  MapLayersButton,
  NorthArrowButton,
  SearchMapButton,
  TopRightMapControls,
} from './src/components/GnssMapButton';
import { FeedView, type FeedLoadOptions } from './src/components/FeedView';
import { InstallAppModal } from './src/components/InstallAppModal';
import {
  FloatingFilterStrip,
  MapControlsBar,
  MapLayersPopover,
  NavbarOverflowMenu,
  ProposeFabButton,
} from './src/components/MapControlsBar';
import {
  PolygonInspectorSheet,
  type InspectorTab,
} from './src/components/PolygonInspectorSheet';
import {
  DraftSpaceSection,
  PolygonSpaceCard,
  SpaceZonesControl,
  formatZoneCredits,
  type ClassifyState,
} from './src/components/SpaceSections';
import { TermsUpdateModal } from './src/components/TermsUpdateModal';
import { getSocialCopy } from './src/i18n/social';
import { StatsModal, type StatsModalTab } from './src/components/StatsModal';
import {
  getTranslations,
  localizeError,
  readPersistedLocale,
  writePersistedLocale,
  type Locale,
} from './src/i18n/translations';
import { requestCurrentCoordinates } from './src/location/locateMe';
import type { LocateMeResult } from './src/location/locateMe.types';
import {
  DEFAULT_DARK_OSM_STYLE_URL,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  MapCanvas,
  ORTHOPHOTO_LAYER_ID,
  ORTHOPHOTO_SOURCE_ID,
  buildDraftGeoJson,
  buildDraftLayerSpecs,
  buildOrthophotoLayerSpec,
  buildOrthophotoSourceSpec,
  buildPolygonLayerSpecs,
  buildProposalGeoJson,
  dedupeFeatureIdsPreservingOrder,
  resolveBasemapStyleUrl,
  type MapCanvasProps,
} from './src/map';
import {
  pickGeoImportDocument,
  pickPhotoFromCamera,
  pickPhotosFromLibrary,
} from './src/media/pickers';
import {
  appReducer,
  initialAppState,
  isDraftSpaceComplete,
  isInsideGermanyBounds,
  MAX_DRAFT_PHOTOS,
  type AppAction,
  type AppState,
} from './src/state/appState';
import {
  computeVisibleProposalCount,
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveMapControlsModel,
  deriveNavbarLayoutMode,
  MIN_TOUCH_TARGET_DP,
} from './src/state/viewModels';
import { platformSessionStorage } from './src/storage/secureStorage';
import {
  createMemorySessionStorage,
  SESSION_TOKEN_KEY,
  type SessionStorage,
} from './src/storage/tokenStorage';
import {
  createMemoryViewportStorage,
  type ViewportStorage,
} from './src/storage/viewportStorage';
import { platformViewportStorage } from './src/storage/viewportStorageAdapter';
import {
  createMemoryThemeStorage,
  detectWebSystemColorScheme,
  readPersistedThemePreferenceSync,
  type ThemeStorage,
} from './src/storage/themeStorage';
import { platformThemeStorage } from './src/storage/themeStorageAdapter';
import { ThemeProvider } from './src/theme/themeContext';
import {
  deriveResponsiveLayout,
  getPalette,
  MONO_FONT_FAMILY,
  RADII,
  resolveColorScheme,
  TABULAR_NUMS_STYLE,
  type ColorScheme,
  type ThemePalette,
  type ThemePreference,
} from './src/theme/tokens';
import {
  injectWebCraftStyles,
  syncWebDocumentLocale,
  syncWebDocumentTheme,
} from './src/theme/webStyles';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000';
/** Room the navbar, the docked card and the button for new areas take up. */
const NAVBAR_HEIGHT_PX = 58;
const DOCK_INSET_PX = 14;
const FAB_SIZE_PX = 48;
const LOCATE_ME_TARGET_ZOOM = 17;
const COARSE_WEB_ACCURACY_NOTICE_M = 2_500;

function zoomForAccuracyMeters(accuracyMeters: number | undefined): number {
  if (accuracyMeters === undefined || accuracyMeters <= 500) {
    return LOCATE_ME_TARGET_ZOOM;
  }
  if (accuracyMeters <= 2_500) {
    return 15;
  }
  if (accuracyMeters <= 10_000) {
    return 13;
  }
  return 12;
}

export const mapStylePrimitives = {
  ORTHOPHOTO_SOURCE_ID,
  ORTHOPHOTO_LAYER_ID,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  DEFAULT_DARK_OSM_STYLE_URL,
  dedupeFeatureIdsPreservingOrder,
  resolveBasemapStyleUrl,
  buildProposalGeoJson,
  buildDraftGeoJson,
  buildOrthophotoSourceSpec,
  buildOrthophotoLayerSpec,
  buildPolygonLayerSpecs,
  buildDraftLayerSpecs,
} as const;

declare const process: { env: Record<string, string | undefined> };

function resolveDefaultApiBaseUrl(): string {
  let configured: string | undefined;
  try {
    configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  } catch (err: unknown) {
    configured = err ? undefined : undefined;
  }
  return configured && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_API_BASE_URL;
}

export interface AppProps {
  baseUrl?: string;
  sessionStorage?: SessionStorage;
  viewportStorage?: ViewportStorage;
  themeStorage?: ThemeStorage;
  skipIntro?: boolean;
  ephemeralSession?: boolean;
  apiClient?: PpgisApiClient;
  initialLocale?: Locale;
  initialThemePreference?: ThemePreference;
  exp?: Record<string, unknown>;
}

export function App(props: AppProps = {}): React.JSX.Element {
  const [state, dispatch] = useReducer<
    React.Reducer<AppState, AppAction>,
    { locale?: Locale | undefined; themePreference?: ThemePreference | undefined }
  >(
    appReducer,
    {
      locale: props.initialLocale,
      themePreference: props.initialThemePreference,
    },
    (init): AppState => {
      const startLocale = init.locale ?? readPersistedLocale();
      const startTheme =
        init.themePreference ??
        readPersistedThemePreferenceSync() ??
        'light';
      return {
        ...initialAppState,
        locale: startLocale,
        themePreference: startTheme,
      };
    },
  );
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [aboutModalOpen, setAboutModalOpen] = useState<boolean>(false);
  const [latestVote, setLatestVote] = useState<VoteResponse | null>(null);
  const [inspectorTabRequest, setInspectorTabRequest] = useState<{
    featureId: string;
    tab: InspectorTab;
    seq: number;
  } | null>(null);
  const [statsModalOpen, setStatsModalOpen] = useState<boolean>(false);
  const [statsModalTab, setStatsModalTab] = useState<StatsModalTab>('community');
  const [installModalOpen, setInstallModalOpen] = useState<boolean>(false);
  const [searchModalOpen, setSearchModalOpen] = useState<boolean>(false);
  const [bugModalOpen, setBugModalOpen] = useState<boolean>(false);
  const [contentReportTarget, setContentReportTarget] =
    useState<ContentReportTarget | null>(null);
  const [pendingImportFile, setPendingImportFile] =
    useState<UploadableFileInput | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const [layersPopoverOpen, setLayersPopoverOpen] = useState<boolean>(false);
  const [zoomDividerBottomPx, setZoomDividerBottomPx] = useState<number | null>(
    null,
  );
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const [introVisible, setIntroVisible] = useState<boolean>(
    () => !props.skipIntro,
  );

  const handleFinishIntro = useCallback((): void => {
    setIntroVisible(false);
  }, []);

  const localeRef = useRef<Locale>(state.locale);
  localeRef.current = state.locale;

  const featuresRef = useRef<PolygonFeature[]>(state.features);
  featuresRef.current = state.features;

  const windowDimensions = useWindowDimensions();
  const layout = useMemo(
    () =>
      deriveResponsiveLayout(windowDimensions.width, windowDimensions.height),
    [windowDimensions.width, windowDimensions.height],
  );

  const rnColorScheme = useColorScheme();
  const [webSystemScheme, setWebSystemScheme] = useState<ColorScheme | null>(
    () => (Platform.OS === 'web' ? detectWebSystemColorScheme() : null),
  );

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const scope = globalThis as {
      window?: {
        matchMedia?: (query: string) => {
          matches?: boolean;
          addEventListener?: (
            type: 'change',
            listener: (event: { matches?: boolean }) => void,
          ) => void;
          removeEventListener?: (
            type: 'change',
            listener: (event: { matches?: boolean }) => void,
          ) => void;
        } | null;
      };
    };
    const mql = scope.window?.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql || typeof mql.addEventListener !== 'function') {
      return;
    }
    const handleChange = (event: { matches?: boolean }): void => {
      setWebSystemScheme(event.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handleChange);
    return () => {
      mql.removeEventListener?.('change', handleChange);
    };
  }, []);

  const systemColorScheme: ColorScheme | null =
    Platform.OS === 'web'
      ? (webSystemScheme ??
        (rnColorScheme === 'dark'
          ? 'dark'
          : rnColorScheme === 'light'
            ? 'light'
            : null))
      : rnColorScheme === 'dark'
        ? 'dark'
        : rnColorScheme === 'light'
          ? 'light'
          : null;

  const branding = state.config?.branding ?? null;
  const activeColorScheme = resolveColorScheme(
    state.themePreference,
    systemColorScheme,
  );
  const palette = useMemo(
    () => getPalette(activeColorScheme, branding),
    [activeColorScheme, branding],
  );
  const isDark = activeColorScheme === 'dark';
  const styles = useMemo(
    () => createStyles(palette, isDark),
    [palette, isDark],
  );

  useEffect(() => {
    injectWebCraftStyles(localeRef.current, activeColorScheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    syncWebDocumentLocale(state.locale, branding);
  }, [state.locale, branding]);

  useEffect(() => {
    syncWebDocumentTheme(activeColorScheme, palette);
  }, [activeColorScheme, palette]);

  useEffect(() => {
    if (branding?.introEnabled === false) {
      setIntroVisible(false);
    }
  }, [branding?.introEnabled]);

  const handleToggleLocale = useCallback((): void => {
    const nextLocale: Locale = state.locale === 'de' ? 'en' : 'de';
    writePersistedLocale(nextLocale);
    setLocationNotice(null);
    dispatch({ type: 'SET_LOCALE', locale: nextLocale });
  }, [state.locale]);

  const storage = useMemo<SessionStorage>(() => {
    if (props.sessionStorage) {
      return props.sessionStorage;
    }
    if (props.ephemeralSession) {
      return createMemorySessionStorage();
    }
    return platformSessionStorage;
  }, [props.sessionStorage, props.ephemeralSession]);

  const viewportStore = useMemo<ViewportStorage>(() => {
    if (props.viewportStorage) {
      return props.viewportStorage;
    }
    if (props.ephemeralSession || props.sessionStorage) {
      return createMemoryViewportStorage();
    }
    return platformViewportStorage;
  }, [props.viewportStorage, props.ephemeralSession, props.sessionStorage]);

  const themeStore = useMemo<ThemeStorage>(() => {
    if (props.themeStorage) {
      return props.themeStorage;
    }
    if (props.ephemeralSession || props.sessionStorage) {
      return createMemoryThemeStorage();
    }
    return platformThemeStorage;
  }, [props.themeStorage, props.ephemeralSession, props.sessionStorage]);

  useEffect(() => {
    if (props.initialThemePreference !== undefined) {
      return;
    }
    let cancelled = false;
    void themeStore.getThemePreference().then((savedPref) => {
      if (!cancelled && savedPref !== null) {
        dispatch({ type: 'SET_THEME_PREFERENCE', preference: savedPref });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.initialThemePreference, themeStore]);

  const handleToggleTheme = useCallback((): void => {
    const nextPreference: ThemePreference =
      activeColorScheme === 'dark' ? 'light' : 'dark';
    dispatch({ type: 'SET_THEME_PREFERENCE', preference: nextPreference });
    void themeStore.setThemePreference(nextPreference);
  }, [activeColorScheme, themeStore]);

  const resolvedBaseUrl = props.baseUrl ?? resolveDefaultApiBaseUrl();

  const apiClient = useMemo<PpgisApiClient>(
    () => props.apiClient ?? new PpgisApiClient(resolvedBaseUrl, storage),
    [props.apiClient, resolvedBaseUrl, storage],
  );

  const handleSessionExpiredError = useCallback(
    async (err: unknown): Promise<boolean> => {
      if (err instanceof ApiError && err.statusCode === 401) {
        await storage.clearToken();
        dispatch({ type: 'SESSION_EXPIRED' });
        return true;
      }
      return false;
    },
    [storage],
  );

  const bootstrapApp = useCallback(async (): Promise<void> => {
    dispatch({ type: 'CONFIG_LOADING' });
    try {
      const [config, savedViewport] = await Promise.all([
        apiClient.getConfig(),
        viewportStore.getViewport(),
      ]);
      dispatch({
        type: 'CONFIG_LOADED',
        config,
        savedViewport,
      });

      const existingToken = await storage.getToken();
      if (existingToken && existingToken.length > 0) {
        try {
          const me = await apiClient.getMe();
          dispatch({ type: 'AUTH_SUCCEEDED', user: me });
        } catch (authErr: unknown) {
          if (authErr instanceof ApiError && authErr.statusCode === 401) {
            await storage.clearToken();
          }
        }
      }
    } catch (err: unknown) {
      const activeLocale = localeRef.current;
      const fallback = getTranslations(activeLocale).app.configLoadFallback;
      const message = localizeError(err, fallback, activeLocale);
      dispatch({ type: 'CONFIG_ERROR', message });
    }
  }, [apiClient, storage, viewportStore]);

  useEffect(() => {
    void bootstrapApp();
  }, [bootstrapApp]);

  useEffect(() => {
    if (
      state.configStatus !== 'ready' ||
      state.viewport === null ||
      state.spanTooWide ||
      state.activeMainTab !== 'map'
    ) {
      return;
    }

    let cancelled = false;
    const bbox = state.viewport.bbox;
    const filter = state.polygonFilter;

    void (async () => {
      try {
        const collection = await apiClient.listPolygons(bbox, { filter });
        if (!cancelled) {
          dispatch({
            type: 'VIEWPORT_FEATURES_LOADED',
            features: collection.features,
            truncated: collection.meta.truncated,
          });
        }
      } catch (err: unknown) {
        if (
          !cancelled &&
          err instanceof ApiError &&
          err.statusCode === 401
        ) {
          await storage.clearToken();
          dispatch({ type: 'SESSION_EXPIRED' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    apiClient,
    storage,
    state.configStatus,
    state.viewport,
    state.spanTooWide,
    state.polygonFilter,
    state.activeMainTab,
    state.viewportRefreshSeq,
  ]);

  useEffect(() => {
    if (
      state.currentUser === null ||
      state.authModalOpen ||
      state.pendingIntent === null ||
      state.pendingIntent.type === 'ADVANCE_TO_DETAILS'
    ) {
      return;
    }

    let cancelled = false;
    const activeIntent = state.pendingIntent;

    void (async () => {
      try {
        if (activeIntent.type === 'SUBMIT_DRAFT') {
          const created = await apiClient.createPolygon(activeIntent.payload);
          let uploadedPhotosCount = created.properties.photoCount;
          let photoUploadWarning: string | null = null;

          for (const photoFile of activeIntent.photos) {
            try {
              await apiClient.uploadPolygonPhoto(created.id, photoFile);
              uploadedPhotosCount += 1;
            } catch (photoErr: unknown) {
              const activeLocale = localeRef.current;
              const fallback =
                getTranslations(activeLocale).inspector.photoErrorFallback;
              photoUploadWarning = localizeError(
                photoErr,
                fallback,
                activeLocale,
              );
            }
          }

          if (!cancelled) {
            dispatch({
              type: 'POLYGON_CREATED',
              feature: {
                ...created,
                properties: {
                  ...created.properties,
                  photoCount: uploadedPhotosCount,
                },
              },
            });
            if (photoUploadWarning) {
              setLocationNotice(photoUploadWarning);
            }
          }
        } else {
          const voteResult = await apiClient.putVote(
            activeIntent.polygonId,
            activeIntent.value,
          );
          if (!cancelled) {
            dispatch({ type: 'VOTE_UPDATED', vote: voteResult });
            setLatestVote(voteResult);
          }
        }
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.statusCode === 401) {
          await storage.clearToken();
          dispatch({ type: 'SESSION_EXPIRED' });
          return;
        }
        const activeLocale = localeRef.current;
        const fallback =
          getTranslations(activeLocale).app.requestFailedFallback;
        const message = localizeError(err, fallback, activeLocale);
        if (err instanceof ApiError && err.code === 'TERMS_UPDATE_REQUIRED') {
          setTermsPromptDismissed(false);
          void apiClient
            .getMe()
            .then((user) => dispatch({ type: 'USER_UPDATED', user }))
            .catch(() => undefined);
        }
        dispatch({ type: 'CLEAR_PENDING_INTENT' });
        if (activeIntent.type === 'SUBMIT_DRAFT') {
          dispatch({ type: 'SUBMIT_ERROR_PRESERVE_DRAFT', message });
        } else {
          setLocationNotice(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    apiClient,
    storage,
    state.currentUser,
    state.authModalOpen,
    state.pendingIntent,
  ]);

  const dict = getTranslations(state.locale);
  const tApp = dict.app;
  const mapControls = deriveMapControlsModel(state, systemColorScheme);
  const authModal = deriveAuthModalModel(state);
  const drawingToolbar = deriveDrawingToolbarModel(state);

  const selectedFeature = useMemo<PolygonFeature | null>(() => {
    if (state.mode !== 'browse' || state.selectedFeatureId === null) {
      return null;
    }
    return (
      state.features.find((item) => item.id === state.selectedFeatureId) ?? null
    );
  }, [state.features, state.mode, state.selectedFeatureId]);

  const sheetDragY = useRef(new Animated.Value(0)).current;
  const [mapBearingDeg, setMapBearingDeg] = useState(0);
  const [northResetSeq, setNorthResetSeq] = useState(0);

  const handleBearingChange = useCallback((bearingDeg: number): void => {
    setMapBearingDeg((prev) => {
      if (bearingDeg === 0) {
        return prev === 0 ? prev : 0;
      }
      return Math.abs(prev - bearingDeg) < 0.25 ? prev : bearingDeg;
    });
  }, []);

  const handleNorthReset = useCallback((): void => {
    setNorthResetSeq((seq) => seq + 1);
  }, []);
  const drawingVisibleRef = useRef<boolean>(drawingToolbar.visible);
  drawingVisibleRef.current = drawingToolbar.visible;
  const drawingCollapsedRef = useRef<boolean>(drawingToolbar.collapsed);
  drawingCollapsedRef.current = drawingToolbar.collapsed;
  const selectedFeatureRef = useRef<PolygonFeature | null>(selectedFeature);
  selectedFeatureRef.current = selectedFeature;

  const resetSheetDragPosition = useCallback((): void => {
    Animated.spring(sheetDragY, {
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
      bounciness: 0,
    }).start();
  }, [sheetDragY]);

  const sheetLatchPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gestureState) =>
          Math.abs(gestureState.dy) > 6 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_evt, gestureState) => {
          if (drawingVisibleRef.current && drawingCollapsedRef.current) {
            sheetDragY.setValue(Math.max(-96, Math.min(0, gestureState.dy)));
          } else {
            sheetDragY.setValue(Math.max(0, Math.min(260, gestureState.dy)));
          }
        },
        onPanResponderRelease: (_evt, gestureState) => {
          if (drawingVisibleRef.current) {
            if (drawingCollapsedRef.current) {
              if (gestureState.dy < -22 || gestureState.vy < -0.3) {
                sheetDragY.setValue(0);
                dispatch({
                  type: 'SET_DRAWING_SHEET_COLLAPSED',
                  collapsed: false,
                });
                return;
              }
            } else if (gestureState.dy > 26 || gestureState.vy > 0.3) {
              sheetDragY.setValue(0);
              dispatch({
                type: 'SET_DRAWING_SHEET_COLLAPSED',
                collapsed: true,
              });
              return;
            }
          } else if (
            selectedFeatureRef.current !== null &&
            (gestureState.dy > 36 || gestureState.vy > 0.4)
          ) {
            sheetDragY.setValue(0);
            dispatch({ type: 'SELECT_FEATURES_AT_TAP', featureIds: [] });
            return;
          }
          resetSheetDragPosition();
        },
        onPanResponderTerminate: () => {
          resetSheetDragPosition();
        },
      }),
    [resetSheetDragPosition, sheetDragY],
  );

  const handleSheetLatchPress = useCallback((): void => {
    sheetDragY.setValue(0);
    if (drawingVisibleRef.current) {
      dispatch({
        type: 'SET_DRAWING_SHEET_COLLAPSED',
        collapsed: !drawingCollapsedRef.current,
      });
    } else if (selectedFeatureRef.current !== null) {
      dispatch({ type: 'SELECT_FEATURES_AT_TAP', featureIds: [] });
    }
  }, [sheetDragY]);

  const handleViewportChange = useCallback<MapCanvasProps['onViewportChange']>(
    ({ bbox, zoom }) => {
      dispatch({ type: 'SET_VIEWPORT', bbox, zoom });
      void viewportStore.setViewport({ bbox, zoom });
    },
    [viewportStore],
  );

  const handleMapTap = useCallback<MapCanvasProps['onMapTap']>(
    (point) => {
      setLayersPopoverOpen(false);
      if (state.mode === 'drawing') {
        dispatch({ type: 'ADD_VERTEX', point });
      } else {
        dispatch({ type: 'SELECT_FEATURES_AT_TAP', featureIds: [] });
      }
    },
    [state.mode],
  );

  const handleFeaturePress = useCallback<MapCanvasProps['onFeaturePress']>(
    (featureIds) => {
      setLayersPopoverOpen(false);
      dispatch({ type: 'SELECT_FEATURES_AT_TAP', featureIds });
    },
    [],
  );

  const handleTileError = useCallback<MapCanvasProps['onTileError']>(
    (reason) => {
      dispatch({ type: 'TILE_LOAD_ERROR', reason });
    },
    [],
  );

  const handleLocateMe = useCallback((): void => {
    setIsLocating(true);
    setLocationNotice(null);
    const outsideGermany = (lng: number, lat: number): boolean =>
      state.config?.germanyConfinementEnabled !== false &&
      !isInsideGermanyBounds(lng, lat);

    void requestCurrentCoordinates(
      undefined,
      undefined,
      state.locale,
      undefined,
      (interimFix) => {
        if (outsideGermany(interimFix.lng, interimFix.lat)) {
          return;
        }
        dispatch({
          type: 'SET_CAMERA_TARGET',
          lng: interimFix.lng,
          lat: interimFix.lat,
          zoom: zoomForAccuracyMeters(interimFix.accuracyMeters),
        });
      },
    )
      .then((gpsResult: LocateMeResult) => {
        if (gpsResult.ok && outsideGermany(gpsResult.lng, gpsResult.lat)) {
          setLocationNotice(
            getTranslations(localeRef.current).location.outsideGermanyNotice,
          );
        } else if (gpsResult.ok) {
          dispatch({
            type: 'SET_CAMERA_TARGET',
            lng: gpsResult.lng,
            lat: gpsResult.lat,
            zoom: zoomForAccuracyMeters(gpsResult.accuracyMeters),
          });
          if (
            Platform.OS === 'web' &&
            gpsResult.accuracyMeters !== undefined &&
            gpsResult.accuracyMeters > COARSE_WEB_ACCURACY_NOTICE_M
          ) {
            const approxKm = Math.max(
              1,
              Math.round(gpsResult.accuracyMeters / 1000),
            );
            setLocationNotice(
              getTranslations(
                localeRef.current,
              ).location.webApproximateLocationNotice(approxKm),
            );
          }
        } else {
          setLocationNotice(gpsResult.reason);
        }
      })
      .finally(() => {
        setIsLocating(false);
      });
  }, [state.config, state.locale]);

  const handleAddressSearch = useCallback(
    async (query: string): Promise<GeocodeResultItem[]> => {
      const response = await apiClient.searchAddress(query, state.locale);
      return response.results;
    },
    [apiClient, state.locale],
  );

  const handleSelectGeocodeResult = useCallback(
    (item: GeocodeResultItem): void => {
      setSearchModalOpen(false);
      dispatch({
        type: 'SET_CAMERA_TARGET',
        lng: item.lng,
        lat: item.lat,
        zoom: LOCATE_ME_TARGET_ZOOM,
        ...(item.boundingBox
          ? {
              bounds: {
                minLng: item.boundingBox[0],
                minLat: item.boundingBox[1],
                maxLng: item.boundingBox[2],
                maxLat: item.boundingBox[3],
              },
            }
          : {}),
      });
    },
    [],
  );

  const handleSubmitBugReport = useCallback(
    async (input: {
      description: string;
      contactEmail: string | null;
    }): Promise<void> => {
      let pageUrl: string | null = null;
      if (Platform.OS === 'web') {
        const maybeWindow = (
          globalThis as { window?: { location?: { href?: string } } }
        ).window;
        if (typeof maybeWindow?.location?.href === 'string') {
          pageUrl = maybeWindow.location.href;
        }
      }
      await apiClient.submitBugReport({
        description: input.description,
        contactEmail: input.contactEmail,
        platform: Platform.OS,
        pageUrl,
      });
    },
    [apiClient],
  );

  const handleSubmitContentReport = useCallback(
    async (
      input: CreateContentReportRequest,
    ): Promise<CreateContentReportResponse> => {
      return apiClient.submitContentReport(input);
    },
    [apiClient],
  );

  // --- Ground type, feed and direct messages -------------------------------
  const [classifyState, setClassifyState] = useState<ClassifyState>({
    status: 'idle',
  });
  const [chatStart, setChatStart] = useState<ChatStart | null>(null);
  const [unreadChats, setUnreadChats] = useState(0);
  const [termsPromptDismissed, setTermsPromptDismissed] = useState(false);
  const [feedOpened, setFeedOpened] = useState(false);
  const [zonesOn, setZonesOn] = useState(false);
  const [zones, setZones] = useState<SpaceZoneCollection | null>(null);
  const chatScrollRef = useRef<ScrollView | null>(null);
  const social = getSocialCopy(state.locale);
  const userId = state.currentUser?.id ?? null;

  useEffect(() => {
    // Nothing of one account stays visible for the next one.
    setChatStart(null);
    setUnreadChats(0);
    setTermsPromptDismissed(false);
  }, [userId]);

  useEffect(() => {
    if (state.activeMainTab === 'feed') {
      setFeedOpened(true);
    }
  }, [state.activeMainTab]);

  // Land-use layer: loaded for the visible section only, and only while on.
  const zonesBbox = state.viewport?.bbox ?? null;
  const zonesZoomedIn =
    state.viewport !== null &&
    state.viewport.zoom >= SPACE_ZONE_LIMITS.MIN_ZOOM &&
    state.viewport.bbox.maxLng - state.viewport.bbox.minLng <=
      SPACE_ZONE_LIMITS.MAX_BBOX_SPAN_DEG &&
    state.viewport.bbox.maxLat - state.viewport.bbox.minLat <=
      SPACE_ZONE_LIMITS.MAX_BBOX_SPAN_DEG;
  useEffect(() => {
    if (!zonesOn || !zonesZoomedIn || zonesBbox === null) {
      setZones(null);
      return;
    }
    let cancelled = false;
    apiClient
      .listSpaceZones(zonesBbox)
      .then((collection) => {
        if (!cancelled) {
          setZones(collection);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setZones(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, zonesOn, zonesZoomedIn, zonesBbox]);

  const isDetailsStep =
    state.mode === 'drawing' && state.drawingStep === 'details';
  const draftVerticesRef = useRef(state.draftVertices);
  draftVerticesRef.current = state.draftVertices;
  const draftSpaceRef = useRef(state.draftSpace);
  draftSpaceRef.current = state.draftSpace;

  useEffect(() => {
    if (!isDetailsStep || userId === null) {
      setClassifyState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setClassifyState({ status: 'loading' });
    apiClient
      .classifyPolygonSpace({
        type: 'Polygon',
        coordinates: [
          closeRingIfNeeded(dedupeConsecutivePoints(draftVerticesRef.current)),
        ],
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setClassifyState({ status: 'done', result });
        // Without a detection nothing is preselected: no unfounded statement.
        if (
          draftSpaceRef.current.spaceType === null &&
          result.detectedSpaceType !== 'unknown'
        ) {
          dispatch({
            type: 'SET_DRAFT_SPACE',
            patch: { spaceType: result.proposedSpaceType },
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (
          err instanceof ApiError &&
          (err.statusCode === 409 || err.statusCode === 422)
        ) {
          dispatch({ type: 'BACK_TO_GEOMETRY' });
          dispatch({
            type: 'SUBMIT_ERROR_PRESERVE_DRAFT',
            message: localizeError(
              err,
              getSocialCopy(localeRef.current).failed,
              localeRef.current,
            ),
          });
          return;
        }
        setClassifyState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, isDetailsStep, userId]);

  useEffect(() => {
    if (userId === null) {
      return;
    }
    let cancelled = false;
    const refresh = (): void => {
      if (isForeground()) {
        apiClient
          .getUnreadChatCount()
          .then((count) => {
            if (!cancelled) {
              setUnreadChats(count);
            }
          })
          .catch(() => undefined);
      }
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiClient, userId, chatStart]);

  const loadFeedPage = useCallback(
    (options: FeedLoadOptions) => apiClient.listPolygonsFeed(options),
    [apiClient],
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  /** Opens an area on the map; filters stay unless they would hide it. */
  const showPolygonOnMap = useCallback(
    (feature: PolygonFeature, tab: InspectorTab = 'overview'): void => {
      const current = stateRef.current;
      setInspectorTabRequest((prev) => ({
        featureId: feature.id,
        tab,
        seq: (prev?.seq ?? 0) + 1,
      }));
      dispatch({
        type: 'SHOW_POLYGON',
        feature,
        keepFilters: polygonMatchesFilters(
          feature.properties,
          current.polygonFilter,
          'all',
          Date.now(),
        ),
      });
    },
    [],
  );

  const handleSavePolygonFlags = useCallback(
    async (
      id: string,
      patch: {
        openForPublicAccess: boolean;
        allowChatContact: boolean;
        helpWanted?: boolean;
        entitlementConfirmed?: boolean;
      },
    ): Promise<void> => {
      dispatch({
        type: 'POLYGON_UPDATED',
        feature: await apiClient.patchPolygon(id, patch),
      });
    },
    [apiClient],
  );

  const handleSetSpaceType = useCallback(
    async (id: string, spaceType: SpaceType): Promise<void> => {
      dispatch({
        type: 'POLYGON_UPDATED',
        feature: await apiClient.setPolygonSpaceType(id, spaceType),
      });
    },
    [apiClient],
  );

  const handleShowPolygonById = useCallback(
    (id: string): void => {
      setChatStart(null);
      apiClient
        .getPolygon(id)
        .then((feature) => showPolygonOnMap(feature))
        .catch((err: unknown) =>
          setLocationNotice(
            localizeError(
              err,
              getSocialCopy(localeRef.current).failed,
              localeRef.current,
            ),
          ),
        );
    },
    [apiClient, showPolygonOnMap],
  );

  const scrollChatToEnd = useCallback((): void => {
    // After layout, so the newest message has its final position.
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: false }), 0);
  }, []);

  const handleChatError = useCallback(
    async (err: unknown): Promise<boolean> => {
      if (err instanceof ApiError && err.statusCode === 401) {
        setChatStart(null);
        await storage.clearToken();
        dispatch({ type: 'SESSION_EXPIRED' });
        return true;
      }
      if (err instanceof ApiError && err.code === 'TERMS_UPDATE_REQUIRED') {
        setChatStart(null);
        setTermsPromptDismissed(false);
        const user = await apiClient.getMe().catch(() => null);
        if (user) {
          dispatch({ type: 'USER_UPDATED', user });
        }
        return true;
      }
      return false;
    },
    [apiClient, storage],
  );

  const handleTakeDraftPhoto = useCallback((): void => {
    void pickPhotoFromCamera(state.locale).then((outcome) => {
      if (outcome.status === 'picked') {
        dispatch({
          type: 'ADD_DRAFT_PHOTO',
          photo: {
            id: `draft-photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            previewUri: outcome.value.previewUri,
            file: outcome.value.file,
          },
        });
      } else if (outcome.status === 'error') {
        setLocationNotice(outcome.message);
      }
    });
  }, [state.locale]);

  const handlePickDraftPhoto = useCallback((): void => {
    const remainingSlots = Math.max(
      1,
      Math.min(MAX_DRAFT_PHOTOS, PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON) -
        state.draftPhotos.length,
    );
    void pickPhotosFromLibrary(state.locale, {
      selectionLimit: remainingSlots,
    }).then((outcome) => {
      if (outcome.status === 'picked') {
        const now = Date.now();
        dispatch({
          type: 'ADD_DRAFT_PHOTOS',
          photos: outcome.value.map((item, idx) => ({
            id: `draft-photo-${now}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
            previewUri: item.previewUri,
            file: item.file,
          })),
        });
      } else if (outcome.status === 'error') {
        setLocationNotice(outcome.message);
      }
    });
  }, [state.draftPhotos.length, state.locale]);

  const handleAdminImport = useCallback((): void => {
    const activeLocale = state.locale;
    void (async () => {
      const picked = await pickGeoImportDocument(activeLocale);
      if (picked.status === 'canceled') {
        return;
      }
      if (picked.status === 'error') {
        setLocationNotice(picked.message);
        return;
      }

      setLocationNotice(null);
      setPendingImportFile(picked.value);
    })();
  }, [state.locale]);

  const handleSubmitAdminImport = useCallback(
    async (
      file: UploadableFileInput,
      options: ImportPolygonsOptions,
    ): Promise<void> => {
      const activeLocale = state.locale;
      setIsImporting(true);
      setLocationNotice(null);
      try {
        const result = await apiClient.importPolygonsFile(file, options);
        setPendingImportFile(null);
        dispatch({ type: 'REFRESH_VIEWPORT_FEATURES' });
        setLocationNotice(
          getTranslations(activeLocale).controls.importSuccess(
            result.importedCount,
            result.skippedCount,
          ),
        );
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          setPendingImportFile(null);
          return;
        }
        throw err;
      } finally {
        setIsImporting(false);
      }
    },
    [apiClient, handleSessionExpiredError, state.locale],
  );

  const handleRegister = useCallback(
    async (input: RegisterRequest): Promise<void> => {
      const registered = await apiClient.register(input);
      dispatch({
        type: 'REGISTRATION_VERIFICATION_SENT',
        email: registered.email,
        pseudonym: registered.pseudonym,
      });
    },
    [apiClient],
  );

  const handleResendVerification = useCallback(
    async (identifier: string): Promise<void> => {
      await apiClient.resendVerification(identifier);
    },
    [apiClient],
  );

  const handleLogin = useCallback(
    async (input: LoginRequest): Promise<void> => {
      const session = await apiClient.login(input);
      dispatch({
        type: 'AUTH_SUCCEEDED',
        user: session.user,
      });
    },
    [apiClient],
  );

  const handleForgotPassword = useCallback(
    async (email: string): Promise<void> => {
      await apiClient.forgotPassword(email);
    },
    [apiClient],
  );

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.logout();
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.statusCode === 401)) {
        throw err;
      }
    }
    dispatch({ type: 'LOGOUT_SUCCEEDED' });
  }, [apiClient]);

  const handleDeleteAccount = useCallback(
    async (options: { purgeContent: boolean }): Promise<void> => {
      try {
        await apiClient.deleteMe({ purgeContent: options.purgeContent });
        dispatch({
          type: 'ACCOUNT_DELETED',
          purgedContent: options.purgeContent,
        });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleExportData = useCallback(async (): Promise<void> => {
    try {
      const json = await apiClient.exportMyData();
      await saveDataExport(json);
    } catch (err: unknown) {
      if (await handleSessionExpiredError(err)) {
        return;
      }
      throw err;
    }
  }, [apiClient, handleSessionExpiredError]);

  const handleCastVote = useCallback(
    async (polygonId: string, value: 1 | -1): Promise<void> => {
      try {
        const vote = await apiClient.putVote(polygonId, value);
        dispatch({ type: 'VOTE_UPDATED', vote });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          dispatch({ type: 'CAST_VOTE', polygonId, value });
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleClearVote = useCallback(
    async (polygonId: string): Promise<void> => {
      try {
        const vote = await apiClient.deleteVote(polygonId);
        dispatch({ type: 'VOTE_UPDATED', vote });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handlePatchPolygon = useCallback(
    async (polygonId: string, patch: PatchPolygonRequest): Promise<void> => {
      try {
        const updated = await apiClient.patchPolygon(polygonId, patch);
        dispatch({ type: 'POLYGON_UPDATED', feature: updated });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  /** Votes from a feed card; resolves with the new tally or null. */
  const handleFeedVote = useCallback(
    async (
      feature: PolygonFeature,
      value: 1 | -1 | 0,
    ): Promise<VoteResponse | null> => {
      if (stateRef.current.currentUser === null) {
        if (value !== 0) {
          // Signs in first; the vote is then cast by the pending-intent effect.
          dispatch({ type: 'CAST_VOTE', polygonId: feature.id, value });
        }
        return null;
      }
      try {
        const vote =
          value === 0
            ? await apiClient.deleteVote(feature.id)
            : await apiClient.putVote(feature.id, value);
        dispatch({ type: 'VOTE_UPDATED', vote });
        return vote;
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return null;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleSetAllowDirectMessages = useCallback(
    async (allow: boolean): Promise<void> => {
      try {
        dispatch({
          type: 'USER_UPDATED',
          user: await apiClient.updatePreferences(allow),
        });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handlePatchPolygonStatus = useCallback(
    async (
      polygonId: string,
      status: PolygonStatus,
      entitlementConfirmed?: boolean,
    ): Promise<void> => {
      try {
        const updated = await apiClient.patchPolygonStatus(
          polygonId,
          status,
          entitlementConfirmed,
        );
        dispatch({ type: 'POLYGON_UPDATED', feature: updated });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleDeletePolygon = useCallback(
    async (polygonId: string): Promise<void> => {
      try {
        await apiClient.deletePolygon(polygonId);
        dispatch({ type: 'POLYGON_DELETED', polygonId });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleListPolygonPhotos = useCallback(
    async (polygonId: string): Promise<PolygonPhoto[]> => {
      const response = await apiClient.listPolygonPhotos(polygonId);
      dispatch({
        type: 'POLYGON_PHOTO_COUNT_SET',
        polygonId,
        photoCount: response.photos.length,
      });
      return response.photos;
    },
    [apiClient],
  );

  const handleInspectorUploadCamera = useCallback(
    async (polygonId: string): Promise<PolygonPhoto | null> => {
      const picked = await pickPhotoFromCamera(localeRef.current);
      if (picked.status === 'canceled') {
        return null;
      }
      if (picked.status === 'error') {
        throw new Error(picked.message);
      }
      try {
        const uploaded = await apiClient.uploadPolygonPhoto(
          polygonId,
          picked.value.file,
        );
        const currentCount =
          featuresRef.current.find((f) => f.id === polygonId)?.properties
            .photoCount ?? 0;
        dispatch({
          type: 'POLYGON_PHOTO_COUNT_SET',
          polygonId,
          photoCount: currentCount + 1,
        });
        return uploaded;
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return null;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleInspectorUploadLibraryBatch = useCallback(
    async (
      polygonId: string,
      onProgress?: (current: number, total: number) => void,
    ): Promise<PolygonPhoto[]> => {
      const currentCount =
        featuresRef.current.find((f) => f.id === polygonId)?.properties
          .photoCount ?? 0;
      const remainingSlots = Math.max(
        1,
        PHOTO_LIMITS.MAX_PHOTOS_PER_POLYGON - currentCount,
      );
      const picked = await pickPhotosFromLibrary(localeRef.current, {
        selectionLimit: remainingSlots,
      });
      if (picked.status === 'canceled') {
        return [];
      }
      if (picked.status === 'error') {
        throw new Error(picked.message);
      }

      const { uploaded, firstError } = await apiClient.uploadPolygonPhotos(
        polygonId,
        picked.value.map((item) => item.file),
        onProgress ? { onProgress } : undefined,
      );

      if (uploaded.length > 0) {
        const latestCount =
          featuresRef.current.find((f) => f.id === polygonId)?.properties
            .photoCount ?? currentCount;
        dispatch({
          type: 'POLYGON_PHOTO_COUNT_SET',
          polygonId,
          photoCount: latestCount + uploaded.length,
        });
      }

      if (firstError !== null) {
        if (await handleSessionExpiredError(firstError)) {
          return uploaded;
        }
        if (uploaded.length === 0) {
          throw firstError;
        }
        const activeLocale = localeRef.current;
        const fallback =
          getTranslations(activeLocale).inspector.photoErrorFallback;
        setLocationNotice(localizeError(firstError, fallback, activeLocale));
      }

      return uploaded;
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleVotePhoto = useCallback(
    async (photoId: string, value: 1 | -1): Promise<PhotoVoteResponse> => {
      try {
        return await apiClient.putPhotoVote(photoId, value);
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleClearPhotoVote = useCallback(
    async (photoId: string): Promise<PhotoVoteResponse> => {
      try {
        return await apiClient.deletePhotoVote(photoId);
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleDeletePhoto = useCallback(
    async (photoId: string, polygonId: string): Promise<void> => {
      try {
        await apiClient.deletePhoto(photoId);
        const currentCount =
          featuresRef.current.find((f) => f.id === polygonId)?.properties
            .photoCount ?? 1;
        dispatch({
          type: 'POLYGON_PHOTO_COUNT_SET',
          polygonId,
          photoCount: Math.max(0, currentCount - 1),
        });
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleListPolygonComments = useCallback(
    async (polygonId: string): Promise<PolygonCommentListResponse> => {
      const response = await apiClient.listPolygonComments(polygonId);
      dispatch({
        type: 'POLYGON_COMMENT_COUNT_SET',
        polygonId,
        commentCount: response.comments.length,
      });
      return response;
    },
    [apiClient],
  );

  const handleCreatePolygonComment = useCallback(
    async (
      polygonId: string,
      input: CreatePolygonCommentRequest,
    ): Promise<PolygonComment> => {
      try {
        const created = await apiClient.createPolygonComment(polygonId, input);
        const currentCount =
          featuresRef.current.find((f) => f.id === polygonId)?.properties
            .commentCount ?? 0;
        dispatch({
          type: 'POLYGON_COMMENT_COUNT_SET',
          polygonId,
          commentCount: currentCount + 1,
        });
        return created;
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleVoteComment = useCallback(
    async (commentId: string): Promise<CommentVoteResponse> => {
      try {
        return await apiClient.putCommentVote(commentId);
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleClearCommentVote = useCallback(
    async (commentId: string): Promise<CommentVoteResponse> => {
      try {
        return await apiClient.deleteCommentVote(commentId);
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string, polygonId: string): Promise<void> => {
      try {
        await apiClient.deleteComment(commentId);
        try {
          const refreshed = await apiClient.listPolygonComments(polygonId);
          dispatch({
            type: 'POLYGON_COMMENT_COUNT_SET',
            polygonId,
            commentCount: refreshed.comments.length,
          });
        } catch {
          const currentCount =
            featuresRef.current.find((f) => f.id === polygonId)?.properties
              .commentCount ?? 1;
          dispatch({
            type: 'POLYGON_COMMENT_COUNT_SET',
            polygonId,
            commentCount: Math.max(0, currentCount - 1),
          });
        }
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleFlagPolygon = useCallback(
    async (
      polygonId: string,
      reason: PolygonFlagReason,
    ): Promise<FlagPolygonResponse> => {
      try {
        const flag = await apiClient.flagPolygon(polygonId, { reason });
        dispatch({ type: 'POLYGON_FLAG_UPDATED', flag });
        return flag;
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleUnflagPolygon = useCallback(
    async (polygonId: string): Promise<FlagPolygonResponse> => {
      try {
        const flag = await apiClient.unflagPolygon(polygonId);
        dispatch({ type: 'POLYGON_FLAG_UPDATED', flag });
        return flag;
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const handleClearPolygonFlags = useCallback(
    async (polygonId: string): Promise<FlagPolygonResponse> => {
      try {
        const flag = await apiClient.clearPolygonFlags(polygonId);
        dispatch({ type: 'POLYGON_FLAG_UPDATED', flag });
        return flag;
      } catch (err: unknown) {
        await handleSessionExpiredError(err);
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const resolveUploadUrl = useCallback(
    (relativePath: string) => apiClient.resolveUploadUrl(relativePath),
    [apiClient],
  );

  const handleLoadPublicStats = useCallback(
    (): Promise<PublicStatsResponse> => apiClient.getPublicStats(),
    [apiClient],
  );

  const handleLoadPersonalStats = useCallback(
    async (): Promise<PersonalStatsResponse> => {
      try {
        return await apiClient.getPersonalStats();
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          setStatsModalOpen(false);
        }
        throw err;
      }
    },
    [apiClient, handleSessionExpiredError],
  );

  const statusBarNode =
    Platform.OS !== 'web' ? (
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={palette.bgSurface}
      />
    ) : null;

  let screenContent: React.JSX.Element;

  if (state.configStatus === 'loading') {
    screenContent = (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator size="large" color={palette.accentPrimary} />
        <Text style={styles.statusTitle}>{tApp.loadingTitle}</Text>
      </SafeAreaView>
    );
  } else if (state.configStatus === 'error' || state.config === null) {
    screenContent = (
      <SafeAreaView style={styles.centeredScreen}>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{tApp.errorTitle}</Text>
          <Text style={styles.errorBody}>
            {state.configError ?? tApp.errorFallback}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tApp.retryA11y}
            onPress={() => {
              void bootstrapApp();
            }}
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonLabel}>{tApp.retryButton}</Text>
          </Pressable>
          <Pressable
            testID="error-open-about-button"
            accessibilityRole="button"
            accessibilityLabel={tApp.offlineAboutA11y}
            onPress={() => setAboutModalOpen(true)}
            style={styles.errorSecondaryButton}
          >
            <Text style={styles.errorSecondaryButtonLabel}>
              {tApp.offlineAboutButton}
            </Text>
          </Pressable>
        </View>
        {aboutModalOpen ? (
          <View
            style={[
              styles.modalBackdropOverlay,
              layout.isCompact ? styles.modalBackdropCompact : null,
            ]}
          >
            <Pressable
              accessible={false}
              onPress={() => setAboutModalOpen(false)}
              style={styles.modalBackdropScrim}
            />
            <View
              style={[
                styles.modalDialogWrapper,
                {
                  maxWidth: layout.isCompact
                    ? layout.modalMaxWidth
                    : Math.max(layout.modalMaxWidth, 520),
                },
              ]}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                <AboutModal
                  visible={aboutModalOpen}
                  locale={state.locale}
                  compact={layout.isCompact}
                  privacyPolicyUrl={appendHostedPageTheme(
                    apiClient.getPrivacyPolicyUrl(),
                    activeColorScheme,
                    apiClient.getBaseUrl(),
                  )}
                  impressumUrl={appendHostedPageTheme(
                    apiClient.getImpressumUrl(),
                    activeColorScheme,
                    apiClient.getBaseUrl(),
                  )}
                  termsUrl={appendHostedPageTheme(
                    apiClient.getTermsUrl(),
                    activeColorScheme,
                    apiClient.getBaseUrl(),
                  )}
                  licensesUrl={appendHostedPageTheme(
                    apiClient.getLicensesUrl(),
                    activeColorScheme,
                    apiClient.getBaseUrl(),
                  )}
                  sourceCodeUrl="https://github.com/severinbro/Unseal"
                  abuseContact={null}
                  onClose={() => setAboutModalOpen(false)}
                />
              </ScrollView>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    );
  } else {
    const hasActivePanel = drawingToolbar.visible || selectedFeature !== null;
    const isDrawingCollapsed = drawingToolbar.visible && drawingToolbar.collapsed;
    const hasVisibleBanner =
      (mapControls.tileWarning !== null && mapControls.tileWarning.length > 0) ||
      (locationNotice !== null && locationNotice.length > 0) ||
      mapControls.showZoomInPrompt ||
      mapControls.showTruncatedNotice;
    // The button for new areas keeps its place; a docked card ends above it.
    const fabBottomPx =
      zoomDividerBottomPx !== null
        ? Math.max(12, Math.round(zoomDividerBottomPx - 24))
        : layout.isCompact
          ? 64
          : 49;
    const activeMaxHeight = drawingToolbar.visible
      ? layout.isDocked
        ? Math.max(
            160,
            layout.drawingSheetMaxHeightPx - (hasVisibleBanner ? 148 : 92),
          )
        : layout.drawingSheetMaxHeightPx
      : layout.isDocked
        ? Math.max(
            160,
            Math.min(
              layout.sheetMaxHeightPx,
              layout.height -
                NAVBAR_HEIGHT_PX -
                DOCK_INSET_PX -
                fabBottomPx -
                FAB_SIZE_PX -
                12,
            ),
          )
        : layout.sheetMaxHeightPx;
    const navbarLayout = deriveNavbarLayoutMode(layout.tier, layout.width);

    const apiBaseUrl = apiClient.getBaseUrl();
    const privacyPolicyUrl = appendHostedPageTheme(
      state.config.privacyPolicyUrl ?? apiClient.getPrivacyPolicyUrl(),
      activeColorScheme,
      apiBaseUrl,
    );
    const impressumUrl = appendHostedPageTheme(
      state.config.impressumUrl ?? apiClient.getImpressumUrl(),
      activeColorScheme,
      apiBaseUrl,
    );
    const termsUrl = appendHostedPageTheme(
      state.config.termsUrl ?? apiClient.getTermsUrl(),
      activeColorScheme,
      apiBaseUrl,
    );
    const licensesUrl = appendHostedPageTheme(
      state.config.licensesUrl ?? apiClient.getLicensesUrl(),
      activeColorScheme,
      apiBaseUrl,
    );
    const sourceCodeUrl = state.config.sourceCodeUrl ?? null;

    const latchA11yLabel = drawingToolbar.visible
      ? isDrawingCollapsed
        ? dict.drawing.expandSheetA11y
        : dict.drawing.minimizeSheetA11y
      : dict.inspector.closeA11y;

    const sheetLatchHeader = (
      <View
        {...sheetLatchPanResponder.panHandlers}
        style={styles.sheetLatchContainer}
      >
        <Pressable
          testID="sheet-grab-latch"
          accessibilityRole="button"
          accessibilityLabel={latchA11yLabel}
          accessibilityState={
            drawingToolbar.visible
              ? { expanded: !isDrawingCollapsed }
              : undefined
          }
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
          onPress={handleSheetLatchPress}
          style={({ pressed }) => [
            styles.sheetGrabHeader,
            isDrawingCollapsed ? styles.sheetGrabHeaderCollapsed : null,
            pressed ? styles.sheetGrabHeaderPressed : null,
          ]}
        >
          <View style={styles.sheetGrabPill} />
          {isDrawingCollapsed ? (
            <View style={styles.collapsedSummaryRow}>
              <View style={styles.collapsedStepBadge}>
                <Text style={styles.collapsedStepBadgeLabel}>
                  {drawingToolbar.step === 'geometry'
                    ? dict.drawing.stepGeometryLabel
                    : dict.drawing.stepDetailsLabel}
                </Text>
              </View>
              <Text style={styles.collapsedTelemetryText}>
                {drawingToolbar.distinctVertexCount}/{drawingToolbar.maxVertices}{' '}
                · {drawingToolbar.areaM2.toFixed(1)} m²
              </Text>
              <Text style={styles.collapsedExpandLabel}>
                ▲ {dict.drawing.detailsToggle}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    );

    const activePanelContent =
      hasActivePanel && !isDrawingCollapsed ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          contentContainerStyle={styles.panelScrollContent}
        >
          <DrawingToolbar
            toolbar={drawingToolbar}
            locale={state.locale}
            compact={layout.isCompact || drawingToolbar.visible}
            onUndoVertex={() => dispatch({ type: 'UNDO_VERTEX' })}
            onCloseRing={() => dispatch({ type: 'CLOSE_RING' })}
            onAdvanceToDetails={() => dispatch({ type: 'ADVANCE_TO_DETAILS' })}
            onBackToGeometry={() => dispatch({ type: 'BACK_TO_GEOMETRY' })}
            onSelectSurfaceType={(surfaceType) =>
              dispatch({ type: 'SET_DRAFT_META', surfaceType })
            }
            onChangeNote={(note) => dispatch({ type: 'SET_DRAFT_META', note })}
            onTakeDraftPhoto={handleTakeDraftPhoto}
            onPickDraftPhoto={handlePickDraftPhoto}
            onRemoveDraftPhoto={(photoId) =>
              dispatch({ type: 'REMOVE_DRAFT_PHOTO', photoId })
            }
            onRequestDiscard={() => dispatch({ type: 'REQUEST_DISCARD_DRAFT' })}
            onCancelDiscard={() => dispatch({ type: 'CANCEL_DISCARD_DRAFT' })}
            onConfirmDiscard={() => dispatch({ type: 'CONFIRM_DISCARD_DRAFT' })}
            onSubmit={() => dispatch({ type: 'SUBMIT_DRAFT' })}
            canSubmitSpace={isDraftSpaceComplete(state.draftSpace)}
            spaceSection={
              <DraftSpaceSection
                locale={state.locale}
                value={state.draftSpace}
                classification={classifyState}
                onChange={(patch) => dispatch({ type: 'SET_DRAFT_SPACE', patch })}
              />
            }
          />

          <PolygonInspectorSheet
            feature={selectedFeature}
            overlapIndex={state.overlapIndex}
            overlapCount={state.overlappingFeatureIds.length}
            disclaimerText={state.config.disclaimerText}
            abuseContact={state.config.abuseContact}
            isAuthenticated={mapControls.isAuthenticated}
            isAdmin={mapControls.isAdmin}
            locale={state.locale}
            compact={layout.isCompact}
            resolveUploadUrl={resolveUploadUrl}
            onOpenAuth={() => dispatch({ type: 'OPEN_AUTH_MODAL', view: 'login' })}
            onCycleOverlap={() => dispatch({ type: 'CYCLE_OVERLAP_FEATURE' })}
            onClose={() =>
              dispatch({ type: 'SELECT_FEATURES_AT_TAP', featureIds: [] })
            }
            onVoteIntent={(polygonId, value) =>
              dispatch({ type: 'CAST_VOTE', polygonId, value })
            }
            onCastVote={handleCastVote}
            onClearVote={handleClearVote}
            onPatchPolygon={handlePatchPolygon}
            onPatchPolygonStatus={handlePatchPolygonStatus}
            onDeletePolygon={handleDeletePolygon}
            onListPhotos={handleListPolygonPhotos}
            onUploadPhotoFromCamera={handleInspectorUploadCamera}
            onUploadPhotosFromLibrary={handleInspectorUploadLibraryBatch}
            onVotePhoto={handleVotePhoto}
            onClearPhotoVote={handleClearPhotoVote}
            onDeletePhoto={handleDeletePhoto}
            onListComments={handleListPolygonComments}
            onCreateComment={handleCreatePolygonComment}
            onVoteComment={handleVoteComment}
            onClearCommentVote={handleClearCommentVote}
            onDeleteComment={handleDeleteComment}
            onFlagPolygon={handleFlagPolygon}
            onUnflagPolygon={handleUnflagPolygon}
            onClearPolygonFlags={handleClearPolygonFlags}
            onReportContent={(target) => setContentReportTarget(target)}
            requestedTab={inspectorTabRequest}
            onShareCommentInChat={(commentId) => {
              if (selectedFeature !== null) {
                setChatStart({
                  attachment: selectedFeature,
                  comment: { id: commentId },
                });
              }
            }}
          />

          {selectedFeature !== null && !drawingToolbar.visible ? (
            <PolygonSpaceCard
              locale={state.locale}
              feature={selectedFeature}
              isAdmin={mapControls.isAdmin}
              isAuthenticated={mapControls.isAuthenticated}
              onStatus={handlePatchPolygonStatus}
              onSaveFlags={handleSavePolygonFlags}
              onSetSpaceType={handleSetSpaceType}
              onMessageAuthor={(feature) => setChatStart({ contact: feature })}
              onShareInChat={(feature) => setChatStart({ attachment: feature })}
            />
          ) : null}
        </ScrollView>
      ) : null;

    // What the land-use layer shows: the matched parts of a draft in step 2,
    // otherwise the reference areas of the visible section.
    const draftOverlay =
      isDetailsStep && classifyState.status === 'done'
        ? classifyState.result.overlay
        : null;
    const shownZones = draftOverlay ?? (zonesOn ? zones : null);
    const zonesCredit =
      shownZones !== null && shownZones.features.length > 0
        ? social.zonesCredit(formatZoneCredits(shownZones.attributions))
        : null;
    const zonesNotice = !zonesOn
      ? null
      : !zonesZoomedIn
        ? social.zonesZoomIn
        : zones === null
          ? null
          : !zones.available
            ? social.zonesUnavailable
            : zones.truncated
              ? social.zonesTruncated
              : zones.features.length === 0
                ? social.zonesNone
                : null;

    screenContent = (
      <SafeAreaView
        style={styles.appContainer}
        accessibilityHint={SESSION_TOKEN_KEY}
      >
        <MapControlsBar
          controls={mapControls}
          proposalCount={computeVisibleProposalCount(state)}
          exportGeoJsonUrl={apiClient.getExportGeoJsonUrl()}
          branding={branding}
          isImporting={isImporting}
          tier={layout.tier}
          viewportWidth={layout.width}
          moreMenuOpen={moreMenuOpen}
          onToggleMoreMenu={() => {
            setLayersPopoverOpen(false);
            setMoreMenuOpen((prev) => !prev);
          }}
          onOpenSearch={() => {
            setMoreMenuOpen(false);
            setLayersPopoverOpen(false);
            setSearchModalOpen(true);
          }}
          onToggleLocale={handleToggleLocale}
          onToggleTheme={handleToggleTheme}
          onOpenAbout={() => {
            setMoreMenuOpen(false);
            setLayersPopoverOpen(false);
            setAboutModalOpen(true);
          }}
          onOpenStats={() => {
            setMoreMenuOpen(false);
            setLayersPopoverOpen(false);
            setStatsModalTab('community');
            setStatsModalOpen(true);
          }}
          onOpenBugReport={() => setBugModalOpen(true)}
          onOpenInstallApp={() => setInstallModalOpen(true)}
          onSetBasemapMode={(mode) =>
            dispatch({ type: 'SET_BASEMAP_MODE', mode })
          }
          onSetPolygonOpacity={(opacity) =>
            dispatch({ type: 'SET_POLYGON_OPACITY', opacity })
          }
          onSetPolygonFilter={(filter) =>
            dispatch({ type: 'SET_POLYGON_FILTER', filter })
          }
          onToggleHighlightMine={() =>
            dispatch({ type: 'TOGGLE_HIGHLIGHT_MINE_ONLY' })
          }
          onStartDraw={() => dispatch({ type: 'START_DRAW' })}
          onOpenAccount={() => {
            setMoreMenuOpen(false);
            setLayersPopoverOpen(false);
            dispatch({ type: 'OPEN_AUTH_MODAL' });
          }}
          onImportPress={handleAdminImport}
          onExportError={(message) => setLocationNotice(message)}
          activeMainTab={state.activeMainTab}
          unreadChats={unreadChats}
          onSelectMainTab={(tab) => {
            setMoreMenuOpen(false);
            setLayersPopoverOpen(false);
            dispatch({ type: 'SET_MAIN_TAB', tab });
          }}
          onOpenChat={() => {
            setMoreMenuOpen(false);
            setLayersPopoverOpen(false);
            if (state.currentUser === null) {
              dispatch({ type: 'OPEN_AUTH_MODAL', view: 'login' });
            } else {
              setChatStart({});
            }
          }}
        />

      <View style={styles.mapStage}>
        {feedOpened || state.activeMainTab === 'feed' ? (
          // Kept mounted but hidden, so the list and its position survive a
          // look at the map.
          <View
            style={[
              styles.feedOverlay,
              state.activeMainTab === 'feed' ? null : styles.hidden,
            ]}
          >
            <FeedView
              locale={state.locale}
              active={state.activeMainTab === 'feed'}
              filter={state.polygonFilter}
              viewerKey={userId ?? 'guest'}
              mapConfig={state.config}
              mapBbox={state.viewport?.bbox ?? null}
              load={loadFeedPage}
              resolveUploadUrl={resolveUploadUrl}
              onVote={handleFeedVote}
              latestVote={latestVote}
              onSetFilter={(filter) =>
                dispatch({ type: 'SET_POLYGON_FILTER', filter })
              }
              onShowOnMap={showPolygonOnMap}
            />
          </View>
        ) : null}
        <View style={styles.mapCanvasFill}>
          <MapCanvas
            config={state.config}
            colorScheme={activeColorScheme}
            mode={state.mode}
            basemapMode={state.basemapMode}
            features={state.features}
            draftVertices={state.draftVertices}
            isRingClosed={state.isRingClosed}
            selectedFeatureId={state.selectedFeatureId}
            polygonOpacity={state.polygonOpacity}
            highlightMineOnly={mapControls.highlightMineOnly}
            spaceZones={shownZones?.features ?? null}
            cameraTarget={state.cameraTarget}
            northResetSeq={northResetSeq}
            onViewportChange={handleViewportChange}
            onBearingChange={handleBearingChange}
            onMapTap={handleMapTap}
            onFeaturePress={handleFeaturePress}
            onTileError={handleTileError}
            onZoomDividerOffsetChange={setZoomDividerBottomPx}
          />
        </View>

        <TopRightMapControls horizontal={layout.useHorizontalMapControls}>
          {layout.isCompact ? (
            <SearchMapButton
              locale={state.locale}
              compactSize={layout.isShortViewport}
              onPress={() => {
                setMoreMenuOpen(false);
                setLayersPopoverOpen(false);
                setSearchModalOpen(true);
              }}
              positioned={false}
            />
          ) : null}
          <MapLayersButton
            locale={state.locale}
            active={mapControls.basemapMode === 'orthophoto'}
            expanded={layersPopoverOpen}
            compactSize={layout.isShortViewport}
            onPress={() => {
              setMoreMenuOpen(false);
              setLayersPopoverOpen((prev) => !prev);
            }}
            positioned={false}
          />
          <GnssMapButton
            locale={state.locale}
            isLocating={isLocating}
            compactSize={layout.isShortViewport}
            onPress={handleLocateMe}
            positioned={false}
          />
          <NorthArrowButton
            locale={state.locale}
            bearingDeg={mapBearingDeg}
            compactSize={layout.isShortViewport}
            onPress={handleNorthReset}
            positioned={false}
          />
        </TopRightMapControls>

        <View
          pointerEvents="box-none"
          style={[
            styles.floatingTopLeftStack,
            layout.useHorizontalMapControls
              ? { right: layout.isCompact ? 218 : 168 }
              : null,
            layout.isDocked && selectedFeature !== null
              ? { left: layout.dockWidth + 26 }
              : null,
          ]}
        >
          <View pointerEvents="box-none" style={styles.floatingFilterRow}>
            <FloatingFilterStrip
              controls={mapControls}
              compact={layout.isCompact}
              onSetPolygonFilter={(filter) =>
                dispatch({ type: 'SET_POLYGON_FILTER', filter })
              }
              onToggleHighlightMine={() =>
                dispatch({ type: 'TOGGLE_HIGHLIGHT_MINE_ONLY' })
              }
            />
          </View>

          {hasVisibleBanner ? (
            <View
              pointerEvents="box-none"
              style={styles.floatingBannerBox}
            >
              <DisclaimerBanner
                controls={mapControls}
                bboxFeatureLimit={state.config.limits.bboxFeatureLimit}
                locationNotice={locationNotice}
                compact={layout.isCompact}
                onDismissDisclaimer={() =>
                  dispatch({ type: 'DISMISS_FIRST_VISIT_DISCLAIMER' })
                }
                onDismissTileWarning={() =>
                  dispatch({ type: 'DISMISS_TILE_WARNING' })
                }
                onDismissLocationNotice={() => setLocationNotice(null)}
              />
            </View>
          ) : (
            <View
              pointerEvents="none"
              style={[
                styles.legendPill,
                layout.isCompact ? styles.legendPillCompact : null,
              ]}
            >
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { backgroundColor: palette.positiveDot },
                  ]}
                />
                <Text style={styles.legendLabel}>{tApp.legendBacked}</Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { backgroundColor: palette.neutralDot },
                  ]}
                />
                <Text style={styles.legendLabel}>{tApp.legendNew}</Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { backgroundColor: palette.dangerDot },
                  ]}
                />
                <Text style={styles.legendLabel}>{tApp.legendContested}</Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { backgroundColor: palette.inProgressDot },
                  ]}
                />
                <Text style={styles.legendLabel}>{tApp.legendInProgress}</Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { backgroundColor: palette.finishedDot },
                  ]}
                />
                <Text style={styles.legendLabel}>{tApp.legendFinished}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.legendPrivateSwatch} />
                <Text style={styles.legendLabel}>{social.groundPrivate}</Text>
              </View>
            </View>
          )}
          {zonesCredit !== null ? (
            // Credit for the land-use data on screen (ODbL-1.0 § 4.3).
            <View pointerEvents="none" style={styles.legendPill}>
              <Text testID="space-zones-credit" style={styles.legendLabel}>
                {zonesCredit}
              </Text>
            </View>
          ) : null}
        </View>

        {state.mode === 'browse' && !(layout.isCompact && hasActivePanel) ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.proposeFabAnchor,
              { bottom: fabBottomPx },
            ]}
          >
            <ProposeFabButton
              controls={mapControls}
              onPress={() => {
                setMoreMenuOpen(false);
                setLayersPopoverOpen(false);
                dispatch({ type: 'START_DRAW' });
              }}
            />
          </View>
        ) : null}

        {layersPopoverOpen ? (
          // No scrim: the map stays usable while the layer manager is open.
          <View
            style={[
              styles.layersPopoverAnchor,
              layout.useHorizontalMapControls
                ? {
                    top: 56,
                    right: 10,
                    maxWidth: Math.min(280, layout.width - 20),
                  }
                : layout.isCompact
                  ? {
                      top: 68,
                      right: layout.width < 360 ? 64 : 68,
                      maxWidth: Math.min(
                        280,
                        Math.max(216, layout.width - (layout.width < 360 ? 72 : 78)),
                      ),
                    }
                  : { maxWidth: Math.min(280, layout.width - 80) },
            ]}
          >
            <MapLayersPopover
              visible={layersPopoverOpen}
              controls={mapControls}
              compact={layout.isShortViewport}
              onSetBasemapMode={(mode) =>
                dispatch({ type: 'SET_BASEMAP_MODE', mode })
              }
              onSetPolygonOpacity={(opacity) =>
                dispatch({ type: 'SET_POLYGON_OPACITY', opacity })
              }
            >
              <SpaceZonesControl
                locale={state.locale}
                on={zonesOn}
                notice={zonesNotice}
                onToggle={() => setZonesOn((on) => !on)}
              />
            </MapLayersPopover>
          </View>
        ) : null}

        {hasActivePanel && layout.isDocked ? (
          <KeyboardAvoidingView
            pointerEvents="box-none"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              styles.sideDockShell,
              drawingToolbar.visible
                ? styles.sideDockBottomShell
                : styles.sideDockTopShell,
              {
                width: layout.dockWidth,
                maxHeight: activeMaxHeight,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.sheetAnimatedContainer,
                drawingToolbar.visible ? styles.sideDockDrawingShell : null,
                {
                  maxHeight: activeMaxHeight,
                  transform: [{ translateY: sheetDragY }],
                },
              ]}
            >
              {drawingToolbar.visible ? sheetLatchHeader : null}
              {activePanelContent}
            </Animated.View>
          </KeyboardAvoidingView>
        ) : null}

        {hasActivePanel && layout.isCompact ? (
          <KeyboardAvoidingView
            pointerEvents="box-none"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.bottomSheetShell}
          >
            <Animated.View
              style={[
                styles.sheetAnimatedContainer,
                styles.compactSheetSurface,
                {
                  maxHeight: activeMaxHeight,
                  transform: [{ translateY: sheetDragY }],
                },
              ]}
            >
              {sheetLatchHeader}
              {activePanelContent}
            </Animated.View>
          </KeyboardAvoidingView>
        ) : null}
      </View>

      {moreMenuOpen ? (
        <>
          <Pressable
            accessible={false}
            onPress={() => setMoreMenuOpen(false)}
            style={styles.popoverDismissScrim}
          />
          <View
            style={[
              styles.overflowMenuAnchor,
              layout.isCompact ? styles.overflowMenuAnchorCompact : null,
              {
                maxHeight: Math.max(
                  180,
                  layout.height - (layout.isCompact ? 68 : 74),
                ),
                maxWidth: Math.min(300, layout.width - 16),
              },
            ]}
          >
            <NavbarOverflowMenu
              visible={moreMenuOpen}
              controls={mapControls}
              exportGeoJsonUrl={apiClient.getExportGeoJsonUrl()}
              impressumUrl={impressumUrl}
              privacyPolicyUrl={privacyPolicyUrl}
              isImporting={isImporting}
              showThemeToggle={navbarLayout.collapseThemeToMenu}
              showLocaleToggle={navbarLayout.collapseLocaleToMenu}
              maxHeight={Math.max(
                160,
                layout.height - (layout.isCompact ? 68 : 74),
              )}
              onClose={() => setMoreMenuOpen(false)}
              onToggleTheme={handleToggleTheme}
              onToggleLocale={handleToggleLocale}
              onOpenStats={() => {
                setLayersPopoverOpen(false);
                setStatsModalTab('community');
                setStatsModalOpen(true);
              }}
              onOpenInstallApp={() => setInstallModalOpen(true)}
              onOpenBugReport={() => setBugModalOpen(true)}
              onImportPress={handleAdminImport}
              onExportError={(message) => setLocationNotice(message)}
            />
          </View>
        </>
      ) : null}

      {searchModalOpen ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setSearchModalOpen(false)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 480),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <AddressSearchModal
                visible={searchModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                onSearch={handleAddressSearch}
                onSelectResult={handleSelectGeocodeResult}
                onClose={() => setSearchModalOpen(false)}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {bugModalOpen ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setBugModalOpen(false)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 480),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <BugReportModal
                visible={bugModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                defaultEmail={null}
                privacyPolicyUrl={privacyPolicyUrl}
                onSubmit={handleSubmitBugReport}
                onClose={() => setBugModalOpen(false)}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {chatStart !== null && state.currentUser !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setChatStart(null)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              { maxWidth: Math.max(layout.modalMaxWidth, layout.isCompact ? 0 : 520) },
            ]}
          >
            <ScrollView
              ref={chatScrollRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <DirectChatModal
                locale={state.locale}
                user={state.currentUser}
                client={apiClient}
                start={chatStart}
                retentionDays={
                  state.config.chatRetentionDays ??
                  CHAT_LIMITS.DEFAULT_RETENTION_DAYS
                }
                resolveUploadUrl={resolveUploadUrl}
                onUserUpdated={(user) => dispatch({ type: 'USER_UPDATED', user })}
                onShowPolygon={handleShowPolygonById}
                onReport={(messageId) =>
                  setContentReportTarget({
                    targetType: 'chat_message',
                    targetId: messageId,
                  })
                }
                onError={handleChatError}
                onScrollToEnd={scrollChatToEnd}
                onClose={() => setChatStart(null)}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {state.currentUser?.termsUpdateRequired === true &&
      !termsPromptDismissed &&
      !state.authModalOpen ? (
        <View
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <View
            style={[
              styles.modalDialogWrapper,
              { maxWidth: layout.modalMaxWidth },
            ]}
          >
            <TermsUpdateModal
              locale={state.locale}
              termsUrl={state.config.termsUrl ?? apiClient.getTermsUrl()}
              privacyUrl={privacyPolicyUrl}
              onAccept={() => apiClient.acceptTerms()}
              onAccepted={(user) => dispatch({ type: 'USER_UPDATED', user })}
              onLater={() => setTermsPromptDismissed(true)}
            />
          </View>
        </View>
      ) : null}

      {contentReportTarget !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setContentReportTarget(null)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 500),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <ContentReportModal
                visible={contentReportTarget !== null}
                target={contentReportTarget}
                locale={state.locale}
                compact={layout.isCompact}
                privacyPolicyUrl={privacyPolicyUrl}
                onSubmit={handleSubmitContentReport}
                onClose={() => setContentReportTarget(null)}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {pendingImportFile !== null ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            disabled={isImporting}
            onPress={() => {
              if (!isImporting) {
                setPendingImportFile(null);
              }
            }}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 520),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <AdminImportModal
                visible={pendingImportFile !== null}
                file={pendingImportFile}
                locale={state.locale}
                compact={layout.isCompact}
                onSubmit={handleSubmitAdminImport}
                onClose={() => {
                  if (!isImporting) {
                    setPendingImportFile(null);
                  }
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {aboutModalOpen ? (
        <View
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setAboutModalOpen(false)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 520),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <AboutModal
                visible={aboutModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                branding={branding}
                osmStyleUrl={state.config.osmStyleUrl}
                orthophoto={state.config.orthophoto}
                vg250AttributionEnabled={state.config.vg250AttributionEnabled}
                vg250DataYear={state.config.vg250DataYear}
                privacyPolicyUrl={privacyPolicyUrl}
                impressumUrl={impressumUrl}
                termsUrl={termsUrl}
                licensesUrl={licensesUrl}
                sourceCodeUrl={sourceCodeUrl}
                abuseContact={state.config.abuseContact}
                onClose={() => setAboutModalOpen(false)}
                onOpenInstallApp={() => {
                  setAboutModalOpen(false);
                  setInstallModalOpen(true);
                }}
              />
            </ScrollView>
          </View>
        </View>
      ) : null}

      {statsModalOpen ? (
        <View
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setStatsModalOpen(false)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 540),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <StatsModal
                visible={statsModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                isAuthenticated={mapControls.isAuthenticated}
                initialTab={statsModalTab}
                onLoadPublicStats={handleLoadPublicStats}
                onLoadPersonalStats={handleLoadPersonalStats}
                onRequestSignIn={() => {
                  setStatsModalOpen(false);
                  dispatch({ type: 'OPEN_AUTH_MODAL', view: 'login' });
                }}
                onClose={() => setStatsModalOpen(false)}
              />
            </ScrollView>
          </View>
        </View>
      ) : null}

      {installModalOpen ? (
        <View
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            onPress={() => setInstallModalOpen(false)}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              {
                maxWidth: layout.isCompact
                  ? layout.modalMaxWidth
                  : Math.max(layout.modalMaxWidth, 520),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <InstallAppModal
                visible={installModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                onClose={() => setInstallModalOpen(false)}
              />
            </ScrollView>
          </View>
        </View>
      ) : null}

      {authModal.visible ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdropOverlay,
            layout.isCompact ? styles.modalBackdropCompact : null,
          ]}
        >
          <Pressable
            accessible={false}
            disabled={!authModal.canClose}
            onPress={() => {
              if (authModal.canClose) {
                dispatch({ type: 'CLOSE_AUTH_MODAL' });
              }
            }}
            style={styles.modalBackdropScrim}
          />
          <View
            style={[
              styles.modalDialogWrapper,
              { maxWidth: layout.modalMaxWidth },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <AuthAndAccountModal
                modal={authModal}
                privacyPolicyUrl={privacyPolicyUrl}
                termsUrl={termsUrl}
                locale={state.locale}
                compact={layout.isCompact}
                onSelectView={(view) =>
                  dispatch({ type: 'SET_AUTH_MODAL_VIEW', view })
                }
                onClose={() => dispatch({ type: 'CLOSE_AUTH_MODAL' })}
                onRegister={handleRegister}
                onResendVerification={handleResendVerification}
                onLogin={handleLogin}
                onForgotPassword={handleForgotPassword}
                onLogout={handleLogout}
                onDeleteAccount={handleDeleteAccount}
                onExportData={handleExportData}
                allowDirectMessages={state.currentUser?.allowDirectMessages ?? false}
                onSetAllowDirectMessages={handleSetAllowDirectMessages}
                onOpenPersonalStats={() => {
                  dispatch({ type: 'CLOSE_AUTH_MODAL' });
                  setStatsModalTab('personal');
                  setStatsModalOpen(true);
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}
      </SafeAreaView>
    );
  }

  return (
    <ThemeProvider
      colorScheme={activeColorScheme}
      themePreference={state.themePreference}
      branding={branding}
    >
      <View style={styles.rootShell}>
        {statusBarNode}
        {screenContent}
        {introVisible ? (
          <AnimatedIntroOverlay
            locale={state.locale}
            branding={branding}
            onFinish={handleFinishIntro}
          />
        ) : null}
      </View>
    </ThemeProvider>
  );
}

export default App;

function createStyles(PALETTE: ThemePalette, isDark: boolean) {
  return StyleSheet.create({
  rootShell: {
    flex: 1,
    position: 'relative',
    backgroundColor: PALETTE.bgGround,
  },
  appContainer: {
    flex: 1,
    backgroundColor: PALETTE.bgGround,
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: PALETTE.bgGround,
  },
  statusTitle: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  errorCard: {
    maxWidth: 420,
    width: '100%',
    padding: 22,
    borderRadius: RADII.lg,
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    alignItems: 'center',
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: PALETTE.dangerText,
    textAlign: 'center',
  },
  errorBody: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 13.5,
    lineHeight: 19,
    color: PALETTE.inkSecondary,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    minWidth: 140,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: RADII.md,
    backgroundColor: PALETTE.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonLabel: {
    color: PALETTE.inkOnAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  errorSecondaryButton: {
    marginTop: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: PALETTE.borderStrong,
    backgroundColor: PALETTE.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorSecondaryButtonLabel: {
    color: PALETTE.inkPrimary,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  mapStage: {
    flex: 1,
    position: 'relative',
    backgroundColor: PALETTE.bgMapCanvas,
    overflow: 'hidden',
  },
  hidden: {
    display: 'none',
  },
  feedOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 60,
  },
  legendPrivateSwatch: {
    width: 14,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: PALETTE.inkSecondary,
  },
  mapCanvasFill: {
    flex: 1,
  },
  floatingTopLeftStack: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 68,
    gap: 8,
    alignItems: 'flex-start',
    zIndex: 15,
  },
  floatingFilterRow: {
    maxWidth: '100%',
  },
  floatingBannerBox: {
    width: '100%',
    maxWidth: 540,
  },
  legendPill: {
    maxWidth: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgFloatingPill,
    borderWidth: 1.5,
    borderBottomWidth: 3,
    borderColor: PALETTE.borderStrong,
  },
  legendPillCompact: {
    borderRadius: RADII.sm,
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  proposeFabAnchor: {
    position: 'absolute',
    left: 12,
    bottom: 56,
    zIndex: 18,
  },
  popoverDismissScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 42,
  },
  overflowMenuAnchor: {
    position: 'absolute',
    top: 60,
    right: 14,
    zIndex: 45,
  },
  overflowMenuAnchorCompact: {
    top: 56,
    right: 8,
  },
  layersPopoverAnchor: {
    position: 'absolute',
    top: 12,
    right: 68,
    zIndex: 45,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 1.5,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.22)',
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
  },
  bottomSheetShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    justifyContent: 'flex-end',
  },
  compactSheetSurface: {
    backgroundColor: PALETTE.bgSurface,
    borderTopWidth: 1,
    borderTopColor: PALETTE.borderStrong,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: isDark
            ? '0 -4px 20px rgba(0, 0, 0, 0.48)'
            : '0 -4px 16px rgba(18, 32, 25, 0.14)',
        }
      : {
          shadowColor: isDark ? '#000000' : '#122019',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: isDark ? 0.36 : 0.14,
          shadowRadius: 8,
          elevation: 8,
        }),
  },
  sheetAnimatedContainer: {
    width: '100%',
    flexShrink: 1,
  },
  sheetLatchContainer: {
    width: '100%',
  },
  sheetGrabHeader: {
    width: '100%',
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 14,
  },
  sheetGrabHeaderCollapsed: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingBottom: 10,
    gap: 6,
  },
  sheetGrabHeaderPressed: {
    backgroundColor: PALETTE.bgTinted,
  },
  sheetGrabPill: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: PALETTE.borderStrong,
  },
  collapsedSummaryRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  collapsedStepBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.accentPrimary,
  },
  collapsedStepBadgeLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: PALETTE.inkOnAccent,
  },
  collapsedTelemetryText: {
    ...TABULAR_NUMS_STYLE,
    fontFamily: MONO_FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.inkPrimary,
    flex: 1,
  },
  collapsedExpandLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: PALETTE.accentPrimary,
  },
  sideDockShell: {
    position: 'absolute',
    left: 14,
    zIndex: 20,
  },
  sideDockTopShell: {
    top: 14,
  },
  sideDockBottomShell: {
    bottom: 14,
  },
  sideDockDrawingShell: {
    backgroundColor: PALETTE.bgSurface,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    borderRadius: RADII.lg,
    overflow: 'hidden',
  },
  panelScrollContent: {
    flexGrow: 0,
  },
  modalBackdropOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalBackdropCompact: {
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  modalBackdropScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: PALETTE.bgScrim,
  },
  modalDialogWrapper: {
    width: '100%',
    maxHeight: '90%',
    borderRadius: RADII.sheet,
    overflow: 'hidden',
    zIndex: 51,
  },
  modalScrollContent: {
    flexGrow: 0,
  },
  });
}
