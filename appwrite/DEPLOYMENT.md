# Appwrite migration repair

Local fixes compile and have adapter/backend regression coverage. Live deployment has not been applied.

## Prepared schema change

Run `node scripts/repair-appwrite-schema.mjs` for a read-only refresh. The current plan in `appwrite-schema-report.json` adds 222 missing attributes to existing collections and creates seven missing collections with their attributes: `gv_camera_zones`, `gv_tracks`, `timetable_slots`, `system_notifications`, `device_tokens`, `attendance_session_events`, and `realtime_messages`.

New collections use document security. New business collections grant collection read/create to trusted admin, principal, and teacher labels. The realtime collection grants no collection-wide permissions; backend writes assign document permissions. Existing records, attribute types, and existing collection permissions are not changed. Existing permissive collection permissions need a separate verified authorization migration.

After explicit approval, apply with `node scripts/repair-appwrite-schema.mjs --apply`. Inspect its report for failures and wait for attributes to become available before testing writes.

## Prepared backend deployment

`node scripts/deploy-presences-backend.mjs` prints the plan without deploying. After explicit approval, use `--apply` to deploy `presences-backend` to project `6abfd34f000604fcf074`. The function uses Node 22, signed-in execution, and documents.read, documents.write, and users.read scopes. Server-side verified account labels gate actions.

Implemented actions are attendance event upsert, admin auth-user listing, and staff realtime broadcasts. Check deployment build status in Appwrite before treating it as operational. The existing 37 function registrations have no deployed code; notifications, email/SMS, AI, imports, and remaining original server functions still require migration and live verification.

## Verification boundaries

Frontend TypeScript and production/PWA build pass. Adapter and backend regression suites contain 22 passing checks, including bounded single-record reads. Three additional mocked server authentication checks reject missing/invalid credentials and use the verified account ID. Signed-in end-to-end tests remain pending: Appwrite rejects the supplied six-character password because its minimum is eight characters. The added recovery route lets the account owner reset their password. Browser automation was blocked by browser policy in this run.
