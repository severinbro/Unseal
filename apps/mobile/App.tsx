/**
 * Entsiegelungskartierung mobile and web root application shell.
 *
 * Workspace configuration, licensing, container packaging, E2E verification,
 * and operator deployment are defined in `README.md`, `package.json`,
 * `package-lock.json`, `tsconfig.base.json`, `tsconfig.e2e.json`, `app.json`,
 * `LICENSE`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`,
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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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
import { deriveResponsiveLayout, PALETTE, RADII } from './src/theme/tokens';
import { injectWebCraftStyles } from './src/theme/webStyles';

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

  const windowDimensions = useWindowDimensions();
  const layout = useMemo(
    () =>
      deriveResponsiveLayout(windowDimensions.width, windowDimensions.height),
    [windowDimensions.width, windowDimensions.height],
  );

  useEffect(() => {
    injectWebCraftStyles();
  }, []);

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
        <ActivityIndicator size="large" color={PALETTE.accentPrimary} />
        <Text style={styles.statusTitle}>Loading civic unsealing map…</Text>
      </SafeAreaView>
    );
  }

  if (state.configStatus === 'error' || state.config === null) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>
            Could not connect to map service
          </Text>
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
            <Text style={styles.retryButtonLabel}>Retry Connection</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const hasActivePanel = drawingToolbar.visible || selectedFeature !== null;
  const activeMaxHeight = drawingToolbar.visible
    ? layout.drawingSheetMaxHeightPx
    : layout.sheetMaxHeightPx;
  const hasVisibleBanner =
    (mapControls.showFirstVisitDisclaimer &&
      mapControls.disclaimerText !== null &&
      mapControls.disclaimerText.length > 0) ||
    (mapControls.tileWarning !== null && mapControls.tileWarning.length > 0) ||
    (locationNotice !== null && locationNotice.length > 0) ||
    mapControls.showZoomInPrompt ||
    mapControls.showTruncatedNotice;

  const activePanelContent = hasActivePanel ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator
      contentContainerStyle={styles.panelScrollContent}
    >
      <DrawingToolbar
        toolbar={drawingToolbar}
        compact={layout.isCompact}
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
        compact={layout.isCompact}
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
    </ScrollView>
  ) : null;

  return (
    <SafeAreaView
      style={styles.appContainer}
      accessibilityHint={SESSION_TOKEN_KEY}
    >
      <MapControlsBar
        controls={mapControls}
        proposalCount={state.features.length}
        exportGeoJsonUrl={apiClient.getExportGeoJsonUrl()}
        isLocating={isLocating}
        tier={layout.tier}
        onSetBasemapMode={(mode) =>
          dispatch({ type: 'SET_BASEMAP_MODE', mode })
        }
        onLocateMe={handleLocateMe}
        onStartDraw={() => dispatch({ type: 'START_DRAW' })}
        onOpenAccount={() => dispatch({ type: 'OPEN_AUTH_MODAL' })}
        onExportError={(message) => setLocationNotice(message)}
      />

      <View style={styles.mapStage}>
        <View style={styles.mapCanvasFill}>
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

        {hasVisibleBanner ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.floatingBannerOverlay,
              layout.isDocked && hasActivePanel
                ? { left: layout.dockWidth + 26, maxWidth: 520 }
                : null,
            ]}
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
              layout.isDocked && hasActivePanel
                ? { left: layout.dockWidth + 26 }
                : null,
            ]}
          >
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: PALETTE.positiveDot },
                ]}
              />
              <Text style={styles.legendLabel}>+ Backed</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: PALETTE.neutralDot },
                ]}
              />
              <Text style={styles.legendLabel}>0 New</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: PALETTE.dangerDot },
                ]}
              />
              <Text style={styles.legendLabel}>− Contested</Text>
            </View>
          </View>
        )}

        {hasActivePanel && layout.isDocked ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[
              styles.sideDockShell,
              {
                width: layout.dockWidth,
                maxHeight: activeMaxHeight,
              },
            ]}
          >
            {activePanelContent}
          </KeyboardAvoidingView>
        ) : null}
      </View>

      {hasActivePanel && layout.isCompact ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.bottomSheetShell, { maxHeight: activeMaxHeight }]}
        >
          <View style={styles.sheetGrabHeader} accessible={false}>
            <View style={styles.sheetGrabPill} />
          </View>
          {activePanelContent}
        </KeyboardAvoidingView>
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
                compact={layout.isCompact}
                onSelectView={(view) =>
                  dispatch({ type: 'SET_AUTH_MODAL_VIEW', view })
                }
                onToggleRecoveryCodeSaved={(checked) =>
                  dispatch({
                    type: 'SET_RECOVERY_CODE_SAVED_CHECKED',
                    checked,
                  })
                }
                onClose={() => dispatch({ type: 'CLOSE_AUTH_MODAL' })}
                onRegister={handleRegister}
                onLogin={handleLogin}
                onRecover={handleRecover}
                onLogout={handleLogout}
                onDeleteAccount={handleDeleteAccount}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </SafeAreaView>
  );
}

export default App;

const styles = StyleSheet.create({
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
    backgroundColor: '#DFE7E2',
    overflow: 'hidden',
  },
  mapCanvasFill: {
    flex: 1,
  },
  floatingBannerOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 58,
    maxWidth: 560,
    zIndex: 15,
  },
  legendPill: {
    position: 'absolute',
    left: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: PALETTE.borderSubtle,
    zIndex: 10,
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
  bottomSheetShell: {
    width: '100%',
    backgroundColor: PALETTE.bgSurface,
    borderTopWidth: 1,
    borderTopColor: PALETTE.borderStrong,
    overflow: 'hidden',
  },
  sheetGrabHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  sheetGrabPill: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: PALETTE.borderStrong,
  },
  sideDockShell: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 20,
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
