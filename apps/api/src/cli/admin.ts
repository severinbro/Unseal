import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AUTH_LIMITS,
  ApiError,
  LAND_COVER_CATEGORIES,
  LAND_COVER_SOURCES,
  RESERVED_PSEUDONYMS,
  TRUST_AND_MODERATION_LIMITS,
  UuidParamSchema,
  type LandCoverCategory,
  type LandCoverSource,
} from '@entsiegelung/shared';

import { hashPseudonymTombstone } from '../auth/crypto.js';
import { loadEnvConfig, resolveTombstoneSecret } from '../config.js';
import { deleteOrBanUserAccount } from '../db/integrity.js';
import { createDbPool } from '../db/pool.js';
import { createLogger } from '../logger.js';
import { loadVg250Municipalities } from '../municipalities/vg250.js';
import { loadLandCoverFile } from '../polygons/landCover.js';
import { PolygonRepository } from '../polygons/repository.js';

import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

export type AdminCommandName =
  | 'ban-user'
  | 'delete-polygon'
  | 'delete-comment'
  | 'redact-note'
  | 'grant-admin'
  | 'revoke-admin'
  | 'load-vg250'
  | 'load-landcover'
  | 'prune-stale-polygons';

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
  deletedPolygon?: boolean;
  deletedComment?: boolean;
  redactedNote?: boolean;
  upsertedMunicipalities?: number;
  backfilledPolygons?: number;
  landCoverSource?: LandCoverSource;
  importedLandCoverCount?: number;
  skippedLandCoverCount?: number;
  prunedPolygonIds?: string[];
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

export interface AdminCommandOptions {
  uploadsDir?: string;
  logger?: FastifyBaseLogger;
  /** HMAC key for tombstones; defaults to `TOMBSTONE_SECRET` from the environment. */
  tombstoneSecret?: string;
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

  if (command === 'load-landcover') {
    const replaceSource = argv.includes('--replace');
    const positional = argv.slice(1).filter((arg) => arg !== '--replace');
    if (positional.length < 2 || positional.length > 3) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: load-landcover <osm|alkis> <filePath> [defaultCategory] [--replace]',
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

      const userRes = await client.query<{ id: string; pseudonym: string }>(
        'SELECT id, pseudonym FROM users WHERE LOWER(pseudonym) = $1 FOR UPDATE',
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

        if (options.uploadsDir && deletedPhotoFiles.length > 0) {
          for (const fileName of deletedPhotoFiles) {
            await fs
              .unlink(path.join(options.uploadsDir, fileName))
              .catch(() => undefined);
          }
        }

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
    if (argv.length !== 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: delete-polygon <polygonId>',
      );
    }
    const polygonId = parseValidatedPolygonId(argv[1]);

    const client = await pool.connect();
    let photoFiles: Array<{ file_name: string; thumb_name: string }> = [];
    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{ id: string }>(
        'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
        [polygonId],
      );
      if (lockRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
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

    return {
      command: 'delete-polygon',
      polygonId,
      deletedPolygon: true,
    };
  }

  if (command === 'redact-note') {
    if (argv.length !== 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: redact-note <polygonId>',
      );
    }
    const polygonId = parseValidatedPolygonId(argv[1]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{ id: string }>(
        'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
        [polygonId],
      );
      if (lockRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query(
        'UPDATE polygons SET note = NULL, updated_at = NOW() WHERE id = $1',
        [polygonId],
      );
      await client.query('COMMIT');

      return {
        command: 'redact-note',
        polygonId,
        redactedNote: true,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  if (command === 'delete-comment') {
    if (argv.length !== 2) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'Usage: delete-comment <commentId>',
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lookupRes = await client.query<{ polygon_id: string }>(
        'SELECT polygon_id FROM polygon_comments WHERE id = $1',
        [commentId],
      );
      const lookup = lookupRes.rows[0];
      if (!lookup) {
        throw new ApiError(404, 'NOT_FOUND', 'Comment not found.');
      }

      await client.query('SELECT id FROM polygons WHERE id = $1 FOR UPDATE', [
        lookup.polygon_id,
      ]);
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

      return {
        command: 'delete-comment',
        polygonId: lookup.polygon_id,
        commentId,
        deletedComment: true,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
  }

  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    'Unsupported admin command. Supported commands: grant-admin <user>, revoke-admin <user>, load-vg250 [source], load-landcover <osm|alkis> <filePath> [defaultCategory] [--replace], prune-stale-polygons [retentionDays], ban-user <pseudonym> [reason], delete-polygon <polygonId>, delete-comment <commentId>, redact-note <polygonId>.',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  const config = loadEnvConfig();
  const logger = createLogger();
  const pool = createDbPool(config.databaseUrl);

  runAdminCommand(pool, process.argv.slice(2), {
    uploadsDir: config.uploadsDir,
    logger,
    tombstoneSecret: config.tombstoneSecret,
  })
    .then(async (result) => {
      logger.info({ result }, 'Admin moderation command completed');
      await pool.end();
    })
    .catch(async (err: unknown) => {
      logger.error({ err }, 'Admin moderation command failed');
      await pool.end();
      process.exit(1);
    });
}
