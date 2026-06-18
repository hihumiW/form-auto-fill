# LLM Signature Stroke Demo

This demo tests whether an OpenAI-compatible LLM can generate Chinese signature stroke coordinates.

## Run

```powershell
cd experiments/signature-llm-demo
node server.mjs
```

Open:

```text
http://localhost:8787
```

The page sends requests to the local proxy at `http://localhost:8787/api/chat-completions`.
The proxy forwards them to:

```text
{baseUrl}/chat/completions
```

This avoids browser CORS failures from LLM providers.

## Notes

- API Key is only typed into the local page and forwarded by the local proxy.
- No OA workflow or extension background signing code is involved.
- If port `8787` is busy, run `$env:PORT=8788; node server.mjs` in PowerShell and update `PROXY_URL` in `index.html` accordingly.
