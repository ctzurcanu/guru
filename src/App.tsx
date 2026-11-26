import {BUILTIN_MCP_SERVERS, DEFAULT_MODELS} from './config.ts';

export default function App() {
  return (
    <main className="app">
      <h1>guru</h1>
      <p>Chat with Claude or OpenAI by voice or text, with MCP plugins.</p>
      <dl>
        <dt>Claude</dt>
        <dd>{DEFAULT_MODELS.anthropic}</dd>
        <dt>OpenAI</dt>
        <dd>{DEFAULT_MODELS.openai}</dd>
        <dt>Plugins</dt>
        <dd>{BUILTIN_MCP_SERVERS.map(s => s.name).join(', ')}</dd>
      </dl>
    </main>
  );
}
