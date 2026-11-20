# Installation, Development & Build Guide

This guide covers local development, running the automated test suite, building production Web and mobile artifacts, signing release Android APKs, using the administration CLI, and configuring environment variables.

For turnkey Linux VPS deployment with Docker Compose, Caddy HTTPS, DNS, and backups, see [`docs/vps-setup.md`](./vps-setup.md).

---

## 1. Local Development & Testing Setup

### Prerequisites

* **Node.js `>= 24.0.0`** and `npm`
* **Docker Engine** with **Docker Compose v2**
* *(Optional, for native Android builds)* **JDK 17** and the **Android SDK** (`ANDROID_HOME`)

### Step 1: Clone & Install Dependencies

```bash
git clone https://github.com/severinbro/Unseal.git
cd Unseal
npm ci
```

### Step 2: Start the Local Backend Stack (`postgis` + `mailpit` + `api`)

```bash
cp .env.example .env
docker compose up -d --build
```

* **API & Hosted Auth / Legal Pages:** `http://127.0.0.1:3000` (`/api/v1/health`, `/api/v1/config`, `/auth/impressum`, `/auth/privacy`, `/auth/terms`, `/auth/licenses`)
* **Local Mailpit Email Inbox:** `http://127.0.0.1:8025` (captures all local registration confirmation and password recovery emails with clickable links)
* **BKG VG250 Municipalities:** Automatically downloaded and seeded (~11,000 German municipalities) on first startup when `AUTO_SEED_VG250=true`.

Verify the backend is healthy:

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/config
```

### Step 3: Build, Typecheck, and Run the Automated Test Suite

*(Requires Docker running for the PostGIS test database, unless `SKIP_DOCKER_PRETEST=1` points to an existing PostGIS instance.)*

```bash
npm run build
npm run typecheck
npm test
```

### Step 4: Run the Web App or Test on an Android Smartphone via USB (`adb`)

* **Web App:**
  ```bash
  npm --workspace apps/mobile run web
  ```
* **Android Smartphone over USB Debugging (`adb`):**
  Because `apps/mobile/android/` is gitignored and generated via Expo Prebuild, generate it once on each machine, forward port `3000`, and install a debug build:
  ```bash
  adb reverse tcp:3000 tcp:3000
  cd apps/mobile
  npx expo prebuild --platform android
  ./android/gradlew -p android assembleDebug
  adb install -r android/app/build/outputs/apk/debug/app-debug.apk
  ```
  *(For signed release APKs, see **Section 3** below - never distribute an APK signed with Expo's debug keystore.)*

---

## 2. Production Web & Mobile Builds

Because `@maplibre/maplibre-react-native`, `expo-location`, `expo-image-picker`, `expo-document-picker`, and `expo-secure-store` include native modules, Android and iOS native directories (`apps/mobile/android/` and `apps/mobile/ios/`, both gitignored) are generated per machine with **Expo Prebuild** (`npx expo prebuild`). During prebuild, the configured `./plugins/withBundledLicenses.cjs` plugin automatically copies `apps/mobile/LICENSE` (`LICENSE-MPL-2.0.txt`) and `THIRD_PARTY_NOTICES.txt` into the native application assets so standalone `.apk` and `.ipa` binaries always ship complete offline license texts.

```bash
# Export static production Web assets into ./dist-web (served by Caddy on the VPS)
EXPO_PUBLIC_API_BASE_URL=https://openunseal.example.org npm --workspace apps/mobile run export:web

