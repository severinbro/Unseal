import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import { loadEnvConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createDbPool } from './db/pool.js';
import { createLogger } from './logger.js';
import { ensureMunicipalitiesSeededIfEnabled } from './municipalities/vg250.js';

export async function startServer(): Promise<void> {
  const config = loadEnvConfig();
  const logger = createLogger();
  const pool = createDbPool(config.databaseUrl);

  await runMigrations(pool);
  const app = await buildApp(config, pool, { logger });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
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
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void startServer();
}
