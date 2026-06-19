# Saddle Library (GitHub Pages + Airtable)

Basic static scaffold for a bicycle saddle catalog site.

## Included

- `index.html` for the page structure
- `styles.css` for lightweight styling
- `app.js` for Airtable fetching + rendering + search
- `config.js` for Airtable settings

## Airtable schema (suggested)

Use a table named `Saddles` with fields like:

- `Name` (single line text)
- `Manufacturer` (single line text)
- `Photo` (attachment)
- `PurchaseLink` (URL)
- `Width` (single line text)
- `Notes` (long text)

For no-login checkout requests with private contact info, add:

- `Borrowers` table (private access):
   - `BorrowerRef` (single line text)
   - `Name` (single line text)
   - `Email` (email)
   - `Phone` (phone)
- `Checkout Requests` table:
   - `BorrowerRef` (single line text)
   - `SaddleRecordId` (single line text)
   - `SaddleName` (single line text)
   - `BorrowerNotes` (long text)
   - `Status` (single select, include `Requested`)
   - `RequestedAt` (date/time)

You can add more fields as needed and map them in `app.js`.

## Configure Airtable

1. Create a Personal Access Token in Airtable with `data.records:read` scope.
2. Update `config.js`:
   - `proxyUrl` (preferred for production)
   - `checkoutProxyUrl` (for submitting checkout forms)
   - `airtableToken`
   - `baseId`
   - `tableName`
   - `view`
3. Set `useSampleData: false` once your token/base/table are configured.

If `proxyUrl` is set, the frontend uses it and ignores `airtableToken`/`baseId`.

## Deploy on GitHub Pages

1. Push this folder to a GitHub repository.
2. The repository already includes a workflow at `.github/workflows/deploy-pages.yml`.
3. In GitHub repo settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually) and wait for Pages to publish.
5. Open the Pages URL shown in the workflow run summary.

## Important security note

GitHub Pages is static and public, so any Airtable token in `config.js` is exposed.
For production, use a proxy/serverless function to keep your token secret.

## Secure proxy option (Cloudflare Worker)

The repository includes a Worker scaffold in `proxy/cloudflare-worker`.

1. Install dependencies:
   - `cd proxy/cloudflare-worker`
   - `npm install`
2. Set Worker secrets:
   - `npx wrangler secret put AIRTABLE_TOKEN`
   - `npx wrangler secret put AIRTABLE_BASE_ID`
3. (Optional) adjust defaults in `wrangler.toml`:
   - `AIRTABLE_TABLE_NAME`
   - `AIRTABLE_VIEW`
   - `AIRTABLE_BORROWERS_TABLE`
   - `AIRTABLE_CHECKOUTS_TABLE`
4. Deploy:
   - `npm run deploy`
5. Copy the deployed endpoint and set in `config.js`:
   - `proxyUrl: "https://<your-worker-domain>/api/saddles"`
   - `useSampleData: false`

This keeps Airtable credentials out of your GitHub Pages frontend.

## No-login checkout flow

- Visitors click `Request Checkout` on a saddle card and submit a simple form (no account required).
- Frontend posts the request to Worker endpoint `/api/checkouts`.
- Worker writes contact details to private `Borrowers` table.
- Worker writes request metadata to `Checkout Requests` using `BorrowerRef`.
- Public site never receives Airtable secrets and does not read borrower PII.

Security behavior of the proxy:

- `GET /api/saddles` is locked to `AIRTABLE_TABLE_NAME` and `AIRTABLE_VIEW` from Worker env vars.
- URL query params cannot switch the endpoint to private tables like `Borrowers`.
- `POST /api/checkouts` accepts form submissions and writes server-side only.

## Local email test (quick start)

If you only want to test checkout/contact emails locally, use this workflow:

1. Create `proxy/cloudflare-worker/.dev.vars` with your real values:
   - `AIRTABLE_TOKEN=...`
   - `AIRTABLE_BASE_ID=...`
   - `RESEND_API_KEY=...`
   - `EMAIL_FROM=...`
   - `ADMIN_EMAIL=...`
2. Start the Worker:
   - `cd proxy/cloudflare-worker`
   - `npm install`
   - `npm run dev`
3. In `config.js`, temporarily set:
   - `proxyUrl: "http://127.0.0.1:8787/api/saddles"`
   - `checkoutProxyUrl: "http://127.0.0.1:8787/api/checkouts"`
   - `contactProxyUrl: "http://127.0.0.1:8787/api/contact"`
   - `turnstileSiteKey: ""`
4. In another terminal, run the site locally from the repo root:
   - `npx --yes http-server . -p 4173 -c-1`
5. Open `http://127.0.0.1:4173` and submit checkout/contact.

When running on localhost with `wrangler dev`, anti-spam checks are bypassed so local email tests work without Turnstile setup. Production deployments still use anti-spam checks.
