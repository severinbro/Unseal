# VPS Deployment Guide (`docker-compose.vps.yml`)

This guide walks through deploying **OpenUnseal** on a Linux VPS using a single Docker Compose stack (`postgis` + `api` + `caddy`).

## What Runs on Your VPS

All backend services run inside isolated Docker networks defined in [`docker-compose.vps.yml`](../docker-compose.vps.yml):

1. **`postgis` (`postgis/postgis:16-3.4-alpine` on `db_internal`):**
   - Stores both the spatial GIS tables (`polygons`, German BKG VG250 `municipalities`, `polygon_photos`) and the user/authentication tables (`users`, `sessions`, `email_tokens`, `votes`, `photo_votes`, `reserved_pseudonyms`, `reserved_emails`).
   - Air-gapped on an `internal: true` Docker network with **zero host ports exposed**.
2. **`api` (`apps/api/Dockerfile` on `db_internal` + `edge_net`):**
   - Runs numbered SQL migrations (`001_initial_schema.sql` through `011_import_attributions.sql`) automatically on boot and re-keys canonical email hashes with `TOMBSTONE_SECRET`.
   - Runs an hourly privacy retention job (unconfirmed sign-ups after 48 h, expired sessions, stale email links, expired pseudonym reservations).
   - Logs only request id, method, URL path, status and timing - no client IPs, headers or query strings. Container logs are rotated (3 × 10 MB per service).
   - Automatically downloads and seeds Germany's **BKG VG250 OpenData municipality boundaries** (`vg250_gem`, `~11,000` municipalities) on first startup when `AUTO_SEED_VG250=true`.
   - Hosts the **clickable web pages** for email confirmation (`GET/POST /auth/verify-email?token=...`), password recovery (`GET/POST /auth/reset-password?token=...`), and legal/GDPR pages (`/auth/impressum`, `/auth/privacy`, `/auth/terms`, `/auth/licenses`).
   - Processes uploaded site photos (`<= 3 m` EXIF GPS polygon tolerance check -> `"GPS verified"`, followed by 100% EXIF stripping and WebP conversion) onto the persistent `uploads_data` Docker volume (`/uploads/*`), and optionally serves `/downloads/openunseal.apk`.
3. **`caddy` (`caddy:2-alpine` on `edge_net`):**
   - Terminates HTTPS (`80`/`443`) with automatic Let's Encrypt certificates, discards per-request client IP access logs (`output discard`), proxies `/api/*`, `/auth/*`, `/uploads/*`, and `/downloads/*` to `api:3000`, and serves the static Expo Web app from `./dist-web`.

---

## Step-by-Step Setup on Your VPS

### 1. Point DNS & Open Firewall Ports `80` / `443`

1. Create an `A` (and optional `AAAA`) DNS record for your domain (e.g., `openunseal.example.org`) pointing to your VPS IP address.
2. Ensure TCP ports `80` and `443` (plus optional UDP `443` for HTTP/3) are open in your VPS firewall (e.g. `ufw allow 80,443/tcp`). Keep PostgreSQL (`5432`) and API (`3000`) closed.

### 2. Clone Repository & Configure `.env.vps`

```bash
git clone <your-repo-url> /opt/entsiegelung
cd /opt/entsiegelung

cp .env.vps.example .env.vps
chmod 600 .env.vps
```

Edit `.env.vps` and fill in:
- `DOMAIN` - your domain without `https://` (e.g. `openunseal.example.org`)
- `ACME_EMAIL` - your email for Let's Encrypt certificate expiry notices
- `POSTGRES_PASSWORD` - strong random password (`openssl rand -hex 24` - avoid `#`, `?`, or `/` characters so the connection URI needs no URL-encoding)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` - credentials for the email account that sends registration confirmation and password recovery links (`SMTP_REQUIRE_TLS=true` keeps them off unencrypted connections)
- `TOMBSTONE_SECRET` - **required**: `openssl rand -hex 32`. Keys the hashes of deleted pseudonyms and banned emails; keep it stable and back it up with `.env.vps` (rotating it lifts existing bans)
- `PRIVACY_HOSTING_PROVIDER`, `PRIVACY_EMAIL_PROVIDER`, `BACKUP_RETENTION_DAYS` - shown on `/auth/privacy` (processors and how long backups are kept)
- `CORS_ORIGIN` - `https://<your-domain>`
- `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `ABUSE_CONTACT`, `BUG_REPORT_TO` - legal operator contact details rendered on `/auth/impressum`, `/auth/privacy`, `/auth/terms`, and used as bug-report recipient / Nominatim contact (and `SOURCE_CODE_URL` for your AGPLv3/MPL-2.0 repository fork if applicable)

### 3. (Optional) Export the Static Web Frontend

If you want visitors opening `https://<your-domain>/` in a desktop/mobile browser to get the full interactive web app alongside native Android/iOS users:

