# Automated Kleinanzeigen

Automated Kleinanzeigen is a local-first assistant for preparing private Kleinanzeigen listings. It helps turn product photos into an editable listing draft, researches active Kleinanzeigen offer prices, and can open a separate browser profile to prefill a draft for manual review.

The app does not blind-post listings. The final login, category selection, image upload check, content review, and publishing click stay with the user.

## Features

- Drag-and-drop product image upload.
- Product recognition and draft data extraction through the OpenAI Responses API.
- Active Kleinanzeigen comparison search through Playwright.
- Robust price recommendation with manual outlier/exclusion controls.
- Editable listing title, description, category hint, price rationale, and missing-facts checklist.
- Assisted Kleinanzeigen browser flow with a dedicated persistent local profile.
- Session-only handling for uploaded images, analysis results, comparison sources, and drafts.

## Safety Model

This project is designed as a local private-sale assistant, not a bulk-posting or account automation tool.

- The server binds to `127.0.0.1` by default.
- Non-loopback bind addresses require `ALLOW_NON_LOOPBACK_HOST=true` because the local API is intentionally unauthenticated.
- There is no permissive CORS middleware.
- Uploaded image filesystem paths are kept server-side and are not returned in API responses.
- `.env`, `.runtime/`, build output, Playwright reports, and test artifacts are ignored by Git.
- The OpenAI API key is read from environment variables and is never stored by the app.
- Kleinanzeigen login cookies live only in the separate Playwright profile directory.

Kleinanzeigen is a third-party service. This project is not affiliated with, endorsed by, or supported by Kleinanzeigen. Use it in a way that respects Kleinanzeigen' terms and your account security.

## Requirements

- Node.js 22 or newer
- npm
- An OpenAI API key for live image analysis and draft generation
- Playwright browser binaries for UI tests and browser-assisted flows

## Setup

```bash
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` for live AI analysis. Without a key, the app keeps working with conservative fallback data for local development and tests.

```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | API key for OpenAI image analysis and draft generation. |
| `OPENAI_MODEL` | `gpt-5.1` | Model used with the Responses API. |
| `PORT` | `5173` | Local server port. |
| `HOST` | `127.0.0.1` | Local bind address. Keep this loopback-only unless you know the risk. |
| `ALLOW_NON_LOOPBACK_HOST` | empty | Must be `true` before `HOST` can bind outside `localhost`, `127.0.0.1`, or `::1`. |
| `SESSION_DIR` | `.runtime/sessions` | Temporary session data location. |
| `PLAYWRIGHT_PROFILE_DIR` | `.runtime/browser-profile` | Persistent Kleinanzeigen browser profile. |

## Development

```bash
npm test
npm run build
npm run test:ui
```

Install Playwright Chromium if the UI test reports a missing browser:

```bash
npx playwright install chromium
```

## API Surface

- `POST /api/session`
- `GET /api/session/:id`
- `POST /api/session/:id/images`
- `POST /api/session/:id/analyze`
- `POST /api/session/:id/price-search`
- `POST /api/session/:id/draft`
- `POST /api/session/:id/publish-assist`

## Data Retention

Uploaded images and session data are stored locally under `SESSION_DIR` while the process is running. The app removes session data on normal process termination. The Playwright browser profile is intentionally persistent so Kleinanzeigen login state can survive app restarts.

## License

No license has been selected yet. Until a license is added, all rights are reserved by the repository owner.
