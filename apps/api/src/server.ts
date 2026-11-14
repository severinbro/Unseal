import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { loadEnvConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createDbPool } from './db/pool.js';
import { createLogger } from './logger.js';
import { ensureMunicipalitiesSeededIfEnabled } from './municipalities/vg250.js';
import { PolygonRepository } from './polygons/repository.js';

import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';

const STALE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

async function runAdvisoryLockedStalePrune(
  pool: pg.Pool,
  uploadsDir: string,
  retentionDays: number,
  logger: FastifyBaseLogger,
): Promise<void> {
  const lockClient = await pool.connect();
  let acquired = false;
  try {
    const lockRes = await lockClient.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('prune_stale_unrated_polygons')) AS acquired",
    );
    acquired = Boolean(lockRes.rows[0]?.acquired);
    if (!acquired) {
      return;
    }

    const repository = new PolygonRepository(pool, uploadsDir);
    const pruned = await repository.pruneStaleUnratedPolygons(retentionDays);
    if (pruned.deletedCount > 0) {
      logger.info(
        { deletedCount: pruned.deletedCount, retentionDays },
        'Pruned stale unrated proposed polygons',
      );
    }
  } catch (err: unknown) {
    logger.error({ err }, 'Background stale polygon prune failed');
  } finally {
    if (acquired) {
      await lockClient
        .query("SELECT pg_advisory_unlock(hashtext('prune_stale_unrated_polygons'))")
        .catch(() => undefined);
    }
    lockClient.release();
  }
}

export async function startServer(): Promise<void> {
  const config = loadEnvConfig();
  const logger = createLogger();
  const pool = createDbPool(config.databaseUrl);

  await runMigrations(pool);
  const app = await buildApp(config, pool, { logger });

  const pruneTimer = setInterval(() => {
    void runAdvisoryLockedStalePrune(
      pool,
      config.uploadsDir,
      config.staleUnratedPruneDays,
      logger,
    );
  }, STALE_PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(pruneTimer);
    logger.info({ signal }, 'Shutting down API server');
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err: unknown) {
      logger.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err: unknown) {
    clearInterval(pruneTimer);
    logger.error({ err }, 'Failed to start Fastify server');
    await pool.end();
    process.exit(1);
  }

  void ensureMunicipalitiesSeededIfEnabled(
    pool,
    config.autoSeedVg250,
    logger,
  ).catch((err: unknown) => {
    logger.error({ err }, 'Background BKG VG250 municipality seed failed');
  });

  void runAdvisoryLockedStalePrune(
    pool,
    config.uploadsDir,
    config.staleUnratedPruneDays,
    logger,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void startServer();
}