```bash
# Can be run either on your workstation (and rsynced to ./dist-web) or directly on the VPS if Node 24 is installed:
npm ci
EXPO_PUBLIC_API_BASE_URL="https://openunseal.example.org" npm --workspace apps/mobile run export:web
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
curl -fsS https://openunseal.example.org/api/v1/health
curl -I https://openunseal.example.org/auth/impressum
curl -I https://openunseal.example.org/auth/privacy
curl -I https://openunseal.example.org/auth/terms
curl -I https://openunseal.example.org/auth/licenses
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
EXPO_PUBLIC_API_BASE_URL="https://openunseal.example.org" npx expo prebuild
cd ../..

# Generate a release keystore once (back it up safely outside git!):
# keytool -genkeypair -v -storetype PKCS12 -keystore openunseal-release.keystore -alias openunseal-upload -keyalg RSA -keysize 4096 -validity 10000

cp .env.apk.example .env.apk
chmod 600 .env.apk
# Edit .env.apk with EXPO_PUBLIC_API_BASE_URL and OPENUNSEAL_UPLOAD_* keystore credentials
source .env.apk && (cd apps/mobile/android && ./gradlew assembleRelease --no-daemon)
```

If you distribute the signed APK via the VPS (`/downloads/openunseal.apk`), place it at `<UPLOADS_DIR>/openunseal.apk` (or mount it to `APK_FILE_PATH`). The API automatically detects the file and advertises both `apkDownloadUrl` and its SHA-256 checksum (`apkSha256`) on `/api/v1/config`.

---

## Backups (PostGIS + Uploaded Photos)

Back up both the PostGIS database and the `uploads_data` WebP photo volume regularly. Backups contain the same personal data as the live system (email addresses, pseudonyms, photos), so **encrypt them** and **delete them after `BACKUP_RETENTION_DAYS`** - the privacy policy states that period, and data a user deleted only disappears from backups once they expire.

```bash
# 1. Logical PostGIS dump (users, polygons, municipalities, votes, photo metadata), encrypted with a passphrase
docker compose --env-file .env.vps -f docker-compose.vps.yml exec -T postgis \
  pg_dump -U ppgis -Fc ppgis \
  | gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /root/.backup-passphrase \
  > /var/backups/openunseal/backup-db-$(date +%Y%m%d).dump.gpg

# 2. EXIF-stripped WebP site photos, encrypted the same way
docker compose --env-file .env.vps -f docker-compose.vps.yml exec -T api \
  tar -C /var/lib/entsiegelung/uploads -czf - . \
  | gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /root/.backup-passphrase \
  > /var/backups/openunseal/backup-photos-$(date +%Y%m%d).tar.gz.gpg

# 3. Delete backups older than BACKUP_RETENTION_DAYS (here: 14)
find /var/backups/openunseal -name 'backup-*' -mtime +14 -delete
```

Run these from a daily cron job, keep `/root/.backup-passphrase` (`chmod 600`) and `.env.vps` (contains `TOMBSTONE_SECRET`) somewhere safe outside the VPS, and store off-site copies only with a provider you have a processing agreement with.

---

## Municipal White-Label Branding & Outbound Webhooks

Municipalities and public initiatives can adapt the platform's name, coat-of-arms/logo, color theme, portal link, and downstream GIS/ticketing integration **entirely via `.env.vps` configuration without modifying the source code** (so upstream AGPL-3.0-or-later / MPL-2.0 source attribution stays untouched and upgrades remain a simple `git pull`).

### 1. Branding & Visual Theme

Add any of these optional variables to `.env.vps`:

