# Appwrite migration repair

Local fixes compile and have adapter/backend regression coverage. The approved live schema repair and core backend deployment were applied on October 3, 2026.

`presences-backend` deployment `6ac0bef04d97551e2080` is ready and active. Its execution permissions are signed-in users only. A live execution without a user JWT completed with HTTP 401. All attributes were available after repair; ordinary string allocations were reduced to fit Appwrite collection capacity, while JSON field capacity was preserved. The newly added attendance notes field is limited to 512 characters after checking stored values fit.

## Prepared schema change

Run `node scripts/repair-appwrite-schema.mjs` for a read-only refresh, providing APPWRITE_API_KEY through the environment. The repair created seven missing collections with their attributes: `gv_camera_zones`, `gv_tracks`, `timetable_slots`, `system_notifications`, `device_tokens`, `attendance_session_events`, and `realtime_messages`, and added missing attributes to existing collections.

New collections use document security. New business collections grant collection read/create to trusted admin, principal, and teacher labels. The realtime collection grants no collection-wide permissions; backend writes assign document permissions. Existing records, attribute types, and existing collection permissions are not changed. Existing permissive collection permissions need a separate verified authorization migration.

After explicit approval, apply with `node scripts/repair-appwrite-schema.mjs --apply`. Inspect its report for failures and wait for attributes to become available before testing writes.

## Prepared backend deployment

`node scripts/deploy-presences-backend.mjs` prints the plan without deploying. After explicit approval, use `--apply` to deploy `presences-backend` to project `6abfd34f000604fcf074`. The function uses Node 22, signed-in execution, and documents.read, documents.write, and users.read scopes. Server-side verified account labels gate actions.

Implemented actions are attendance event upsert, admin auth-user listing, and staff realtime broadcasts. Check deployment build status in Appwrite before treating it as operational. The existing 37 function registrations have no deployed code; notifications, email/SMS, AI, imports, and remaining original server functions still require migration and live verification.

## Verification boundaries

Frontend TypeScript and production/PWA build pass. Adapter and backend regression suites contain 22 passing checks, including bounded single-record reads. Three additional mocked server authentication checks reject missing/invalid credentials and use the verified account ID. Signed-in end-to-end tests remain pending: Appwrite rejects the supplied six-character password because its minimum is eight characters. The added recovery route lets the account owner reset their password. Browser automation was blocked by browser policy in this run.