# Prebuild native Android / iOS projects pointing at your production VPS
cd apps/mobile
EXPO_PUBLIC_API_BASE_URL=https://openunseal.example.org npx expo prebuild
```

---

## 3. Android Release Signing & Manifest Hardening

Because `apps/mobile/android/` is generated locally by `npx expo prebuild` and excluded from git, Expo's default generated Android template has two issues for production distribution:
1. It configures `buildTypes.release` to sign with `signingConfigs.debug`.
2. It places `android.permission.SYSTEM_ALERT_WINDOW` in `src/main/AndroidManifest.xml` (it is only needed for React Native's dev menu in `src/debug/AndroidManifest.xml`).

Perform the following steps on each build machine after running `npx expo prebuild --platform android` (or whenever regenerating `apps/mobile/android/`):

### Step 1: Generate and Back Up a Release Keystore (Once, Outside Git)

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore openunseal-release.keystore -alias openunseal-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

Store `openunseal-release.keystore` and its passwords safely outside the repository (losing the keystore prevents signing future in-place APK updates).

### Step 2: Configure `signingConfigs.release` in `apps/mobile/android/app/build.gradle`

In `apps/mobile/android/app/build.gradle`, add a `release` block inside `signingConfigs` and wire `buildTypes.release` to require the `OPENUNSEAL_UPLOAD_*` environment variables (or Gradle properties) instead of falling back to `signingConfigs.debug`:

```groovy
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def storePath = System.getenv("OPENUNSEAL_UPLOAD_STORE_FILE") ?: findProperty("OPENUNSEAL_UPLOAD_STORE_FILE")
            def storePass = System.getenv("OPENUNSEAL_UPLOAD_STORE_PASSWORD") ?: findProperty("OPENUNSEAL_UPLOAD_STORE_PASSWORD")
            def aliasName = System.getenv("OPENUNSEAL_UPLOAD_KEY_ALIAS") ?: findProperty("OPENUNSEAL_UPLOAD_KEY_ALIAS")
            def aliasPass = System.getenv("OPENUNSEAL_UPLOAD_KEY_PASSWORD") ?: findProperty("OPENUNSEAL_UPLOAD_KEY_PASSWORD")
            if (storePath && storePass && aliasName && aliasPass) {
                storeFile file(storePath)
                storePassword storePass
                keyAlias aliasName
                keyPassword aliasPass
            }
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Production release builds require a private keystore via OPENUNSEAL_UPLOAD_* env vars or Gradle properties.
            if (!signingConfigs.release.storeFile) {
                gradle.taskGraph.whenReady { taskGraph ->
                    if (taskGraph.allTasks.any { it.name.toLowerCase().contains("release") }) {
                        throw new GradleException(
                            "Release signing keystore not configured. Set OPENUNSEAL_UPLOAD_STORE_FILE, OPENUNSEAL_UPLOAD_STORE_PASSWORD, OPENUNSEAL_UPLOAD_KEY_ALIAS, and OPENUNSEAL_UPLOAD_KEY_PASSWORD."
                        )
                    }
                }
            }
            signingConfig signingConfigs.release
            shrinkResources (findProperty('android.enableShrinkResourcesInReleaseBuilds')?.toBoolean() ?: false)
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
            crunchPngs (findProperty('android.enablePngCrunchInReleaseBuilds')?.toBoolean() ?: true)
        }
    }
```

### Step 3: Remove `SYSTEM_ALERT_WINDOW` from the Main Manifest

Inspect `apps/mobile/android/app/src/main/AndroidManifest.xml` and remove `<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>` if present (it should exist only in `apps/mobile/android/app/src/debug/AndroidManifest.xml`).

### Step 4: Build & Optionally Host the Signed Release APK

Store your APK build and signing exports in a gitignored `.env.apk` file at the repository root (copied from [`.env.apk.example`](../.env.apk.example)):

```bash
cp .env.apk.example .env.apk
chmod 600 .env.apk
# Edit .env.apk with your production EXPO_PUBLIC_API_BASE_URL and OPENUNSEAL_UPLOAD_* values

source .env.apk && (cd apps/mobile/android && ./gradlew assembleRelease --no-daemon)
```

The signed APK is written to `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.

