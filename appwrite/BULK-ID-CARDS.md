# Backend bulk PDF importer

Deploy `appwrite/functions/presences-backend`, Node 22, entrypoint `src/main.js`, build command `npm install --omit=dev --ignore-scripts`, timeout at least 90 seconds. Set `GEMINI_API_KEY` as an Appwrite Function variable. Never put it in the frontend. `GEMINI_ID_CARD_MODEL` optionally overrides `gemini-3.1-flash-lite`, verified on the supplied single-card and eight-card samples.

The frontend sends a PDF through asynchronous executions and polls for results. `idcards.extract` accepts base64 PDF bytes and a one-based page number. The function splits that page before Gemini extraction. Limits: 6 MB, 30 pages, 8 cards per page, 150 reviewed students per save. Completed pages remain available after a later failure. Cancellation stops polling and subsequent requests; dispatched executions can finish on Appwrite.

`idcards.save` validates the batch before writing and returns separate `saved` and `failed` lists. Existing students require `approveUpdates: true`; duplicate records and non-student profiles are rejected. Extra printed fields including Student ID, PEN and blood group are merged into profile metadata. The profiles collection must support the existing student attributes and string `metadata`. Keep signed-in execution permissions and documents read/write scopes. Bulk access requires administrator, principal or superadmin labels.

Model-reported card counts are checked against returned records, but cannot independently prove every physical card was read correctly. Review results before saving.

Run `node scripts/test-bulk-pdf.mjs` after installing function dependencies. Deploy with `node scripts/deploy-presences-backend.mjs --apply`, providing `APPWRITE_API_KEY` through the environment. Set the Gemini function variable in Appwrite before use. No credentials are packaged.
