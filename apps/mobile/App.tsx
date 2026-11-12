import { ApiError } from '@entsiegelung/shared';
import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PpgisApiClient } from './src/api/client';
import { INTERACTIVE_PROPOSAL_LAYER_IDS, MapCanvas, ORTHOPHOTO_LAYER_ID, ORTHOPHOTO_SOURCE_ID, buildDraftGeoJson, buildDraftLayerSpecs, buildOrthophotoLayerSpec, buildOrthophotoSourceSpec, buildPolygonLayerSpecs, buildProposalGeoJson, dedupeFeatureIdsPreservingOrder, type MapCanvasProps } from './src/map';
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
          err instanceof Error ? err.message : 'Request could not be completed.';
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
          {state.configError ?? 'Please verify your network connection and retry.'}
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
      {mapControls.showFirstVisitDisclaimer && mapControls.disclaimerText ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{mapControls.disclaimerText}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss disclaimer"
            onPress={() => dispatch({ type: 'DISMISS_FIRST_VISIT_DISCLAIMER' })}
            style={styles.touchButton}
          >
            <Text style={styles.touchButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {mapControls.tileWarning ? (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{mapControls.tileWarning}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss tile warning"
            onPress={() => dispatch({ type: 'DISMISS_TILE_WARNING' })}
            style={styles.touchButton}
          >
            <Text style={styles.touchButtonText}>OK</Text>
          </Pressable>
        </View>
      ) : null}

      {mapControls.showZoomInPrompt ? (
        <View style={styles.infoBanner}>
          <Text style={styles.infoText}>{mapControls.zoomInPromptText}</Text>
        </View>
      ) : null}

      <View style={styles.workspaceBody}>
        <Text style={styles.readyTitle}>Entsiegelungskartierung</Text>
        <Text style={styles.readySubtitle}>
          Basemap: {mapControls.basemapMode.toUpperCase()} · Proposals loaded:{' '}
          {state.features.length}
        </Text>

        <View style={styles.controlsRow}>
          {mapControls.showOrthophotoToggle ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                dispatch({
                  type: 'SET_BASEMAP_MODE',
                  mode:
                    mapControls.basemapMode === 'osm' ? 'orthophoto' : 'osm',
                })
              }
              style={styles.touchButton}
            >
              <Text style={styles.touchButtonText}>
                {mapControls.basemapMode === 'osm'
                  ? 'Show Orthophoto'
                  : 'Show Street Map'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!mapControls.canStartDraw}
            onPress={() => dispatch({ type: 'START_DRAW' })}
            style={[
              styles.touchButton,
              !mapControls.canStartDraw ? styles.touchButtonDisabled : null,
            ]}
          >
            <Text style={styles.touchButtonText}>Draw Proposal</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'OPEN_AUTH_MODAL' })}
            style={styles.touchButton}
          >
            <Text style={styles.touchButtonText}>{mapControls.accountLabel}</Text>
          </Pressable>
        </View>

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

        {drawingToolbar.visible ? (
          <View style={styles.toolbarCard}>
            <Text style={styles.bannerText}>
              Vertices: {drawingToolbar.distinctVertexCount} /{' '}
              {drawingToolbar.maxVertices} · Area:{' '}
              {drawingToolbar.areaM2.toFixed(1)} m²
            </Text>
          </View>
        ) : null}

        {authModal.visible ? (
          <View style={styles.modalCard}>
            <Text style={styles.readySubtitle}>
              Account ({authModal.view})
            </Text>
            {authModal.isPostSignupRecoveryDisplay && authModal.recoveryCode ? (
              <Text style={styles.bannerText}>{authModal.recoveryCode}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={!authModal.canClose}
              onPress={() => dispatch({ type: 'CLOSE_AUTH_MODAL' })}
              style={[
                styles.touchButton,
                !authModal.canClose ? styles.touchButtonDisabled : null,
              ]}
            >
              <Text style={styles.touchButtonText}>Close</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
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
  banner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#e6f2ec',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: '#1b2a22',
  },
  warningBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff4df',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#6e4700',
  },
  infoBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#e8eef5',
  },
  infoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1f3a5c',
  },
  workspaceBody: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  readyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1b2a22',
  },
  readySubtitle: {
    fontSize: 14,
    color: '#3c4a42',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  touchButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1f6f4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchButtonDisabled: {
    backgroundColor: '#9ab5a8',
  },
  touchButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  toolbarCard: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  mapViewport: {
    flex: 1,
    minHeight: 260,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#dfe7e2',
  },
  modalCard: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    gap: 10,
  },
});
