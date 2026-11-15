# VPS Deployment Guide (`docker-compose.vps.yml`)

This guide walks through deploying **Unseal** on a Linux VPS using a single Docker Compose stack (`postgis` + `api` + `caddy`).

## What Runs on Your VPS

All backend services run inside isolated Docker networks defined in [`docker-compose.vps.yml`](../docker-compose.vps.yml):

1. **`postgis` (`postgis/postgis:16-3.4-alpine` on `db_internal`):**
   - Stores both the spatial GIS tables (`polygons`, German BKG VG250 `municipalities`, `polygon_photos`) and the user/authentication tables (`users`, `sessions`, `email_tokens`, `votes`, `photo_votes`, `reserved_pseudonyms`, `reserved_emails`).
   - Air-gapped on an `internal: true` Docker network with **zero host ports exposed**.
2. **`api` (`apps/api/Dockerfile` on `db_internal` + `edge_net`):**
   - Runs numbered SQL migrations (`001_initial_schema.sql` through `007_legal_terms_consent.sql`) automatically on boot.
   - Automatically downloads and seeds Germany's **BKG VG250 OpenData municipality boundaries** (`vg250_gem`, `~11,000` municipalities) on first startup when `AUTO_SEED_VG250=true`.
   - Hosts the **clickable web pages** for email confirmation (`GET/POST /auth/verify-email?token=...`), password recovery (`GET/POST /auth/reset-password?token=...`), and legal/GDPR pages (`/auth/impressum`, `/auth/privacy`, `/auth/terms`, `/auth/licenses`).
   - Processes uploaded site photos (`<= 3 m` EXIF GPS polygon tolerance check -> `"GPS verified"`, followed by 100% EXIF stripping and WebP conversion) onto the persistent `uploads_data` Docker volume (`/uploads/*`), and optionally serves `/downloads/unseal.apk`.
3. **`caddy` (`caddy:2-alpine` on `edge_net`):**
   - Terminates HTTPS (`80`/`443`) with automatic Let's Encrypt certificates, discards per-request client IP access logs (`output discard`), proxies `/api/*`, `/auth/*`, `/uploads/*`, and `/downloads/*` to `api:3000`, and serves the static Expo Web app from `./dist-web`.

---

## Step-by-Step Setup on Your VPS

### 1. Point DNS & Open Firewall Ports `80` / `443`

1. Create an `A` (and optional `AAAA`) DNS record for your domain (e.g., `entsiegelung.example.org`) pointing to your VPS IP address.
2. Ensure TCP ports `80` and `443` (plus optional UDP `443` for HTTP/3) are open in your VPS firewall (e.g. `ufw allow 80,443/tcp`). Keep PostgreSQL (`5432`) and API (`3000`) closed.

### 2. Clone Repository & Configure `.env.vps`

```bash
git clone <your-repo-url> /opt/entsiegelung
cd /opt/entsiegelung

cp .env.vps.example .env.vps
chmod 600 .env.vps
```

Edit `.env.vps` and fill in:
- `DOMAIN` - your domain without `https://` (e.g. `entsiegelung.example.org`)
- `ACME_EMAIL` - your email for Let's Encrypt certificate expiry notices
- `POSTGRES_PASSWORD` - strong random password (`openssl rand -hex 24` - avoid `#`, `?`, or `/` characters so the connection URI needs no URL-encoding)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` - credentials for the email account that sends registration confirmation and password recovery links
- `CORS_ORIGIN` - `https://<your-domain>`
- `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `ABUSE_CONTACT`, `BUG_REPORT_TO` - legal operator contact details rendered on `/auth/impressum`, `/auth/privacy`, `/auth/terms`, and used as bug-report recipient / Nominatim contact (and `SOURCE_CODE_URL` for your AGPLv3/MPL-2.0 repository fork if applicable)

### 3. (Optional) Export the Static Web Frontend

If you want visitors opening `https://<your-domain>/` in a desktop/mobile browser to get the full interactive web app alongside native Android/iOS users:

```bash
# Can be run either on your workstation (and rsynced to ./dist-web) or directly on the VPS if Node 24 is installed:
npm ci
EXPO_PUBLIC_API_BASE_URL="https://entsiegelung.example.org" npm --workspace apps/mobile run export:web
```

