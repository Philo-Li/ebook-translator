# LLM CORS proxy (optional)

A stateless Cloudflare Worker that forwards `POST /v1/chat/completions` to an arbitrary OpenAI-compatible upstream and stamps CORS headers on the response, so the browser app can talk to gateways that don't open CORS themselves.

You only need this for the **OpenCode** and **Custom (OpenAI-compatible)** providers. Every other provider is called directly from the browser.

## How it works

```http
POST /v1/chat/completions
Origin: https://your-site.example
Authorization: Bearer <user's upstream API key>
Content-Type: application/json
X-Upstream-URL: https://api.example.com/v1/chat/completions

{ "model": "...", "messages": [...] }
```

The worker validates the request, then forwards the body and `Authorization` header verbatim to `X-Upstream-URL` and streams the response back. It logs nothing.

Guards:

- `Origin` must be in `ALLOWED_ORIGINS` (requests without an `Origin` header, e.g. curl, are allowed).
- `X-Upstream-URL` must be `https://`, must end with `/chat/completions`, and must not point at a private or loopback address (best-effort SSRF block; IP literals and reserved hostnames only).
- Body must be JSON with a string `model` and an array `messages`.

## Deploy

1. Edit `wrangler.jsonc` and set `ALLOWED_ORIGINS` to a comma-separated list of the origins your app is served from, e.g. `https://translator.example.com,http://localhost:5173`.
2. From the repo root:

   ```bash
   npx wrangler login
   pnpm worker:deploy
   ```

3. Put the deployed URL in `.env` as `VITE_LLM_PROXY_URL=https://<name>.<account>.workers.dev/v1/chat/completions` and rebuild the app.

`pnpm worker:dev` runs it locally on `http://localhost:8787`.
