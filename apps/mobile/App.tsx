/**
 * Entsiegelungskartierung mobile and web root application shell.
 *
 * Workspace configuration, licensing, container packaging, E2E verification,
 * and operator deployment are defined in `README.md`, `package.json`,
 * `package-lock.json`, `tsconfig.base.json`, `tsconfig.e2e.json`, `app.json`,
 * `LICENSE`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`,
 * `.dockerignore`, `001_initial_schema.sql`, and `002_v2_features.sql`.
 */
import {
  ApiError,
  type CommentVoteResponse,
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
} from '@entsiegelung/shared';
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

import { PpgisApiClient } from './src/api/client';
import { saveDataExport } from './src/media/saveDataExport';
import { AboutModal } from './src/components/AboutModal';
import { AddressSearchModal } from './src/components/AddressSearchModal';
import { AnimatedIntroOverlay } from './src/components/AnimatedIntroOverlay';
import { AuthAndAccountModal } from './src/components/AuthAndAccountModal';
import { BugReportModal } from './src/components/BugReportModal';
import { DisclaimerBanner } from './src/components/DisclaimerBanner';
import { DrawingToolbar } from './src/components/DrawingToolbar';
import {
  GnssMapButton,
  MapLayersButton,
  NorthArrowButton,
  SearchMapButton,
  TopRightMapControls,
} from './src/components/GnssMapButton';
import { InstallAppModal } from './src/components/InstallAppModal';
import {
  FloatingFilterStrip,
  MapControlsBar,
  MapLayersPopover,
  NavbarOverflowMenu,
  ProposeFabButton,
} from './src/components/MapControlsBar';
import { PolygonInspectorSheet } from './src/components/PolygonInspectorSheet';
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
  pickPhotoFromLibrary,
} from './src/media/pickers';
import {
  appReducer,
  initialAppState,
  type AppAction,
  type AppState,
} from './src/state/appState';
import {
  computeVisibleProposalCount,
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveMapControlsModel,
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
import {
  createMemoryIntroStorage,
  resolveDefaultIntroStorage,
  type IntroStorage,
} from './src/storage/introStorage';
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
  introStorage?: IntroStorage;
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
        'system';
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
  const [statsModalOpen, setStatsModalOpen] = useState<boolean>(false);
  const [statsModalTab, setStatsModalTab] = useState<StatsModalTab>('community');
  const [installModalOpen, setInstallModalOpen] = useState<boolean>(false);
  const [searchModalOpen, setSearchModalOpen] = useState<boolean>(false);
  const [bugModalOpen, setBugModalOpen] = useState<boolean>(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState<boolean>(false);
  const [layersPopoverOpen, setLayersPopoverOpen] = useState<boolean>(false);
  const [zoomDividerBottomPx, setZoomDividerBottomPx] = useState<number | null>(
    null,
  );
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const introStore = useMemo<IntroStorage>(() => {
    if (props.introStorage) {
      return props.introStorage;
    }
    if (props.ephemeralSession) {
      return createMemoryIntroStorage();
    }
    return resolveDefaultIntroStorage(Platform.OS);
  }, [props.introStorage, props.ephemeralSession]);

  const [introVisible, setIntroVisible] = useState<boolean>(() => {
    if (props.skipIntro) {
      return false;
    }
    return introStore.shouldPlayIntro();
  });

  useEffect(() => {
    if (introVisible) {
      introStore.markIntroPlayed();
    }
  }, [introStore, introVisible]);

  const handleFinishIntro = useCallback((): void => {
    introStore.markIntroPlayed();
    setIntroVisible(false);
  }, [introStore]);

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

  const activeColorScheme = resolveColorScheme(
    state.themePreference,
    systemColorScheme,
  );
  const palette = useMemo(
    () => getPalette(activeColorScheme),
    [activeColorScheme],
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
    syncWebDocumentLocale(state.locale);
  }, [state.locale]);

  useEffect(() => {
    syncWebDocumentTheme(activeColorScheme);
  }, [activeColorScheme]);

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
      state.spanTooWide
    ) {
      return;
    }

    let cancelled = false;
    const bbox = state.viewport.bbox;
    const filter = state.polygonFilter;

    void (async () => {
      try {
        const collection = await apiClient.listPolygons(bbox, {
          filter,
        });
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
    state.viewportRefreshSeq,
  ]);

  useEffect(() => {
    if (
      state.currentUser === null ||
      state.authModalOpen ||
      state.pendingIntent === null
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

    void requestCurrentCoordinates(
      undefined,
      undefined,
      state.locale,
      undefined,
      (interimFix) => {
        dispatch({
          type: 'SET_CAMERA_TARGET',
          lng: interimFix.lng,
          lat: interimFix.lat,
          zoom: zoomForAccuracyMeters(interimFix.accuracyMeters),
        });
      },
    )
      .then((gpsResult: LocateMeResult) => {
        if (gpsResult.ok) {
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
  }, [state.locale]);

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
    void pickPhotoFromLibrary(state.locale).then((outcome) => {
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

      setIsImporting(true);
      setLocationNotice(null);
      try {
        const result = await apiClient.importPolygonsFile(picked.value);
        dispatch({ type: 'REFRESH_VIEWPORT_FEATURES' });
        setLocationNotice(
          getTranslations(activeLocale).controls.importSuccess(
            result.importedCount,
            result.skippedCount,
          ),
        );
      } catch (err: unknown) {
        if (await handleSessionExpiredError(err)) {
          return;
        }
        const fallback =
          getTranslations(activeLocale).controls.importErrorFallback;
        setLocationNotice(localizeError(err, fallback, activeLocale));
      } finally {
        setIsImporting(false);
      }
    })();
  }, [apiClient, handleSessionExpiredError, state.locale]);

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

  const handlePatchPolygonStatus = useCallback(
    async (polygonId: string, status: PolygonStatus): Promise<void> => {
      try {
        const updated = await apiClient.patchPolygonStatus(polygonId, status);
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

  const handleInspectorUploadLibrary = useCallback(
    async (polygonId: string): Promise<PolygonPhoto | null> => {
      const picked = await pickPhotoFromLibrary(localeRef.current);
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
        </View>
      </SafeAreaView>
    );
  } else {
    const hasActivePanel = drawingToolbar.visible || selectedFeature !== null;
    const isDrawingCollapsed = drawingToolbar.visible && drawingToolbar.collapsed;
    const activeMaxHeight = drawingToolbar.visible
      ? layout.drawingSheetMaxHeightPx
      : layout.sheetMaxHeightPx;
    const hasVisibleBanner =
      (mapControls.tileWarning !== null && mapControls.tileWarning.length > 0) ||
      (locationNotice !== null && locationNotice.length > 0) ||
      mapControls.showZoomInPrompt ||
      mapControls.showTruncatedNotice;

    const privacyPolicyUrl =
      state.config.privacyPolicyUrl ?? apiClient.getPrivacyPolicyUrl();
    const impressumUrl =
      state.config.impressumUrl ?? apiClient.getImpressumUrl();
    const termsUrl = state.config.termsUrl ?? apiClient.getTermsUrl();
    const licensesUrl = state.config.licensesUrl ?? apiClient.getLicensesUrl();
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
            onUploadPhotoFromLibrary={handleInspectorUploadLibrary}
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
          />
        </ScrollView>
      ) : null;

    screenContent = (
      <SafeAreaView
        style={styles.appContainer}
        accessibilityHint={SESSION_TOKEN_KEY}
      >
        <MapControlsBar
          controls={mapControls}
          proposalCount={computeVisibleProposalCount(state)}
          exportGeoJsonUrl={apiClient.getExportGeoJsonUrl()}
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
        />

      <View style={styles.mapStage}>
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

        <TopRightMapControls>
          {layout.isCompact ? (
            <SearchMapButton
              locale={state.locale}
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
            onPress={() => {
              setMoreMenuOpen(false);
              setLayersPopoverOpen((prev) => !prev);
            }}
            positioned={false}
          />
          <GnssMapButton
            locale={state.locale}
            isLocating={isLocating}
            onPress={handleLocateMe}
            positioned={false}
          />
          <NorthArrowButton
            locale={state.locale}
            bearingDeg={mapBearingDeg}
            onPress={handleNorthReset}
            positioned={false}
          />
        </TopRightMapControls>

        <View
          pointerEvents="box-none"
          style={[
            styles.floatingTopLeftStack,
            layout.isDocked && hasActivePanel
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
            <View pointerEvents="none" style={styles.legendPill}>
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
            </View>
          )}
        </View>

        {state.mode === 'browse' && !(layout.isCompact && hasActivePanel) ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.proposeFabAnchor,
              {
                bottom:
                  zoomDividerBottomPx !== null
                    ? Math.max(12, Math.round(zoomDividerBottomPx - 24))
                    : layout.isCompact
                      ? 64
                      : 49,
              },
              layout.isDocked && hasActivePanel
                ? { left: layout.dockWidth + 26 }
                : null,
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
          <>
            <Pressable
              accessible={false}
              onPress={() => setLayersPopoverOpen(false)}
              style={styles.popoverDismissScrim}
            />
            <View
              style={[
                styles.layersPopoverAnchor,
                layout.isCompact ? { top: 68 } : null,
              ]}
            >
              <MapLayersPopover
                visible={layersPopoverOpen}
                controls={mapControls}
                onSetBasemapMode={(mode) =>
                  dispatch({ type: 'SET_BASEMAP_MODE', mode })
                }
                onSetPolygonOpacity={(opacity) =>
                  dispatch({ type: 'SET_POLYGON_OPACITY', opacity })
                }
              />
            </View>
          </>
        ) : null}

        {Platform.OS !== 'web' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dict.controls.aboutButtonA11y}
            onPress={() => setAboutModalOpen(true)}
            style={[
              styles.nativeAttributionPill,
              hasActivePanel && layout.isCompact && isDrawingCollapsed
                ? styles.nativeAttributionPillAboveCollapsed
                : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.nativeAttributionText}>
              {mapControls.basemapMode === 'orthophoto'
                ? tApp.nativeAttributionOrtho
                : tApp.nativeAttributionOsm}
            </Text>
          </Pressable>
        ) : null}

        {hasActivePanel && layout.isDocked ? (
          <KeyboardAvoidingView
            pointerEvents="box-none"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              styles.sideDockShell,
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
            ]}
          >
            <NavbarOverflowMenu
              visible={moreMenuOpen}
              controls={mapControls}
              exportGeoJsonUrl={apiClient.getExportGeoJsonUrl()}
              isImporting={isImporting}
              onClose={() => setMoreMenuOpen(false)}
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
              { maxWidth: Math.max(layout.modalMaxWidth, 480) },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
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
              { maxWidth: Math.max(layout.modalMaxWidth, 480) },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <BugReportModal
                visible={bugModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                defaultEmail={state.currentUser?.email ?? null}
                onSubmit={handleSubmitBugReport}
                onClose={() => setBugModalOpen(false)}
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
              { maxWidth: Math.max(layout.modalMaxWidth, 520) },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <AboutModal
                visible={aboutModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                privacyPolicyUrl={privacyPolicyUrl}
                impressumUrl={impressumUrl}
                termsUrl={termsUrl}
                licensesUrl={licensesUrl}
                sourceCodeUrl={sourceCodeUrl}
                apkDownloadUrl={mapControls.apkDownloadUrl}
                abuseContact={state.config.abuseContact}
                onClose={() => setAboutModalOpen(false)}
                onOpenInstallApp={() => {
                  setAboutModalOpen(false);
                  setInstallModalOpen(true);
                }}
                onDownloadError={(msg) => {
                  setAboutModalOpen(false);
                  setLocationNotice(msg);
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
              { maxWidth: Math.max(layout.modalMaxWidth, 540) },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
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
              { maxWidth: Math.max(layout.modalMaxWidth, 520) },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <InstallAppModal
                visible={installModalOpen}
                locale={state.locale}
                compact={layout.isCompact}
                apkDownloadUrl={mapControls.apkDownloadUrl}
                apkSha256={mapControls.apkSha256}
                onClose={() => setInstallModalOpen(false)}
                onDownloadError={(msg) => {
                  setInstallModalOpen(false);
                  setLocationNotice(msg);
                }}
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
    >
      <View style={styles.rootShell}>
        {statusBarNode}
        {screenContent}
        {introVisible ? (
          <AnimatedIntroOverlay
            locale={state.locale}
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
  mapStage: {
    flex: 1,
    position: 'relative',
    backgroundColor: PALETTE.bgMapCanvas,
    overflow: 'hidden',
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
    borderRadius: RADII.pill,
    backgroundColor: PALETTE.bgFloatingPill,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
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
    gap: 4,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: PALETTE.inkPrimary,
  },
  nativeAttributionPill: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    maxWidth: '78%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.sm,
    backgroundColor: PALETTE.bgFloatingPill,
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    zIndex: 10,
  },
  nativeAttributionPillAboveCollapsed: {
    bottom: 64,
  },
  nativeAttributionText: {
    fontSize: 10,
    color: PALETTE.inkSecondary,
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
    top: 14,
    left: 14,
    zIndex: 20,
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
    zIndex: 51,
  },
  modalScrollContent: {
    flexGrow: 0,
  },
  });
}