If you only want the VPS to serve the mobile app backend + email verification/recovery pages, simply create an empty directory so the read-only mount exists:

```bash
mkdir -p dist-web
```

### 4. Start the Stack

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

Follow the startup logs (migrations + automatic BKG VG250 municipality seeding):

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f api
```

Verify HTTPS health and the hosted legal/privacy/recovery endpoints:

```bash
curl -fsS https://entsiegelung.example.org/api/v1/health
curl -I https://entsiegelung.example.org/auth/impressum
curl -I https://entsiegelung.example.org/auth/privacy
curl -I https://entsiegelung.example.org/auth/terms
curl -I https://entsiegelung.example.org/auth/licenses
```

---

## Promoting Your Admin Account

Only `admin` accounts can:
- Set a polygon status to **`⟳ Wird entsiegelt` (`in_progress`)** or **`✓ Entsiegelt` (`finished`)** (or reopen it to `proposed`), and
- Bulk-import `.geojson` or `.gpkg` polygon datasets.

1. Register your normal account inside the app and click the confirmation link sent to your email.
2. On the VPS, grant your pseudonym the `admin` role:

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml exec api \
  node apps/api/dist/cli/admin.js grant-admin <your_pseudonym>
```

*(To revoke later: replace `grant-admin` with `revoke-admin`.)*

---

## Refreshing BKG VG250 Municipalities Manually

If `AUTO_SEED_VG250` was disabled or you want to refresh municipality boundaries after annual BKG OpenData updates (or from a local `.geojson` file):

```bash
# Fetch live from BKG OpenData WFS (vg250_gem):
docker compose --env-file .env.vps -f docker-compose.vps.yml exec api \
  node apps/api/dist/cli/admin.js load-vg250

# Or load from a local GeoJSON FeatureCollection copied into the container:
docker compose --env-file .env.vps -f docker-compose.vps.yml exec api \
  node apps/api/dist/cli/admin.js load-vg250 /path/to/vg250_gem.geojson
```

---

## Pointing the Android / iOS App at Your VPS

When building the Android APK/AAB or iOS build for production devices, pass `EXPO_PUBLIC_API_BASE_URL` pointing to your HTTPS VPS domain, and configure release signing in the generated `android/app/build.gradle` + keystore environment variables (see **Section 3** of [`docs/installation.md`](./installation.md#3-android-release-signing--manifest-hardening) for the exact `build.gradle` and `AndroidManifest.xml` steps after `expo prebuild`):

```bash
cd apps/mobile
EXPO_PUBLIC_API_BASE_URL="https://entsiegelung.example.org" npx expo prebuild

# Generate a release keystore once (back it up safely outside git!):
# keytool -genkeypair -v -storetype PKCS12 -keystore unseal-release.keystore -alias unseal-upload -keyalg RSA -keysize 4096 -validity 10000

export UNSEAL_UPLOAD_STORE_FILE="/path/to/unseal-release.keystore"
export UNSEAL_UPLOAD_STORE_PASSWORD="<store-password>"
export UNSEAL_UPLOAD_KEY_ALIAS="unseal-upload"
export UNSEAL_UPLOAD_KEY_PASSWORD="<key-password>"
(cd android && ./gradlew assembleRelease)
```

If you distribute the signed APK via the VPS (`/downloads/unseal.apk`), place it at `<UPLOADS_DIR>/unseal.apk` (or mount it to `APK_FILE_PATH`). The API automatically detects the file and advertises both `apkDownloadUrl` and its SHA-256 checksum (`apkSha256`) on `/api/v1/config`.

---

## Backups (PostGIS + Uploaded Photos)

Back up both the PostGIS database and the `uploads_data` WebP photo volume regularly:

```bash
# 1. Logical PostGIS dump (includes users, polygons, municipalities, votes, and photo metadata)
docker compose --env-file .env.vps -f docker-compose.vps.yml exec -T postgis \
  pg_dump -U ppgis -Fc ppgis > backup-db-$(date +%Y%m%d).dump

# 2. Compressed archive of EXIF-stripped WebP site photos
docker compose --env-file .env.vps -f docker-compose.vps.yml exec -T api \
  tar -C /var/lib/entsiegelung/uploads -czf - . > backup-photos-$(date +%Y%m%d).tar.gz
```
