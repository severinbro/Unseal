// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AUTH_LIMITS,
  ApiError,
  EmailSchema,
  LAND_COVER_CATEGORIES,
  LAND_COVER_SOURCES,
  POLYGON_ORIGINS,
  RESERVED_PSEUDONYMS,
  TRUST_AND_MODERATION_LIMITS,
  UuidParamSchema,
  type LandCoverCategory,
  type LandCoverSource,
  type PolygonOrigin,
  type SpaceType,
} from '@openunseal/shared';

import {
  emailTombstoneCandidates,
  hashCanonicalEmail,
  hashPseudonymTombstone,
  pseudonymTombstoneCandidates,
} from '../auth/crypto.js';
import {
  createSmtpMailer,
  type AuthMailer,
  type ModerationActionKind,
} from '../auth/mailer.js';
import {
  assertEmailNotReserved,
  assertPseudonymNotReserved,
} from '../auth/tombstones.js';
import { loadEnvConfig, resolveTombstoneSecret } from '../config.js';
import { deleteOrBanUserAccount } from '../db/integrity.js';
import {
  collectTelemetryExport,
  type TelemetryExportReport,
} from '../db/telemetry.js';
import { unlinkUploadFiles } from '../photos/uploadFiles.js';
import {
  collectUserData,
  findUserIdByIdentifier,
  type UserDataExport,
} from '../users/dataExport.js';
import { createDbPool } from '../db/pool.js';
import { createLogger } from '../logger.js';
import { loadVg250Municipalities } from '../municipalities/vg250.js';
import { deleteChatMessageAsOperator } from '../chat/repository.js';
import { loadLandCoverFile } from '../polygons/landCover.js';
import { PolygonRepository } from '../polygons/repository.js';
import {
  createWebhookDispatcher,
  emitPolygonsDeleted,
  type WebhookDispatcher,
} from '../util/webhooks.js';
import {
  loadSpaceZonesFile,
  type SpaceZoneSource,
} from '../polygons/spaceZonesLoader.js';

import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

export type AdminCommandName =
  | 'ban-user'
  | 'delete-polygon'
  | 'delete-comment'
  | 'delete-chat-message'
  | 'load-space-zones'
  | 'set-space-type'
  | 'redact-note'
  | 'grant-admin'
  | 'revoke-admin'
  | 'load-vg250'
  | 'load-landcover'
  | 'prune-stale-polygons'
  | 'export-user'
  | 'set-email'
  | 'rename-user'
  | 'lift-ban'
  | 'set-polygon-origin'
  | 'export-telemetry';

export interface AdminCommandResult {
  command: AdminCommandName;
  pseudonym?: string;
  email?: string | null;
  role?: 'user' | 'admin';
  reason?: string;
  deletedUser?: boolean;
  deletedPolygonCount?: number;
  recomputedPolygonIds?: string[];
  polygonId?: string;
  commentId?: string;
  chatMessageId?: string;
  deletedChatMessage?: boolean;
  spaceType?: SpaceType;
  spaceZoneSource?: SpaceZoneSource;
  importedSpaceZoneCount?: number;
  skippedSpaceZoneCount?: number;
  deletedPolygon?: boolean;
  deletedComment?: boolean;
  redactedNote?: boolean;
  upsertedMunicipalities?: number;
  backfilledPolygons?: number;
  landCoverSource?: LandCoverSource;
  importedLandCoverCount?: number;
  skippedLandCoverCount?: number;
  prunedPolygonIds?: string[];
  previousPseudonym?: string;
  userExport?: UserDataExport;
  liftedPseudonymBans?: number;
  liftedEmailBans?: number;
  polygonOrigin?: PolygonOrigin;
  updatedPolygonCount?: number;
  telemetryExport?: TelemetryExportReport;
}

/** Splits `--name=value` options, `--flag` switches and positional arguments. */
function parseDatasetArgs(args: readonly string[]): {
  positional: string[];
  flags: Set<string>;
  options: Record<string, string | undefined>;
} {
  const positional: string[] = [];
  const flags = new Set<string>();
  const options: Record<string, string | undefined> = {};
  for (const arg of args) {
    const match = /^--(license|attribution|source-url)=(.*)$/s.exec(arg);
    if (match) {
      options[match[1]!] = match[2]!;
    } else if (arg === '--replace' || arg === '--waiver-confirmed') {
      flags.add(arg.slice(2));
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, options };
}

async function rollbackPreservingError(
  client: pg.PoolClient,
  originalError: unknown,
): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackErr: unknown) {
    if (originalError instanceof Error && !('rollbackError' in originalError)) {
      Object.assign(originalError, { rollbackError: rollbackErr });
    }
  }
}

