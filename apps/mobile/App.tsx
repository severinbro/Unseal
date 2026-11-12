/**
 * Entsiegelungskartierung mobile and web root application shell.
 *
 * Workspace configuration, licensing, container packaging, E2E verification,
 * and operator deployment are defined in `README.md`, `package.json`,
 * `tsconfig.base.json`, `tsconfig.e2e.json`, `app.json`, `LICENSE`,
 * `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`,
 * `.dockerignore`, and `001_initial_schema.sql`.
 */
import {
  ApiError,
  type LoginRequest,
  type PatchPolygonRequest,
  type PolygonFeature,
  type RecoverRequest,
  type RegisterRequest,
} from '@entsiegelung/shared';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PpgisApiClient } from './src/api/client';
import { AuthAndAccountModal } from './src/components/AuthAndAccountModal';
import { DisclaimerBanner } from './src/components/DisclaimerBanner';
import { DrawingToolbar } from './src/components/DrawingToolbar';
import { MapControlsBar } from './src/components/MapControlsBar';
import { PolygonInspectorSheet } from './src/components/PolygonInspectorSheet';
import { requestCurrentCoordinates } from './src/location/locateMe';
import type { LocateMeResult } from './src/location/locateMe.types';
import {
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
  type MapCanvasProps,
} from './src/map';
import {
  appReducer,
  initialAppState,
  type AppAction,
  type AppState,
} from './src/state/appState';
import {
  deriveAuthModalModel,
  deriveDrawingToolbarModel,
  deriveMapControlsModel,
} from './src/state/viewModels';
import { platformSessionStorage } from './src/storage/secureStorage';
import {
  createMemorySessionStorage,
  SESSION_TOKEN_KEY,
  type SessionStorage,
} from './src/storage/tokenStorage';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000';
const LOCATE_ME_TARGET_ZOOM = 17;

export const mapStylePrimitives = {
  ORTHOPHOTO_SOURCE_ID,
  ORTHOPHOTO_LAYER_ID,
  INTERACTIVE_PROPOSAL_LAYER_IDS,
  dedupeFeatureIdsPreservingOrder,
  buildProposalGeoJson,
  buildDraftGeoJson,
  buildOrthophotoSourceSpec,
  buildOrthophotoLayerSpec,
  buildPolygonLayerSpecs,
  buildDraftLayerSpecs,
} as const;

function resolveDefaultApiBaseUrl(): string {
  const envObj = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const configured = envObj?.['EXPO_PUBLIC_API_BASE_URL'];
  return configured && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_API_BASE_URL;
}

export interface AppProps {
  baseUrl?: string;
  sessionStorage?: SessionStorage;
  ephemeralSession?: boolean;
  apiClient?: PpgisApiClient;
  exp?: Record<string, unknown>;
}

