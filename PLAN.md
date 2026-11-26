# guru — Implementation Plan

A static web app (built with Vite, hosted on GitHub Pages) for chatting with Claude or OpenAI models. It takes voice input, answers in voice and/or text, and calls tools from remote MCP servers. The first built-in plugin is **atlas**.

## Constraints

- **Static site plus one small proxy:** the app is static files on GitHub Pages. API calls go through a Cloudflare Worker (`guru-proxy`), the only server-side code.
- **API keys are never in the repo or the built site.** GitHub Secrets used in a Pages build would be copied into the public JavaScript, so they can't be used for this. The owner's keys are stored as Worker secrets.
- **Two ways to supply a key:**
  - **guru key:** the user enters a passphrase, and the Worker adds the owner's key server-side.
  - **Own key:** the user pastes their own key. It's stored in their browser and passed through the Worker unchanged.
- **Subscription login is out of scope:** Claude Pro/Max and ChatGPT/Codex sign-in can't be used from a static web app. If it's ever needed, see Phase 7.
- **MCP servers must be remote and allow CORS** for the guru origin. Stdio MCP servers aren't supported.
- **Atlas is an external, already-deployed service.** guru only uses it as a client and changes nothing in human-atlas.

## Known facts about atlas (already deployed)

- The MCP endpoint is `https://human-atlas-connect.ctzurcanu.workers.dev/mcp`. It uses Streamable HTTP, needs no authentication and returns stateless JSON.
- Its tools are `get_anatomy_options`, `search_anatomy` and `show_anatomy`.
- `show_anatomy` returns `structuredContent.url` (an interactive viewer on GitHub Pages) and `iframe`.
- The CORS allowlist includes `ALLOWED_VIEWER_ORIGINS=https://ctzurcanu.github.io`. If guru is served from `https://ctzurcanu.github.io/guru/`, it has the **same origin**, so no change to atlas is needed.

## Stack

| Concern | Choice |
|---|---|
| Build | Vite + TypeScript + React (same as human-atlas) |
| LLM: Claude | `@anthropic-ai/sdk`, `baseURL` = `<proxy>/anthropic` |
| LLM: OpenAI | `openai` SDK (Responses API), `baseURL` = `<proxy>/openai/v1` |
| Proxy | Cloudflare Worker `guru-proxy` (`worker/`): path allowlist, CORS for the guru origin, passphrase gate, streams responses through unchanged |
| MCP | `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` |
| ASR | Default: Web Speech API. Optional: OpenAI transcription (BYO key) with `@ricky0123/vad-web` voice-activity detection for hands-free turns (the approach saypi uses) |
| TTS | Default: `speechSynthesis`. Optional: OpenAI TTS (BYO key), streamed sentence by sentence |
| Storage | `localStorage` for settings, passphrase and own keys; IndexedDB for conversation history |
| Deploy | Site: GitHub Actions → GitHub Pages, `base: '/guru/'`. Worker: `wrangler deploy`, keys set with `wrangler secret put` |

## Architecture

```
src/
  main.tsx, App.tsx
  settings/      keys, provider/model choice, voice options, MCP server list
  providers/     common LLM interface + anthropic.ts, openai.ts (streaming, tool calls)
  agent/         loop: send → tool calls → MCP → results → continue → final text
  mcp/           client registry: connect, listTools, callTool; converts tool schemas per provider
  voice/         asr/ (webspeech.ts, openai-vad.ts), tts/ (browser.ts, openai.ts)
  plugins/       renderers chosen by MCP server/tool; atlas: show `structuredContent.url` in an iframe panel
  ui/            chat view, mic button, side panel, settings dialog
```

- **Common provider interface:** `stream(messages, tools) → events` (text deltas, tool calls, done). The agent loop is provider-agnostic.
- **Plugin = MCP server + optional renderer.** Atlas is pre-registered and enabled by default. Users can add any remote MCP URL.
- **Response modes:** text, voice, or both, toggled in the UI. TTS reads only the assistant's text, never tool output.

## Phases

### Phase 1: Scaffold and deploy
- [x] Vite + React + TS project, `base: '/guru/'` (ESLint postponed)
- [x] GitHub Actions Pages workflow (`.github/workflows/deploy.yml`); placeholder page
- [x] Verify locally: `npm run build` passes; `vite preview` serves `/guru/` and its assets (200)
- [x] Enable Pages (Settings → Pages → Source: GitHub Actions)
- [x] Verify: https://ctzurcanu.github.io/guru/ and its assets load (200); atlas `/mcp` CORS preflight from that origin returns 204

### Phase 2: Text chat with your own key
- [x] Settings dialog: provider (Claude / OpenAI), API key, model (live model list)
- [x] Anthropic and OpenAI streaming adapters behind the common interface (native history per provider)
- [x] Chat UI with streaming and Markdown rendering; history in IndexedDB; Stop; failed turns roll back
- [x] Verify (headless Chrome): an invalid key shows a clear error for both providers; settings persist across reload
- [ ] Verify: a streaming conversation works with each provider from the deployed site (after Phase 2b)

