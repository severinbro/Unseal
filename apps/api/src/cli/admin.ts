import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AUTH_LIMITS,
  ApiError,
  RESERVED_PSEUDONYMS,
  UuidParamSchema,
} from '@entsiegelung/shared';

import { hashPseudonymTombstone } from '../auth/crypto.js';
import { loadEnvConfig } from '../config.js';
import { deleteOrBanUserAccount } from '../db/integrity.js';
import { createDbPool } from '../db/pool.js';
import { createLogger } from '../logger.js';

import type pg from 'pg';

export type AdminCommandName = 'ban-user' | 'delete-polygon' | 'redact-note';

export interface AdminCommandResult {
  command: AdminCommandName;
  pseudonym?: string;
  reason?: string;
  deletedUser?: boolean;
  deletedPolygonCount?: number;
  recomputedPolygonIds?: string[];
  polygonId?: string;
  deletedPolygon?: boolean;
  redactedNote?: boolean;
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

export async function runAdminCommand(
  pool: pg.Pool,
  argv: string[],
): Promise<AdminCommandResult> {
  const command = argv[0];

  if (command === 'ban-user') {
    const pseudonymInput = parseValidatedPseudonym(argv[1]);
    const pseudonymLower = pseudonymInput.toLowerCase();
    const rawReason = argv.slice(2).join(' ').trim();
    const hasExplicitReason =
      rawReason.length > 0 && rawReason !== 'self_deleted';
    const resolvedReason = hasExplicitReason ? rawReason : 'banned';

    const client = await pool.connect();
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
        });
        await client.query('COMMIT');

        return {
          command: 'ban-user',
          pseudonym: userRow.pseudonym,
          reason: resolvedReason,
          deletedUser: banResult.deletedUser,
          deletedPolygonCount: banResult.deletedPolygonCount,
          recomputedPolygonIds: banResult.recomputedPolygonIds,
        };
      }

      const tombstoneHash = hashPseudonymTombstone(pseudonymLower);
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
    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{ id: string }>(
        'SELECT id FROM polygons WHERE id = $1 FOR UPDATE',
        [polygonId],
      );
      if (lockRes.rowCount === 0) {
        throw new ApiError(404, 'NOT_FOUND', 'Polygon not found.');
      }

      await client.query('DELETE FROM polygons WHERE id = $1', [polygonId]);
      await client.query('COMMIT');

      return {
        command: 'delete-polygon',
        polygonId,
        deletedPolygon: true,
      };
    } catch (err: unknown) {
      await rollbackPreservingError(client, err);
      throw err;
    } finally {
      client.release();
    }
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

  throw new ApiError(
    422,
    'VALIDATION_ERROR',
    'Unsupported admin command. Supported commands: ban-user <pseudonym> [reason], delete-polygon <polygonId>, redact-note <polygonId>.',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  const config = loadEnvConfig();
  const logger = createLogger();
  const pool = createDbPool(config.databaseUrl);

  runAdminCommand(pool, process.argv.slice(2))
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
