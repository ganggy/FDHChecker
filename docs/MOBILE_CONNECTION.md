# Mobile connection

The Capacitor apps load the production FDH website at
`http://147.50.107.211:3507`. Web updates therefore appear in the app
without rebuilding its bundled UI. Login and API requests use the website's
origin and existing backend. An internet connection is required.

Run `npm run mobile:sync` after changing the Capacitor URL, then rebuild and
install the native app. An already installed app needs this native update once.

The current website uses HTTP. Android permits cleartext only to the FDH IP.
iOS permits HTTP in WKWebView because older iOS versions do not support IP
addresses as ATS exception domains. Native networking retains its ATS defaults.
Move the website to a trusted HTTPS domain and remove these exceptions when
HTTPS is available. Do not add wildcard Capacitor navigation permissions.

Local AI uses `OLLAMA_MODEL=qwen3:4b-instruct` and `OLLAMA_EMBED_MODEL=bge-m3`.
Existing installations must update their environment override and restart the
backend; changing the code default alone does not replace `.env` settings.