function parseValidatedPseudonym(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? '';
  if (!AUTH_LIMITS.PSEUDONYM_REGEX.test(trimmed)) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Pseudonym must be 3 to 32 characters containing only letters, digits, underscores, or hyphens.',
    );
  }
  const lower = trimmed.toLowerCase();
  if ((RESERVED_PSEUDONYMS as readonly string[]).includes(lower)) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `Reserved system pseudonym "${trimmed}" cannot be banned.`,
    );
  }
  return trimmed;
}

function parseValidatedPolygonId(raw: string | undefined): string {
  const parsed = UuidParamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Polygon ID must be a valid UUID.',
    );
  }
  return parsed.data.id;
}

function parseUserIdentifier(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length < 3 || trimmed.length > AUTH_LIMITS.MAX_EMAIL_LENGTH) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Please specify a valid user pseudonym or email address.',
    );
  }
  return trimmed.toLowerCase();
}

function parseIsoCalendarDate(raw: string | undefined, flagName: string): string {
  const trimmed = raw?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `${flagName} must be an ISO calendar date in YYYY-MM-DD format.`,
    );
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      `${flagName} is not a valid calendar date.`,
    );
  }
  return trimmed;
}

export interface AdminCommandOptions {
  uploadsDir?: string;
  logger?: FastifyBaseLogger;
  /** Public origin used for absolute photo URLs in `export-user` (defaults to `PUBLIC_BASE_URL`). */
  publicBaseUrl?: string;
  /** HMAC key for tombstones; defaults to `TOMBSTONE_SECRET` from the environment. */
  tombstoneSecret?: string;
  /** Optional mailer for DSA Art. 17 statements of reasons on moderation actions. */
  mailer?: AuthMailer;
  termsUrl?: string;
  impressumUrl?: string;
  abuseContact?: string | null;
  /** Announces deletions to the configured webhook receiver. */
  webhookDispatcher?: WebhookDispatcher;
}

const DEFAULT_ADMIN_MODERATION_REASON =
  'Verstoß gegen die Nutzungsbedingungen oder Meldung nach Art. 16 DSA / Violation of Terms of Use or DSA Art. 16 notice.';

async function sendAdminModerationNoticeBestEffort(
  options: AdminCommandOptions,
  params: {
    to: string | null;
    pseudonym: string | null;
    action: ModerationActionKind;
    targetId: string | null;
    reason?: string | undefined;
  },
): Promise<void> {
  if (!options.mailer || !params.to) {
    return;
  }
  const baseUrl = (options.publicBaseUrl ?? 'http://127.0.0.1:3000').replace(
    /\/+$/,
    '',
  );
  try {
    await options.mailer.sendModerationReasonEmail({
      to: params.to,
      pseudonym: params.pseudonym ?? 'OpenUnseal-Nutzer/in',
      action: params.action,
      targetId: params.targetId,
      reason: params.reason?.trim() || DEFAULT_ADMIN_MODERATION_REASON,
      automatedMeansUsed: false,
      contactEmail: options.abuseContact ?? null,
      termsUrl: options.termsUrl ?? `${baseUrl}/auth/terms`,
      impressumUrl: options.impressumUrl ?? `${baseUrl}/auth/impressum`,
      actedAtIso: new Date().toISOString(),
    });
  } catch (err: unknown) {
    options.logger?.warn(
      { err, action: params.action, targetId: params.targetId },
      'Failed to send DSA Art. 17 moderation notice email from admin CLI',
    );
  }
}