```env
APP_NAME="Entsiegelung Musterstadt"
APP_SUBTITLE_DE="Bürgerbeteiligung der Stadt Musterstadt"
APP_SUBTITLE_EN="Civic Unsealing Map of Musterstadt"
# Recommended (GDPR-friendly, same-origin): place a PNG/JPG/WebP/SVG (<= 2 MiB) in uploads_data:
BRAND_LOGO_FILE=/var/lib/entsiegelung/uploads/brand-logo.svg
# Alternative: external HTTPS logo URL (disclosed automatically on /auth/privacy)
# BRAND_LOGO_URL=https://www.musterstadt.de/assets/wappen.svg
BRAND_ACCENT_COLOR=#005A9C
# Optional dark-mode accent override (auto-derived with WCAG contrast if omitted)
BRAND_ACCENT_DARK_COLOR=
INTRO_ENABLED=true
MUNICIPAL_PORTAL_URL=https://www.musterstadt.de/klimaschutz
MUNICIPAL_PORTAL_LABEL="Klimaschutzportal Musterstadt"
```

To place a local logo file into the `uploads_data` volume (served same-origin at `/api/v1/branding/logo` with sandboxed CSP headers):

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml cp \
  ./brand-logo.svg api:/var/lib/entsiegelung/uploads/brand-logo.svg
```

### 2. Outbound Webhooks (Private GIS / Ticketing Integration)

To trigger internal municipal workflows (e.g. GIS sync, ticket creation, email notifications) without modifying the AGPL-licensed backend, point `WEBHOOK_URL` at a separate webhook receiver service:

```env
WEBHOOK_URL=https://gis-bridge.musterstadt.de/hooks/openunseal
WEBHOOK_SECRET=<openssl rand -hex 32>
WEBHOOK_EVENTS=polygon.created,polygon.status_changed,polygon.deleted
WEBHOOK_TIMEOUT_MS=5000
# Keep false for public HTTPS endpoints (blocks private/metadata IPs against SSRF).
# Set true only when delivering to an internal Docker/intranet receiver:
WEBHOOK_ALLOW_PRIVATE_NETWORKS=false
```

- **Zero-PII payload:** Webhook bodies contain exclusively public polygon fields (`id`, `geometry`, `surfaceType`, `note`, `status`, `origin`, `areaM2`, `municipality`, `votes`, `createdAt`, `updatedAt`, or `{ id, deletedByAdmin, deletedAt }` for `polygon.deleted`) — **no** user pseudonyms, email addresses, user IDs, or IP addresses.
- **Signature verification:** When `WEBHOOK_SECRET` is configured, each `POST` includes `X-OpenUnseal-Timestamp` (Unix seconds), `X-OpenUnseal-Event`, `X-OpenUnseal-Delivery` (UUID), and `X-OpenUnseal-Signature-256: sha256=<hex>`, computed as `HMAC-SHA256(WEBHOOK_SECRET, "${timestamp}.${rawBody}")`.
- **Non-blocking delivery:** Deliveries run asynchronously with a single retry on network/5xx failure so API mutations never fail or slow down if a downstream system is offline.

---

## GDPR Checklist for Operators

The code keeps data collection small, but running a public instance makes you the controller (Art. 4(7) GDPR). Before going live:

- [ ] **Legal notice & controller:** fill in `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` and a privacy contact (`ABUSE_CONTACT`); check `/auth/impressum` and `/auth/privacy`.
- [ ] **Processing agreements (Art. 28):** sign data processing agreements with your VPS host and your SMTP provider, and name them in `PRIVACY_HOSTING_PROVIDER` / `PRIVACY_EMAIL_PROVIDER`.
- [ ] **Third parties:** if you change `OSM_STYLE_URL`, `OSM_DARK_STYLE_URL`, or `ORTHOPHOTO_URL_TEMPLATE`, `/auth/privacy` names the new hosts automatically - check that provider's own privacy terms and whether it transfers data outside the EU/EEA.
- [ ] **Record of processing activities (Art. 30):** document the processing described on `/auth/privacy` (accounts, contributions, abuse prevention, logs, bug reports).
- [ ] **Security (Art. 32):** set `TOMBSTONE_SECRET` and a strong `POSTGRES_PASSWORD`; keep the VPS patched; encrypt backups.
- [ ] **Retention:** set `BACKUP_RETENTION_DAYS` and delete bug-report emails once handled.
- [ ] **Data subject requests:** users can download (*Konto → Meine Daten herunterladen*) and delete their data themselves; for requests by email use `admin export-user`, `set-email` and `rename-user` (see [`installation.md`](./installation.md#4-operator-moderation--administration-cli-admints)) after verifying the requester's identity. Answer within one month (Art. 12(3)).
- [ ] **Data breaches:** know that a breach involving personal data must be reported to your supervisory authority within 72 hours (Art. 33).