### Phase 2b: Key proxy (Cloudflare Worker)
Found during the Phase 2 browser test: OpenAI's `/v1/responses` sent no CORS headers to the browser (at least on a 401), so calling OpenAI directly from the browser isn't reliable.
- [x] `worker/`: routes `/anthropic/*` → `api.anthropic.com` and `/openai/*` → `api.openai.com`; only allowlisted paths (`/v1/messages`, `/v1/models`, `/v1/responses`; audio paths added in Phases 4–5)
- [x] Authentication: a valid `x-guru-pass` header (constant-time compare against the `GURU_PASSPHRASE` secret) → the Worker uses the `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` secrets. Without it, the client's own key header is forwarded. With neither → 401.
- [x] Strip browser-only headers before calling upstream; CORS limited to `https://ctzurcanu.github.io` and localhost; responses streamed through unchanged
- [x] Client: settings get a per-provider choice of guru key (passphrase) or own key; both SDKs point at the proxy
- [x] Verify locally with `wrangler dev` (curl + headless Chrome, 5/5 cases): wrong passphrase → "Wrong guru passphrase."; passphrase and own key reach Anthropic and OpenAI (401 for fake keys, with CORS); disallowed path → 404; foreign origin gets no CORS header. Streaming with a real key is still untested.
- Note: Anthropic SDK 1.8 sends the key as `Authorization: Bearer`, so the Worker accepts either header and sends each provider the form it expects.
- [ ] Deploy: the owner runs `wrangler secret put` for each key and the passphrase, then `wrangler deploy`
- [ ] Later: rate limiting per IP

### Phase 3: MCP and atlas
- [x] MCP registry (`src/mcp/registry.ts`): connect, `tools/list`, tools exposed as `<server>__<tool>`; unreachable servers are reported as a notice, not fatal
- [x] Tool loop inside each provider session (cap `MAX_TOOL_STEPS` = 8; on the last step tools are disabled so the model must answer); tool chips shown on the reply
- [x] Pre-registered atlas server with prompt instructions (search with short terms, then show by id); side panel with the viewer (beside the chat on wide screens, above it on phones); views saved with the conversation
- [x] Settings: toggle built-in plugins
- [ ] Settings: add/remove custom MCP server URLs, with a clear CORS error message
- [x] Verify (headless Chrome, scripted Claude stream + **real** atlas MCP): "show me C5 in the atlas" → search_anatomy("C5") → show_anatomy("ZA:Vertebra C5") → the viewer loads with Vertebra C5 selected; survives reload; no overflow at 400px
- [x] OpenAI tool loop verified with a scripted Responses stream + real atlas (fixed: the SDK's `parsed_arguments`/`parsed` fields were sent back as input → 400)
- [ ] Verify with real models on the live site (Claude and OpenAI)

### Phase 4: Voice output (TTS)
- [x] `speechSynthesis` engine; split streaming text into sentences for low latency (unit-checked: markdown stripped, code skipped)
- [x] "Voice on/off" toggle reads every reply; replies to spoken messages are always read aloud; Stop and a new message stop speech
- [ ] Optional OpenAI TTS engine
- [ ] Response mode toggle (text / voice / both); stop/interrupt button
- [ ] Verify: answers are spoken in Chrome and Safari; interrupting stops playback

### Phase 5: Voice input (ASR)
- [x] Mic button with the Web Speech API: live transcript in the input, sends when you pause (hidden where unsupported, e.g. Firefox)
- [x] Hands-free mode (Settings → Voice): mic stays on while the page is visible; a phrase ending with the send word (default "over") sends; paused while guru answers or speaks; mic button pauses/resumes; auto-restarts when the browser ends a session. Verified with fake speech APIs (17 checks).
- [ ] Optional hands-free mode: vad-web + OpenAI transcription; barge-in stops TTS
- [ ] Verify: a full voice round trip in Chrome, Safari and Firefox (OpenAI path, because Firefox has no Web Speech recognition)

### Phase 6: Polish
- [ ] Mobile layout; the atlas panel becomes a sheet on narrow screens
- [ ] Note in Settings that keys are stored in this browser only; button to clear all data
- [ ] README usage section

### Phase 7 (optional, later)
- [ ] Generic MCP Apps host: render `ui://` resources in a sandboxed iframe with the postMessage bridge, so any MCP app plugin works, not just atlas
- [ ] Local companion bridge to use a Claude/Codex subscription through locally running CLIs

## Risks

- **API key exposure:** keys live in `localStorage`. This is acceptable only because each user brings their own key. Never ship a shared key.
- **Third-party MCP servers without CORS** can't be called from the browser. Fallback for Claude only: the Anthropic API `mcp_servers` connector, which calls MCP servers from Anthropic's side.
- **Browser differences:** Web Speech recognition isn't available in Firefox, and Safari limits autoplay (audio playback must start from a user gesture).

## Decisions

1. **Deploy address:** `https://ctzurcanu.github.io/guru/`, the same origin atlas already allows.
2. **Framework:** React.
3. **Models:** the model picker is filled live from each provider's `GET /v1/models`, so new models show up automatically. If that request fails, the static defaults below are used.

| Provider | Default | Other choices |
|---|---|---|
| Claude | `claude-sonnet-5-5`: fast enough for voice turns, strong at tool use | `claude-opus-5-5` (most capable, slower and more expensive), `claude-haiku-5-5` (cheapest and fastest) |
| OpenAI | `gpt-6.2-sol` at medium reasoning effort (OpenAI's recommended default) | `gpt-6.2-astra` (flagship, about 4× the cost), `gpt-6.1-terra` (fast), `gpt-6-luna` (cheapest) |

OpenAI tool calling for the GPT-6.2 models requires the **Responses API**, which the OpenAI adapter uses.