export async function runAdminCommand(
  pool: pg.Pool,
  argv: string[],
  options: AdminCommandOptions = {},
): Promise<AdminCommandResult> {
  const command = argv[0];
  const tombstoneSecret = options.tombstoneSecret ?? resolveTombstoneSecret();

  if (command === 'grant-admin' || command === 'revoke-admin') {
    if (argv.length !== 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        `Usage: ${command} <pseudonym-or-email>`,
      );
    }
    const identifier = parseUserIdentifier(argv[1]);
    const targetRole: 'user' | 'admin' =
      command === 'grant-admin' ? 'admin' : 'user';

    const res = await pool.query<{
      pseudonym: string;
      email: string | null;
      role: 'user' | 'admin';
    }>(
      `UPDATE users
       SET
         role = $2,
         email_verified_at = CASE
           WHEN $2 = 'admin' THEN COALESCE(email_verified_at, clock_timestamp())
           ELSE email_verified_at
         END
       WHERE LOWER(pseudonym) = $1
          OR LOWER(email) = $1
       RETURNING pseudonym, email, role`,
      [identifier, targetRole],
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new ApiError(404, 'NOT_FOUND', 'User account not found.');
    }

    return {
      command,
      pseudonym: updated.pseudonym,
      email: updated.email,
      role: updated.role,
    };
  }

  if (command === 'load-vg250') {
    if (argv.length > 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: load-vg250 [localGeoJsonPathOrWfsUrl]',
      );
    }
    const loaded = await loadVg250Municipalities(
      pool,
      argv[1],
      options.logger,
    );
    return {
      command: 'load-vg250',
      upsertedMunicipalities: loaded.upsertedMunicipalities,
      backfilledPolygons: loaded.backfilledPolygons,
    };
  }

  if (command === 'load-space-zones') {
    const { positional, flags, options: opts } = parseDatasetArgs(argv.slice(1));
    const source = positional[0];
    if (
      positional.length !== 2 ||
      (source !== 'alkis' && source !== 'osm_local') ||
      opts.license === undefined
    ) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: load-space-zones <alkis|osm_local> <filePath> --license=<id> [--attribution=<text>] [--source-url=<url>] [--waiver-confirmed] [--replace]',
      );
    }
    const loaded = await loadSpaceZonesFile(pool, positional[1]!, {
      source,
      license: opts.license,
      attribution: opts.attribution,
      sourceUrl: opts['source-url'],
      waiverConfirmed: flags.has('waiver-confirmed'),
      replaceSource: flags.has('replace'),
    });
    return {
      command: 'load-space-zones',
      spaceZoneSource: loaded.source,
      importedSpaceZoneCount: loaded.importedCount,
      skippedSpaceZoneCount: loaded.skippedCount,
    };
  }

  if (command === 'set-space-type') {
    const polygonId = parseValidatedPolygonId(argv[1]);
    const spaceType = argv[2];
    if (argv.length !== 3 || (spaceType !== 'public' && spaceType !== 'private')) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: set-space-type <polygonId> <public|private>',
      );
    }
    await new PolygonRepository(pool).setSpaceTypeAsAdmin({
      polygonId,
      adminUserId: null,
      spaceType,
    });
    return { command: 'set-space-type', polygonId, spaceType };
  }

  if (command === 'load-landcover') {
    const { positional, flags, options: opts } = parseDatasetArgs(argv.slice(1));
    const replaceSource = flags.has('replace');
    if (positional.length < 2 || positional.length > 3) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: load-landcover <osm|alkis> <filePath> [defaultCategory] [--replace] [--license=<id> --attribution=<text> --source-url=<url> --waiver-confirmed]',
      );
    }

    const rawSource = positional[0]?.trim().toLowerCase() ?? '';
    if (!(LAND_COVER_SOURCES as readonly string[]).includes(rawSource)) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Land-cover source must be "osm" or "alkis".',
      );
    }
    const source = rawSource as LandCoverSource;
    const filePath = positional[1]!;

    let defaultCategory: LandCoverCategory | undefined;
    if (positional[2] !== undefined) {
      const rawCat = positional[2].trim().toLowerCase();
      if (!(LAND_COVER_CATEGORIES as readonly string[]).includes(rawCat)) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          `Invalid land-cover category "${positional[2]}".`,
        );
      }
      defaultCategory = rawCat as LandCoverCategory;
    }

    const loaded = await loadLandCoverFile(pool, filePath, {
      source,
      defaultCategory,
      replaceSource,
      ...(opts.license !== undefined
        ? {
            license: opts.license,
            attribution: opts.attribution,
            sourceUrl: opts['source-url'],
            waiverConfirmed: flags.has('waiver-confirmed'),
          }
        : {}),
    });
    return {
      command: 'load-landcover',
      landCoverSource: loaded.source,
      importedLandCoverCount: loaded.importedCount,
      skippedLandCoverCount: loaded.skippedCount,
    };
  }

  if (command === 'prune-stale-polygons') {
    if (argv.length > 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: prune-stale-polygons [retentionDays]',
      );
    }

    let retentionDays: number =
      TRUST_AND_MODERATION_LIMITS.STALE_UNRATED_PRUNE_DAYS;
    if (argv[1] !== undefined) {
      const parsedDays = Number(argv[1]);
      if (!Number.isInteger(parsedDays) || parsedDays < 1) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'retentionDays must be a positive integer.',
        );
      }
      retentionDays = parsedDays;
    }

    const repo = new PolygonRepository(pool, options.uploadsDir);
    const pruned = await repo.pruneStaleUnratedPolygons(retentionDays);
    if (options.webhookDispatcher) {
      emitPolygonsDeleted(options.webhookDispatcher, pruned.deletedIds, false);
    }
    return {
      command: 'prune-stale-polygons',
      deletedPolygonCount: pruned.deletedCount,
      prunedPolygonIds: pruned.deletedIds,
    };
  }

  if (command === 'ban-user') {
    const pseudonymInput = parseValidatedPseudonym(argv[1]);
    const pseudonymLower = pseudonymInput.toLowerCase();
    const rawReason = argv.slice(2).join(' ').trim();
    const hasExplicitReason =
      rawReason.length > 0 && rawReason !== 'self_deleted';
    const resolvedReason = hasExplicitReason ? rawReason : 'banned';

    const client = await pool.connect();
    let deletedPhotoFiles: string[] = [];
    try {
      await client.query('BEGIN');

      const userRes = await client.query<{
        id: string;
        pseudonym: string;
        email: string | null;
      }>(
        'SELECT id, pseudonym, email FROM users WHERE LOWER(pseudonym) = $1 FOR UPDATE',
        [pseudonymLower],
      );
      const userRow = userRes.rows[0];

      if (userRow) {
        const banResult = await deleteOrBanUserAccount(client, {
          userId: userRow.id,
          pseudonymLower,
          mode: 'ban',
          reason: resolvedReason,
          tombstoneSecret,
        });
        deletedPhotoFiles = banResult.deletedPhotoFiles;
        await client.query('COMMIT');
        if (options.webhookDispatcher) {
          emitPolygonsDeleted(options.webhookDispatcher, banResult.deletedPolygonIds, true);
        }

        if (options.uploadsDir && deletedPhotoFiles.length > 0) {
          await unlinkUploadFiles(options.uploadsDir, deletedPhotoFiles);
        }

        await sendAdminModerationNoticeBestEffort(options, {
          to: userRow.email,
          pseudonym: userRow.pseudonym,
          action: 'account_banned',
          targetId: userRow.id,
          reason: resolvedReason,
        });

        return {
          command: 'ban-user',
          pseudonym: userRow.pseudonym,
          reason: resolvedReason,
          deletedUser: banResult.deletedUser,
          deletedPolygonCount: banResult.deletedPolygonCount,
          recomputedPolygonIds: banResult.recomputedPolygonIds,
        };
      }

      const tombstoneHash = hashPseudonymTombstone(tombstoneSecret, pseudonymLower);
      const upsertRes = await client.query<{ reason: string }>(
        `INSERT INTO reserved_pseudonyms (pseudonym_hash, reason)
         VALUES ($1, $2)
         ON CONFLICT (pseudonym_hash) DO UPDATE
         SET reason = CASE
           WHEN reserved_pseudonyms.reason <> 'self_deleted' AND NOT $3::boolean
             THEN reserved_pseudonyms.reason
           ELSE EXCLUDED.reason
         END
         RETURNING reason`,
        [tombstoneHash, resolvedReason, hasExplicitReason],
      );
      const persistedReason = upsertRes.rows[0]?.reason ?? resolvedReason;

      await client.query('COMMIT');

      return {
        command: 'ban-user',
        pseudonym: pseudonymInput,
        reason: persistedReason,
        deletedUser: false,
        deletedPolygonCount: 0,
        recomputedPolygonIds: [],
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  if (command === 'delete-polygon') {
    if (argv.length < 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: delete-polygon <polygonId> [reason]',
      );
    }
    const polygonId = parseValidatedPolygonId(argv[1]);
    const reason = argv.slice(2).join(' ').trim() || undefined;

    const client = await pool.connect();
    let photoFiles: Array<{ file_name: string; thumb_name: string }> = [];
    let authorEmail: string | null = null;
    let authorPseudonym: string | null = null;
    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{
        id: string;
        user_id: string | null;
      }>('SELECT id, user_id FROM polygons WHERE id = $1 FOR UPDATE', [
        polygonId,
      ]);
      const locked = lockRes.rows[0];
      if (!locked) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      if (locked.user_id !== null) {
        const authorRes = await client.query<{
          email: string | null;
          pseudonym: string;
        }>('SELECT email, pseudonym FROM users WHERE id = $1', [locked.user_id]);
        authorEmail = authorRes.rows[0]?.email ?? null;
        authorPseudonym = authorRes.rows[0]?.pseudonym ?? null;
      }

      const photosRes = await client.query<{
        file_name: string;
        thumb_name: string;
      }>(
        'SELECT file_name, thumb_name FROM polygon_photos WHERE polygon_id = $1',
        [polygonId],
      );
      photoFiles = photosRes.rows;

      await client.query('DELETE FROM polygons WHERE id = $1', [polygonId]);
      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    if (options.uploadsDir && photoFiles.length > 0) {
      for (const pf of photoFiles) {
        await fs
          .unlink(path.join(options.uploadsDir, pf.file_name))
          .catch(() => undefined);
        await fs
          .unlink(path.join(options.uploadsDir, pf.thumb_name))
          .catch(() => undefined);
      }
    }

    if (options.webhookDispatcher) {
      emitPolygonsDeleted(options.webhookDispatcher, [polygonId], true);
    }

    await sendAdminModerationNoticeBestEffort(options, {
      to: authorEmail,
      pseudonym: authorPseudonym,
      action: 'polygon_deleted',
      targetId: polygonId,
      reason,
    });

    return {
      command: 'delete-polygon',
      polygonId,
      ...(reason ? { reason } : {}),
      deletedPolygon: true,
    };
  }

  if (command === 'redact-note') {
    if (argv.length < 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: redact-note <polygonId> [reason]',
      );
    }
    const polygonId = parseValidatedPolygonId(argv[1]);
    const reason = argv.slice(2).join(' ').trim() || undefined;

    const client = await pool.connect();
    let authorEmail: string | null = null;
    let authorPseudonym: string | null = null;
    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{
        id: string;
        user_id: string | null;
      }>('SELECT id, user_id FROM polygons WHERE id = $1 FOR UPDATE', [
        polygonId,
      ]);
      const locked = lockRes.rows[0];
      if (!locked) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      if (locked.user_id !== null) {
        const authorRes = await client.query<{
          email: string | null;
          pseudonym: string;
        }>('SELECT email, pseudonym FROM users WHERE id = $1', [locked.user_id]);
        authorEmail = authorRes.rows[0]?.email ?? null;
        authorPseudonym = authorRes.rows[0]?.pseudonym ?? null;
      }

      await client.query(
        'UPDATE polygons SET note = NULL, updated_at = NOW() WHERE id = $1',
        [polygonId],
      );
      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    await sendAdminModerationNoticeBestEffort(options, {
      to: authorEmail,
      pseudonym: authorPseudonym,
      action: 'note_redacted',
      targetId: polygonId,
      reason,
    });

    return {
      command: 'redact-note',
      polygonId,
      ...(reason ? { reason } : {}),
      redactedNote: true,
    };
  }

  if (command === 'delete-comment') {
    if (argv.length < 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: delete-comment <commentId> [reason]',
      );
    }
    const parsedId = UuidParamSchema.safeParse(argv[1]);
    if (!parsedId.success) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Comment ID must be a valid UUID.',
      );
    }
    const commentId = parsedId.data.id;
    const reason = argv.slice(2).join(' ').trim() || undefined;

    const client = await pool.connect();
    let polygonId = '';
    let authorEmail: string | null = null;
    let authorPseudonym: string | null = null;
    try {
      await client.query('BEGIN');

      const lookupRes = await client.query<{
        polygon_id: string;
        user_id: string | null;
      }>('SELECT polygon_id, user_id FROM polygon_comments WHERE id = $1', [
        commentId,
      ]);
      const lookup = lookupRes.rows[0];
      if (!lookup) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }
      polygonId = lookup.polygon_id;

      await client.query('SELECT id FROM polygons WHERE id = $1 FOR UPDATE', [
        lookup.polygon_id,
      ]);

      if (lookup.user_id !== null) {
        const authorRes = await client.query<{
          email: string | null;
          pseudonym: string;
        }>('SELECT email, pseudonym FROM users WHERE id = $1', [
          lookup.user_id,
        ]);
        authorEmail = authorRes.rows[0]?.email ?? null;
        authorPseudonym = authorRes.rows[0]?.pseudonym ?? null;
      }

      const delRes = await client.query(
        'DELETE FROM polygon_comments WHERE id = $1',
        [commentId],
      );
      if (delRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }
      await client.query(
        `UPDATE polygons
         SET comment_count = (
           SELECT COUNT(*)::int FROM polygon_comments WHERE polygon_id = $1
         )
         WHERE id = $1`,
        [lookup.polygon_id],
      );
      await client.query('COMMIT');
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }

    await sendAdminModerationNoticeBestEffort(options, {
      to: authorEmail,
      pseudonym: authorPseudonym,
      action: 'comment_deleted',
      targetId: commentId,
      reason,
    });

    return {
      command: 'delete-comment',
      polygonId,
      commentId,
      ...(reason ? { reason } : {}),
      deletedComment: true,
    };
  }

  // Removal of a direct message reported by a participant (DSA Art. 16/17)
  if (command === 'delete-chat-message') {
    const parsedId = UuidParamSchema.safeParse(argv[1]);
    if (!parsedId.success) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: delete-chat-message <messageId> [reason]',
      );
    }
    const chatMessageId = parsedId.data.id;
    const reason = argv.slice(2).join(' ').trim() || undefined;
    const deleted = await deleteChatMessageAsOperator(pool, chatMessageId);
    await sendAdminModerationNoticeBestEffort(options, {
      to: deleted.senderEmail,
      pseudonym: deleted.senderPseudonym,
      action: 'chat_message_deleted',
      targetId: chatMessageId,
      reason,
    });
    return {
      command: 'delete-chat-message',
      chatMessageId,
      ...(reason ? { reason } : {}),
      deletedChatMessage: true,
    };
  }

  // GDPR Art. 15/20: operator-side data export (e.g. for requests received by email)
  if (command === 'export-user') {
    if (argv.length !== 2) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Usage: export-user <pseudonym-or-email>');
    }
    const userId = await findUserIdByIdentifier(pool, parseUserIdentifier(argv[1]));
    const userExport = await collectUserData(pool, userId, {
      publicBaseUrl: options.publicBaseUrl ?? loadEnvConfig().publicBaseUrl,
    });
    return {
      command: 'export-user',
      pseudonym: userExport.account.pseudonym,
      userExport,
    };
  }

  // GDPR Art. 16: rectify a user's email address after the operator verified the request
  if (command === 'set-email') {
    if (argv.length !== 3) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: set-email <pseudonym-or-email> <new-email>',
      );
    }
    const identifier = parseUserIdentifier(argv[1]);
    const parsedEmail = EmailSchema.safeParse(argv[2]);
    if (!parsedEmail.success) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Please specify a valid new email address.');
    }
    const newEmailLower = parsedEmail.data.toLowerCase();
    const canonicalHash = hashCanonicalEmail(tombstoneSecret, newEmailLower);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = await findUserIdByIdentifier(client, identifier);
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      await assertEmailNotReserved(client, tombstoneSecret, newEmailLower);
      const takenRes = await client.query(
        `SELECT 1 FROM users
         WHERE id <> $1 AND (LOWER(email) = $2 OR canonical_email_hash = $3)
         LIMIT 1`,
        [userId, newEmailLower, canonicalHash],
      );
      if ((takenRes.rowCount ?? 0) > 0) {
        throw new ApiError(409, 'AUTH_EMAIL_TAKEN', 'This email address is already registered.');
      }
      const updatedRes = await client.query<{ pseudonym: string; email: string }>(
        `UPDATE users
         SET email = $2,
             canonical_email_hash = $3,
             email_verified_at = COALESCE(email_verified_at, clock_timestamp()),
             failed_login_attempts = 0,
             login_blocked_at = NULL
         WHERE id = $1
         RETURNING pseudonym, email`,
        [userId, newEmailLower, canonicalHash],
      );
      // Pending confirmation/reset links were sent to the previous address
      await client.query(
        'DELETE FROM email_tokens WHERE user_id = $1 AND consumed_at IS NULL',
        [userId],
      );
      await client.query('COMMIT');
      const updated = updatedRes.rows[0]!;
      return { command: 'set-email', pseudonym: updated.pseudonym, email: updated.email };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  // GDPR Art. 16: rectify a pseudonym (e.g. one that turned out to reveal a real name)
  if (command === 'rename-user') {
    if (argv.length !== 3) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: rename-user <pseudonym-or-email> <new-pseudonym>',
      );
    }
    const identifier = parseUserIdentifier(argv[1]);
    const newPseudonym = argv[2]?.trim() ?? '';
    if (!AUTH_LIMITS.PSEUDONYM_REGEX.test(newPseudonym)) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Pseudonym must be 3 to 32 characters containing only letters, digits, underscores, or hyphens.',
      );
    }
    const newLower = newPseudonym.toLowerCase();
    if ((RESERVED_PSEUDONYMS as readonly string[]).includes(newLower)) {
      throw new ApiError(409, 'AUTH_PSEUDONYM_TAKEN', 'This pseudonym is reserved.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = await findUserIdByIdentifier(client, identifier);
      const currentRes = await client.query<{ pseudonym: string }>(
        'SELECT pseudonym FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const previousPseudonym = currentRes.rows[0]!.pseudonym;
      if (previousPseudonym.toLowerCase() !== newLower) {
        await assertPseudonymNotReserved(client, tombstoneSecret, newLower);
        const takenRes = await client.query(
          'SELECT 1 FROM users WHERE LOWER(pseudonym) = $1 AND id <> $2 LIMIT 1',
          [newLower, userId],
        );
        if ((takenRes.rowCount ?? 0) > 0) {
          throw new ApiError(409, 'AUTH_PSEUDONYM_TAKEN', 'This pseudonym is already taken.');
        }
        // Reserve the old pseudonym like a self-deletion (keyed tombstone, expires
        // after PSEUDONYM_RESERVATION_DAYS) so nobody can impersonate the user.
        await client.query(
          `INSERT INTO reserved_pseudonyms (pseudonym_hash, reason)
           VALUES ($1, 'self_deleted')
           ON CONFLICT (pseudonym_hash) DO NOTHING`,
          [hashPseudonymTombstone(tombstoneSecret, previousPseudonym)],
        );
      }
      await client.query('UPDATE users SET pseudonym = $2 WHERE id = $1', [
        userId,
        newPseudonym,
      ]);
      await client.query('COMMIT');
      return { command: 'rename-user', pseudonym: newPseudonym, previousPseudonym };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  // Ban tombstones are kept until lifted (GDPR Art. 17/21: end the restriction when no longer justified)
  if (command === 'lift-ban') {
    if (argv.length < 2 || argv.length > 3) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Usage: lift-ban <pseudonym> [email]');
    }
    const pseudonymInput = parseValidatedPseudonym(argv[1]);
    let emailInput: string | null = null;
    if (argv[2] !== undefined) {
      const parsedEmail = EmailSchema.safeParse(argv[2]);
      if (!parsedEmail.success) {
        throw new ApiError(422, 'VALIDATION_ERROR', 'Please specify a valid email address.');
      }
      emailInput = parsedEmail.data.toLowerCase();
    }
    const pseudoRes = await pool.query(
      `DELETE FROM reserved_pseudonyms
       WHERE pseudonym_hash = ANY($1::bytea[])
         AND reason <> 'self_deleted'`,
      [pseudonymTombstoneCandidates(tombstoneSecret, pseudonymInput)],
    );
    let liftedEmailBans = 0;
    if (emailInput !== null) {
      const emailRes = await pool.query(
        'DELETE FROM reserved_emails WHERE email_hash = ANY($1::bytea[])',
        [emailTombstoneCandidates(tombstoneSecret, emailInput)],
      );
      liftedEmailBans = emailRes.rowCount ?? 0;
    }
    return {
      command: 'lift-ban',
      pseudonym: pseudonymInput,
      liftedPseudonymBans: pseudoRes.rowCount ?? 0,
      liftedEmailBans,
    };
  }

  if (command === 'set-polygon-origin') {
    const rawOrigin = argv[1]?.trim().toLowerCase() ?? '';
    if (!(POLYGON_ORIGINS as readonly string[]).includes(rawOrigin)) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: set-polygon-origin <citizen|initiative_import|remote_sensing> <--user <pseudonym-or-email> | --before <isoDateOrTimestamp> | --polygon <polygonId> | --all>',
      );
    }
    const polygonOrigin = rawOrigin as PolygonOrigin;
    const selectorFlag = argv[2]?.trim() ?? '';

    if (selectorFlag === '--all' && argv.length === 3) {
      const res = await pool.query(
        'UPDATE polygons SET origin = $1 WHERE origin <> $1',
        [polygonOrigin],
      );
      return {
        command: 'set-polygon-origin',
        polygonOrigin,
        updatedPolygonCount: res.rowCount ?? 0,
      };
    }

    if (selectorFlag === '--polygon' && argv.length === 4) {
      const polygonId = parseValidatedPolygonId(argv[3]);
      const res = await pool.query(
        'UPDATE polygons SET origin = $1 WHERE id = $2',
        [polygonOrigin, polygonId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }
      return {
        command: 'set-polygon-origin',
        polygonId,
        polygonOrigin,
        updatedPolygonCount: res.rowCount ?? 0,
      };
    }

    if (selectorFlag === '--user' && argv.length === 4) {
      const identifier = parseUserIdentifier(argv[3]);
      const userId = await findUserIdByIdentifier(pool, identifier);
      const res = await pool.query(
        'UPDATE polygons SET origin = $1 WHERE user_id = $2',
        [polygonOrigin, userId],
      );
      return {
        command: 'set-polygon-origin',
        polygonOrigin,
        updatedPolygonCount: res.rowCount ?? 0,
      };
    }

    if (selectorFlag === '--before' && argv.length === 4) {
      const rawCutoff = argv[3]?.trim() ?? '';
      const parsedMs = Date.parse(rawCutoff);
      if (rawCutoff.length === 0 || Number.isNaN(parsedMs)) {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          '--before requires a valid ISO 8601 date or timestamp (e.g. 2026-11-16 or 2026-11-15T23:59:59Z).',
        );
      }
      const cutoffIso = new Date(parsedMs).toISOString();
      const res = await pool.query(
        'UPDATE polygons SET origin = $1 WHERE created_at < $2::timestamptz',
        [polygonOrigin, cutoffIso],
      );
      return {
        command: 'set-polygon-origin',
        polygonOrigin,
        updatedPolygonCount: res.rowCount ?? 0,
      };
    }

    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Usage: set-polygon-origin <citizen|initiative_import|remote_sensing> <--user <pseudonym-or-email> | --before <isoDateOrTimestamp> | --polygon <polygonId> | --all>',
    );
  }

  if (command === 'export-telemetry') {
    let since: string | null = null;
    let until: string | null = null;
    let idx = 1;
    while (idx < argv.length) {
      const flag = argv[idx];
      if (flag === '--since') {
        since = parseIsoCalendarDate(argv[idx + 1], '--since');
        idx += 2;
      } else if (flag === '--until') {
        until = parseIsoCalendarDate(argv[idx + 1], '--until');
        idx += 2;
      } else {
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'Usage: export-telemetry [--since YYYY-MM-DD] [--until YYYY-MM-DD]',
        );
      }
    }

    if (since !== null && until !== null && since > until) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        '--since must not be later than --until.',
      );
    }

    const telemetryExport = await collectTelemetryExport(pool, {
      since,
      until,
    });
    return {
      command: 'export-telemetry',
      telemetryExport,
    };
  }

  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    'Unsupported admin command. Supported commands: grant-admin <user>, revoke-admin <user>, load-vg250 [source], load-landcover <osm|alkis> <filePath> [defaultCategory] [--replace] [--license=<id> ...], load-space-zones <alkis|osm_local> <filePath> --license=<id> [...], set-space-type <polygonId> <public|private>, prune-stale-polygons [retentionDays], ban-user <pseudonym> [reason], lift-ban <pseudonym> [email], delete-polygon <polygonId>, delete-comment <commentId>, delete-chat-message <messageId> [reason], redact-note <polygonId>, export-user <user>, set-email <user> <newEmail>, rename-user <user> <newPseudonym>, set-polygon-origin <origin> <--user|--before|--polygon|--all>, export-telemetry [--since YYYY-MM-DD] [--until YYYY-MM-DD].',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  const config = loadEnvConfig();
  // Log to stderr so a redirected export (`> export.json`) stays valid JSON.
  const logger = createLogger({ stream: process.stderr });
  const pool = createDbPool(config.databaseUrl);
  const mailer = createSmtpMailer(config, logger);
  const webhookDispatcher = createWebhookDispatcher({
    config: config.webhook,
    instance: {
      appName: config.branding.appName,
      publicBaseUrl: config.publicBaseUrl,
    },
    logger,
  });

  runAdminCommand(pool, process.argv.slice(2), {
    uploadsDir: config.uploadsDir,
    logger,
    tombstoneSecret: config.tombstoneSecret,
    publicBaseUrl: config.publicBaseUrl,
    mailer,
    termsUrl: config.termsUrl,
    impressumUrl: config.impressumUrl,
    abuseContact: config.abuseContact ?? config.operatorEmail,
    webhookDispatcher,
  })
    .then(async (result) => {
      await webhookDispatcher.flush();
      if (result.userExport) {
        // Print the export itself to stdout (redirect to a file); never into the log stream.
        process.stdout.write(`${JSON.stringify(result.userExport, null, 2)}\n`);
        logger.info(
          { command: result.command, pseudonym: result.pseudonym },
          'Admin data export written to stdout',
        );
      } else if (result.telemetryExport) {
        process.stdout.write(`${JSON.stringify(result.telemetryExport, null, 2)}\n`);
        logger.info(
          { command: result.command, window: result.telemetryExport.window },
          'Research telemetry export written to stdout',
        );
      } else {
        logger.info({ result }, 'Admin moderation command completed');
      }
      await pool.end();
    })
    .catch(async (err: unknown) => {
      logger.error({ err }, 'Admin moderation command failed');
      await pool.end();
      process.exit(1);
    });
}
