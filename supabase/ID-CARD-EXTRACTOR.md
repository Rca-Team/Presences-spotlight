# Supabase PDF extraction

Only ID-card extraction moves to Supabase. Appwrite remains the authentication and student database provider. The Edge Function verifies the caller's Appwrite JWT with the Appwrite Account API before any Gemini request. `verify_jwt = false` disables the incompatible Supabase JWT check, not application authentication.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or `VITE_SUPABASE_PUBLISHABLE_KEY`) on the frontend. Set `GEMINI_API_KEY` and optionally `GEMINI_ID_CARD_MODEL=gemini-3.1-flash-lite` through Supabase secrets. Optional `APPWRITE_ENDPOINT` and `APPWRITE_PROJECT_ID` secrets override the existing project defaults.

Deploy: `supabase functions deploy extract-pdf-users --project-ref YOUR_PROJECT_REF`. Configure secrets using the Supabase Dashboard or CLI. Rebuild and publish the frontend after setting its Supabase URL and public key. Do not place service-role keys or Gemini secrets in frontend variables.

The frontend accepts PDFs up to 50 MB and splits them locally into individual PDF pages before upload. Each page request is limited to 12 MB. A file may contain up to 30 pages and 150 cards, with up to eight cards per page. Completed page results survive later extraction failures. Reviewed students continue to save through the existing Appwrite function.
