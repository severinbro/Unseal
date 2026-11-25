# Amendments to UNSEAL_SOCIAL_FEATURES_PLAN.md (privacy & licensing)

Where this file and the plan disagree, this file wins. "Operator decision" marks choices that need human or legal sign-off before release.

| # | Plan reference | Amendment |
| :- | :- | :- |
| A1 | §3.4, Task 2 photo lock | Photo deletion is never refused. Deleting the last valid photo of a non-`proposed` private polygon resets `status` to `proposed`, unless an admin set it to `finished`. |
| A2 | §3.4 photo evidence | Terms gain an exception: entitled persons may photograph their own premises. The ban on people, faces, plates and other people's private areas stays. |
| A3 | §6.1, §7.2 export | `detectedSpaceType`, `privateOverlapRatio`, `spaceVerification` and `spaceVerificationSource` are removed from the export and webhooks; only `spaceType` is exported. Ratio, detection and source are returned to the author and admins only. `import_attributions` gains `purpose`; rows for reference datasets are never pruned and are credited on `/auth/licenses`. `load-landcover` accepts and records licence and attribution. |
| A4 | Task 2 `eigentuemerart` | Not read. Files containing ownership attributes are rejected. |
| A5 | §3.2 `openForPublicAccess` | Removed from export and webhooks. Setting it, or `allowChatContact`, requires `entitlementConfirmed: true`. Both default to `false`. Terms extend the CC0 waiver to `spaceType` only. |
| A6 | §7.3 chat erasure | Sent messages are deleted in every account-deletion mode. Users can delete single messages and all their messages in a thread. Messages expire after `CHAT_RETENTION_DAYS` (default 365), empty threads after 7 days. |
| A7 | Feed | Rate-limited per IP, limited to the last 180 days, sends licence `Link` headers. |
| A8 | `authorAllowDirectMessages`, `allowChatContact` | Not published. Signed-in viewers get a computed `canMessageAuthor`; the raw polygon flags go to the author and admins only. |
| A9 | § 3 TDDDG as reporting basis | Removed. Reports rest on the participant's own disclosure and Art. 16 DSA. Chat has its own legal basis in the policy, states that it is not end-to-end encrypted, and Terms cover deletion of messages. **Operator decision:** whether the chat is a telecommunications service (§ 3 Nr. 24 TKG, § 3(2) TDDDG). |
| A10 | (missing) | Terms acceptance is versioned. Accounts on an older version must accept before creating polygons or using chat. |
| A11 | §6.3 Overpass | Only the rounded bounding box is sent. The User-Agent carries the instance URL but no contact address. `OVERPASS_API_URL` defaults to empty (disabled). **Operator decision:** enabling it after checking the host's terms. |
| A12 | §7.3 export | Access export includes received messages and empty threads. |
| A13 | Reports | Policy names message text sent by email; Impressum and Terms state the sign-in exception for chat reports and the email route; GIS classification joins the list of automated measures. |
| A14 | Natural Earth | Labelled "Public Domain", not `CC0-1.0`. |
| A15 | File lists | Adds `LICENSING.md` (Task 2), notices generator, `docs/`, `/auth/licenses`, `/auth/impressum`, `retention.ts`, `logger.ts`. |
| A16 | Logging | Identifiers in `/api/v1/chats/...` paths are redacted. |
| A17 | `chats/open` | Unknown, unverified, opted-out and blocking recipients all return the same `403`. |
| A18 | Opt-out | Existing threads stay open after opting out until blocked; the UI says so. |
| A19 | `ChatPolygonReferenceSchema` | Adds `thumbUploaderPseudonym` (CC BY attribution). |
| A20 | ALKIS codes | `41006` is mixed use. `41003` is dropped; `41007` is not treated as private. |
| A21 | Migration of existing rows | `space_type` may be `'unknown'`; legacy rows use it. New polygons still choose public or private. |
| A22 | §3.4 status by authors | Reporting progress on private ground needs the entitlement confirmation once per area (`entitlementConfirmed` on `PATCH …/status`). |
| A23 | Feed order | The feed is ordered by `feed_at`: creation, or the latest change to `in_progress` / `finished`. A reset to `proposed` puts the area back. Items carry `activity` and `activityAt`. |
| A24 | Filters | `spaceFilter` gains `unknown`; `filter` gains `help_wanted`. The map shows every filter the feed offers. |
| A25 | Chat | **Message requests:** until the person addressed answers, the initiator may send one message (`409 CHAT_REQUEST_PENDING`); deleting that message withdraws the request without a trace and the person may ask again; unanswered requests are erased after 30 days. **Contact cap:** 20 attempts to reach somebody new per account and day (`429 CHAT_CONTACT_LIMIT`); only a date and a count are stored. Read state is never shown to the other person. |
| A26 | (new) Help wanted | `help_wanted_until` on private areas: public badge and filter, needs `entitlementConfirmed`, ends after 90 days or when the area is finished, expired values are cleared. Not exported, not in webhooks. |
| A27 | (new) Local feed | `bbox` (≤ 3°, sent on a 0.05° grid, taken from the map view, never from the device position) and `ags`. Neither is stored or logged. |
| A28 | (new) Land-use layer | `GET /api/v1/space-zones` (≤ 0.06° span, zoom ≥ 15) and `overlay` in the classify response: `private` / `public` only, ODbL-1.0 with credits, no ownership data, no live Overpass data. |