To distribute it directly from your VPS at `/downloads/openunseal.apk`, place the signed APK at `<UPLOADS_DIR>/openunseal.apk` (or configure `APK_FILE_PATH` on the server). The API automatically detects the file and advertises both `apkDownloadUrl` and its computed SHA-256 checksum (`apkSha256`) on `/api/v1/config` (displayed in the web app's Install modal).

---

## 4. Operator Moderation & Administration CLI (`admin.ts`)

```bash
# 1. Grant or revoke administrator privileges (enables "finished" status & .geojson/.gpkg import)
docker compose exec api node apps/api/dist/cli/admin.js grant-admin <pseudonym>
docker compose exec api node apps/api/dist/cli/admin.js revoke-admin <pseudonym>

# 2. Seed or refresh German BKG VG250 municipality boundaries (from live BKG WFS or local .geojson)
docker compose exec api node apps/api/dist/cli/admin.js load-vg250

# 3. Ban an abusive pseudonym (records keyed HMAC tombstones of pseudonym + email, purges the user's
#    polygons/photos/comments/votes, recomputes scores) - and lift a ban once it is no longer justified
docker compose exec api node apps/api/dist/cli/admin.js ban-user <pseudonym> "spam brigading"
docker compose exec api node apps/api/dist/cli/admin.js lift-ban <pseudonym> [email]

# 4. Delete a specific polygon proposal or comment by UUID, or redact a proposal's free-text note
docker compose exec api node apps/api/dist/cli/admin.js delete-polygon <polygon-uuid>
docker compose exec api node apps/api/dist/cli/admin.js delete-comment <comment-uuid>
docker compose exec api node apps/api/dist/cli/admin.js redact-note <polygon-uuid>

# 5. GDPR data subject requests received by email (verify the requester's identity first!)
#    Art. 15/20 access & portability: writes the same JSON users can download in the app to stdout
docker compose exec -T api node apps/api/dist/cli/admin.js export-user <pseudonym-or-email> > export.json
#    Art. 16 rectification: change the email address (pending email links are invalidated)
docker compose exec api node apps/api/dist/cli/admin.js set-email <pseudonym-or-email> <new-email>
#    Art. 16 rectification: rename a pseudonym (the old one stays reserved for PSEUDONYM_RESERVATION_DAYS)
docker compose exec api node apps/api/dist/cli/admin.js rename-user <pseudonym-or-email> <new-pseudonym>

# 6. Research provenance tagging & zero-PII daily telemetry export
docker compose exec api node apps/api/dist/cli/admin.js set-polygon-origin initiative_import --user <admin-pseudonym>
docker compose exec -T api node apps/api/dist/cli/admin.js export-telemetry [--since YYYY-MM-DD] [--until YYYY-MM-DD] > telemetry.json
```

Users can download their own data in the app (*Konto → Meine Daten herunterladen*, `GET /api/v1/auth/me/export`) and delete their account themselves; the CLI commands above cover requests that arrive by email.

*(On your production VPS, add `--env-file .env.vps -f docker-compose.vps.yml` right after `docker compose`.)*

---

## 5. Environment Variable Reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `POSTGRES_USER` | `ppgis` | PostgreSQL role. |
| `POSTGRES_PASSWORD` | `ppgis` | PostgreSQL password (**override with a strong secret in production**). |
| `POSTGRES_DB` | `ppgis` | PostgreSQL database name. |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Fastify bind address and HTTP port inside container. |
| `DATABASE_URL` | `postgresql://ppgis:ppgis@127.0.0.1:5432/ppgis` | Full PostgreSQL connection URI (`@postgis:5432` inside Docker). |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:3000` | Public origin embedded in registration & password reset email links (e.g. `https://openunseal.example.org`). |
| `UPLOADS_DIR` | `./uploads` | Directory storing EXIF-stripped WebP polygon photos (`/var/lib/entsiegelung/uploads` in Docker). |
| `AUTO_SEED_VG250` | `false` (`true` in Compose) | Automatically download & seed German BKG VG250 OpenData municipalities when empty. |
| `SMTP_HOST` / `SMTP_PORT` | *(empty)* / `587` | Outbound SMTP hostname and port (`mailpit` / `1025` in local `docker-compose.yml`). |
| `SMTP_SECURE` | `false` (`true` if `465`) | Use implicit TLS (`true` for port `465`, `false` for STARTTLS on `587`). |
| `SMTP_REQUIRE_TLS` | `true` (unless `SMTP_SECURE=true`) | Refuse to send when the server does not offer STARTTLS, so confirmation/reset links and addresses never travel unencrypted. Set `false` only for local Mailpit (as in `docker-compose.yml`). |
| `SMTP_USER` / `SMTP_PASS` | *(empty)* | SMTP authentication credentials. |
| `SMTP_FROM` | `OpenUnseal <noreply@localhost>` | Sender `From:` header for confirmation and password reset emails. |
| `TRUST_PROXY` | `false` | Set `true` behind Caddy/Nginx/Traefik. |
| `CORS_ORIGIN` | `*` | Allowed browser CORS origin(s), comma-separated. |
| `OSM_STYLE_URL` / `OSM_DARK_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` / `.../styles/dark` | Light and dark mode MapLibre vector style JSON URLs. |
| `ORTHOPHOTO_*` | *(built-in Germany DOP20)* | Built-in server-proxied German DOP20 aerial orthophotos (`/api/v1/tiles/dop20/{z}/{x}/{y}.png`); set `ORTHOPHOTO_URL_TEMPLATE=none` to disable or override with a custom `EPSG:3857` URL. |
| `APK_DOWNLOAD_URL` / `APK_FILE_PATH` / `APK_SHA256` | *(auto)* / `<UPLOADS_DIR>/openunseal.apk` / *(auto SHA-256)* | Optional direct Android `.apk` download link (`none` to hide button; auto-hidden when no APK file exists), server file path, and SHA-256 checksum. |
| `INITIAL_LNG` / `LAT` / `ZOOM` | `8.2739` / `49.9989` / `15` | Default initial viewport camera (Mainz Cathedral). |
| `MAX_DAILY_POLYGONS_PER_USER` | `25` | Rolling 24-hour polygon creation cap per user. |
| `SESSION_TTL_DAYS` | `30` | Bearer session lifetime in days. |
| `AUTH_CAPTCHA_ENABLED` / `SECRET` / `MAX_NUMBER` | `false` (`true` in `docker-compose.vps.yml`) / *(random per process)* / `15000` | Enable the ALTCHA registration proof-of-work and set its HMAC secret (`openssl rand -hex 32`); an empty value or the example placeholder uses a random secret. |
| `TOMBSTONE_SECRET` | *(required in production; fixed dev value otherwise)* | HMAC-SHA256 key (`openssl rand -hex 32`, ≥ 32 chars) for the tombstones of self-deleted pseudonyms, banned emails and canonical email aliases (GDPR Art. 32 pseudonymisation). Keep it stable: rotating it lifts existing email bans and pseudonym reservations. The API refuses to start with `NODE_ENV=production` if it is missing or still the example placeholder. |
| `PRIVACY_HOSTING_PROVIDER` / `PRIVACY_EMAIL_PROVIDER` | *(empty)* | Name (and seat) of your hosting and SMTP providers, listed as processors (Art. 28 GDPR) on `/auth/privacy`. |
| `BACKUP_RETENTION_DAYS` | *(empty → operator warning on `/auth/privacy`)* | How long backups are kept before deletion; stated in the privacy policy. |
| `PSEUDONYM_RESERVATION_DAYS` | `365` | Days a self-deleted pseudonym stays reserved against impersonation before its tombstone is purged. Ban tombstones stay until lifted with `admin lift-ban`. |
| `DISPOSABLE_EMAIL_BLOCKLIST_EXTRA` | *(empty)* | Comma-separated extra disposable email domains to block at signup. |
| `REQUIRE_JURISDICTION` / `STALE_UNRATED_PRUNE_DAYS` / `NEW_USER_*` | `when_seeded` / `30` / `14`, `3` | VG250 jurisdiction enforcement, stale unrated proposal pruning days, and new-user badge thresholds. |
| `DISCLAIMER_TEXT` / `ABUSE_CONTACT` | *(civic notice)* / *(empty)* | Public notice and optional moderation contact shown in inspector, legal pages & bug-report modal. |
| `OPERATOR_NAME` / `OPERATOR_ADDRESS` / `OPERATOR_EMAIL` / `OPERATOR_PHONE` | *(empty)* | Legal operator identity rendered on `/auth/impressum` & `/auth/privacy` (§ 5 DDG / § 18 MStV / Art. 13 GDPR); `\n` separates address lines. |
| `IMPRESSUM_URL` / `PRIVACY_POLICY_URL` / `TERMS_URL` / `LICENSES_URL` / `SOURCE_CODE_URL` | `<PUBLIC_BASE_URL>/auth/{impressum,privacy,terms,licenses}` | Override URLs for hosted legal notices and AGPL-3.0/MPL-2.0 source code repository link. |
| `BUG_REPORT_TO` | *(falls back to `OPERATOR_EMAIL`)* | Recipient email for `/api/v1/bug-reports` (`none` or unset disables bug-report email submission with HTTP 503). |
| `APP_NAME` / `APP_SUBTITLE_DE` / `APP_SUBTITLE_EN` | `OpenUnseal` / *(default)* | Optional municipal instance name and localized subtitles shown in the web/mobile UI, hosted `/auth/*` pages, and transactional emails (upstream AGPL/MPL Open-Source attribution stays preserved). |
| `BRAND_LOGO_FILE` / `BRAND_LOGO_URL` | *(built-in OpenUnseal mark)* | Custom logo file (PNG/JPG/WebP/SVG ≤ 2 MiB, served same-origin at `/api/v1/branding/logo`) or external `https://` URL (external hosts are disclosed automatically on `/auth/privacy`). |
| `BRAND_ACCENT_COLOR` / `BRAND_ACCENT_DARK_COLOR` | `#176642` / `#34C785` | Optional 6-digit hex brand accent colors for light and dark themes (dark variant and contrasting ink colors derive automatically when omitted; map status legend colors remain unchanged). |
| `INTRO_ENABLED` | `true` | Set `false` to skip the animated splash intro overlay on startup. |
| `MUNICIPAL_PORTAL_URL` / `MUNICIPAL_PORTAL_LABEL` | *(empty)* | Optional external link (e.g. municipal homepage or climate portal) rendered in the About modal and `/auth/impressum`. |
| `WEBHOOK_URL` / `WEBHOOK_SECRET` / `WEBHOOK_EVENTS` / `WEBHOOK_TIMEOUT_MS` / `WEBHOOK_ALLOW_PRIVATE_NETWORKS` | *(disabled)* / *(empty)* / all 3 / `5000` / `false` | Optional async outbound webhook (`polygon.created`, `polygon.status_changed`, `polygon.deleted`) transmitting exclusively public, non-PII polygon data with optional HMAC-SHA256 signing (`X-OpenUnseal-Signature-256`) and SSRF protection against private/metadata IP ranges. |
| `EXPO_PUBLIC_API_BASE_URL` | `http://127.0.0.1:3000` | Base API URL baked into Expo mobile/web builds at bundle time. |
