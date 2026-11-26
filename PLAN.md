# guru — Implementation Plan

A static web app (built with Vite, hosted on GitHub Pages) for chatting with Claude or OpenAI models. It takes voice input, answers in voice and/or text, and calls tools from remote MCP servers. The first built-in plugin is **atlas**.

## Constraints

- **Static only:** no server code. Everything runs in the browser.
- **Bring your own API key:** the browser calls Anthropic and OpenAI directly. Keys are stored only in the user's browser.
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
| LLM: Claude | `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` (sends the `anthropic-dangerous-direct-browser-access` header) |
| LLM: OpenAI | `openai` SDK with `dangerouslyAllowBrowser: true` (Responses API) |
| MCP | `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` |
| ASR | Default: Web Speech API. Optional: OpenAI transcription (BYO key) with `@ricky0123/vad-web` voice-activity detection for hands-free turns (the approach saypi uses) |
| TTS | Default: `speechSynthesis`. Optional: OpenAI TTS (BYO key), streamed sentence by sentence |
| Storage | `localStorage` for settings and keys; IndexedDB for conversation history |
| Deploy | GitHub Actions → GitHub Pages, `base: '/guru/'` |

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
- [ ] Enable Pages (Settings → Pages → Source: GitHub Actions). The repo is currently private, so Pages needs a paid GitHub plan or a public repo.
- [ ] Verify: the live URL loads

### Phase 2: Text chat with your own key
- [ ] Settings dialog: provider (Claude / OpenAI), API key, model
- [ ] Anthropic and OpenAI streaming adapters behind the common interface
- [ ] Chat UI with streaming and Markdown rendering; history in IndexedDB
- [ ] Verify: a streaming conversation works with each provider from the deployed site; an invalid key shows a clear error

### Phase 3: MCP and atlas
- [ ] MCP registry: connect, `tools/list`, convert schemas for Anthropic and OpenAI
- [ ] Agent loop with tool calls (with a cap on iterations and a visible tool-call trace)
- [ ] Pre-registered atlas server; side panel showing the `show_anatomy` viewer URL in an iframe
- [ ] Settings: add/remove/toggle MCP server URLs, with a clear CORS error message
- [ ] Verify: "show me the heart" → `show_anatomy` → the viewer renders in the panel, with both providers

### Phase 4: Voice output (TTS)
- [ ] `speechSynthesis` engine; split streaming text into sentences for low latency
- [ ] Optional OpenAI TTS engine
- [ ] Response mode toggle (text / voice / both); stop/interrupt button
- [ ] Verify: answers are spoken in Chrome and Safari; interrupting stops playback

### Phase 5: Voice input (ASR)
- [ ] Push-to-talk with the Web Speech API
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