export function App(props: AppProps = {}): React.JSX.Element {
  const [state, dispatch] = useReducer<React.Reducer<AppState, AppAction>>(
    appReducer,
    initialAppState,
  );
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const storage = useMemo<SessionStorage>(() => {
    if (props.sessionStorage) {
      return props.sessionStorage;
    }
    if (props.ephemeralSession) {
      return createMemorySessionStorage();
    }
    return platformSessionStorage;
  }, [props.sessionStorage, props.ephemeralSession]);

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
      const config = await apiClient.getConfig();
      dispatch({ type: 'CONFIG_LOADED', config });

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
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to load map configuration.';
      dispatch({ type: 'CONFIG_ERROR', message });
    }
  }, [apiClient, storage]);

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

    void (async () => {
      try {
        const collection = await apiClient.listPolygons(bbox);
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
    state.viewportRefreshSeq,
  ]);

  useEffect(() => {
    if (
      state.currentUser === null ||
      state.authModalOpen ||
      state.pendingRecoveryCode !== null ||
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
          if (!cancelled) {
            dispatch({ type: 'POLYGON_CREATED', feature: created });
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
        const message =
          err instanceof Error
            ? err.message
            : 'Request could not be completed.';
        dispatch({ type: 'CLEAR_PENDING_INTENT' });
        if (activeIntent.type === 'SUBMIT_DRAFT') {
          dispatch({ type: 'SUBMIT_ERROR_PRESERVE_DRAFT', message });
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
    state.pendingRecoveryCode,
    state.pendingIntent,
  ]);

  const mapControls = deriveMapControlsModel(state);
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

  const handleViewportChange = useCallback<MapCanvasProps['onViewportChange']>(
    ({ bbox, zoom }) => {
      dispatch({ type: 'SET_VIEWPORT', bbox, zoom });
    },
    [],
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

    void requestCurrentCoordinates()
      .then((gpsResult: LocateMeResult) => {
        if (gpsResult.ok) {
          dispatch({
            type: 'SET_CAMERA_TARGET',
            lng: gpsResult.lng,
            lat: gpsResult.lat,
            zoom: LOCATE_ME_TARGET_ZOOM,
          });
        } else {
          setLocationNotice(gpsResult.reason);
        }
      })
      .finally(() => {
        setIsLocating(false);
      });
  }, []);

  const handleRegister = useCallback(
    async (input: RegisterRequest): Promise<void> => {
      const registered = await apiClient.register(input);
      dispatch({
        type: 'AUTH_SUCCEEDED',
        user: registered.user,
        recoveryCode: registered.recoveryCode,
      });
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

  const handleRecover = useCallback(
    async (input: RecoverRequest): Promise<void> => {
      const recovered = await apiClient.recover(input);
      dispatch({
        type: 'AUTH_SUCCEEDED',
        user: recovered.user,
        recoveryCode: recovered.recoveryCode,
      });
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

  const handleDeleteAccount = useCallback(async (): Promise<void> => {
    try {
      await apiClient.deleteMe();
      dispatch({ type: 'ACCOUNT_DELETED' });
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

  if (state.configStatus === 'loading') {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <ActivityIndicator size="large" color="#1f6f4a" />
        <Text style={styles.statusTitle}>Loading map configuration…</Text>
      </SafeAreaView>
    );
  }

  if (state.configStatus === 'error' || state.config === null) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <Text style={styles.errorTitle}>Could not connect to map service</Text>
        <Text style={styles.errorBody}>
          {state.configError ??
            'Please verify your network connection and retry.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading map configuration"
          onPress={() => {
            void bootstrapApp();
          }}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonLabel}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.appContainer}
      accessibilityHint={SESSION_TOKEN_KEY}
    >
      <DisclaimerBanner
        controls={mapControls}
        bboxFeatureLimit={state.config.limits.bboxFeatureLimit}
        locationNotice={locationNotice}
        onDismissDisclaimer={() =>
          dispatch({ type: 'DISMISS_FIRST_VISIT_DISCLAIMER' })
        }
        onDismissTileWarning={() => dispatch({ type: 'DISMISS_TILE_WARNING' })}
        onDismissLocationNotice={() => setLocationNotice(null)}
      />

      <ScrollView
        style={styles.workspaceScroll}
        contentContainerStyle={styles.workspaceBody}
        keyboardShouldPersistTaps="handled"
      >
        <MapControlsBar
          controls={mapControls}
          proposalCount={state.features.length}
          exportGeoJsonUrl={apiClient.getExportGeoJsonUrl()}
          isLocating={isLocating}
          onSetBasemapMode={(mode) =>
            dispatch({ type: 'SET_BASEMAP_MODE', mode })
          }
          onLocateMe={handleLocateMe}
          onStartDraw={() => dispatch({ type: 'START_DRAW' })}
          onOpenAccount={() => dispatch({ type: 'OPEN_AUTH_MODAL' })}
          onExportError={(message) => setLocationNotice(message)}
        />

        <View style={styles.mapViewport}>
          <MapCanvas
            config={state.config}
            mode={state.mode}
            basemapMode={state.basemapMode}
            features={state.features}
            draftVertices={state.draftVertices}
            isRingClosed={state.isRingClosed}
            selectedFeatureId={state.selectedFeatureId}
            cameraTarget={state.cameraTarget}
            onViewportChange={handleViewportChange}
            onMapTap={handleMapTap}
            onFeaturePress={handleFeaturePress}
            onTileError={handleTileError}
          />
        </View>

        <DrawingToolbar
          toolbar={drawingToolbar}
          onUndoVertex={() => dispatch({ type: 'UNDO_VERTEX' })}
          onCloseRing={() => dispatch({ type: 'CLOSE_RING' })}
          onSelectSurfaceType={(surfaceType) =>
            dispatch({ type: 'SET_DRAFT_META', surfaceType })
          }
          onChangeNote={(note) => dispatch({ type: 'SET_DRAFT_META', note })}
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
          onDeletePolygon={handleDeletePolygon}
        />

        <AuthAndAccountModal
          modal={authModal}
          onSelectView={(view) =>
            dispatch({ type: 'SET_AUTH_MODAL_VIEW', view })
          }
          onToggleRecoveryCodeSaved={(checked) =>
            dispatch({ type: 'SET_RECOVERY_CODE_SAVED_CHECKED', checked })
          }
          onClose={() => dispatch({ type: 'CLOSE_AUTH_MODAL' })}
          onRegister={handleRegister}
          onLogin={handleLogin}
          onRecover={handleRecover}
          onLogout={handleLogout}
          onDeleteAccount={handleDeleteAccount}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

export default App;

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#f5f7f5',
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f5f7f5',
  },
  statusTitle: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#1b2a22',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8a1f1f',
    textAlign: 'center',
  },
  errorBody: {
    marginTop: 8,
    marginBottom: 20,
    fontSize: 14,
    color: '#3c4a42',
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1f6f4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  workspaceScroll: {
    flex: 1,
  },
  workspaceBody: {
    flexGrow: 1,
    padding: 14,
    gap: 12,
  },
  mapViewport: {
    flex: 1,
    minHeight: 320,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#dfe7e2',
  },
});
