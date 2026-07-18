# Request Studio Milestone 6 Phase D3 — Code Generation Quality Refinement Design

## Decision

Refine the protocol-specific `CodeGenerationModel` union introduced in Phase D2. Do not add another intermediate abstraction and do not let adapters read `RequestAssetV1` directly.

The generation boundary remains:

```text
RequestAssetV1 -> sanitizer -> protocol model -> language adapter -> generated text
```

## Model and diagnostics

`HttpCodeGenerationModel`, `SseCodeGenerationModel`, and `WebSocketCodeGenerationModel` remain the only adapter inputs. Code generation owns a diagnostic contract:

```ts
type CodeGenerationWarning = Readonly<{
  code: string
  severity: 'info' | 'warning'
  message: string
}>
```

This avoids changing the independent request-export contract. Safe degradations such as opaque text review and omitted browser WebSocket headers produce warnings. A missing adapter or protocol mismatch remains a deterministic hard error because no valid generated output exists.

## HTTP output

- JavaScript Fetch keeps async/await, emits parsed JSON through `JSON.stringify`, and checks `response.ok`.
- TypeScript Axios emits parsed JSON as `data` and relies on Axios rejection semantics.
- Python requests uses `json=json.loads(...)` for JSON, `data=` for text/form data, and calls `raise_for_status()`.
- Query parameters, enabled headers, Bearer auth, Basic auth, and API-key auth continue to be normalized before adapter selection.

JSON parsing is attempted only for bodies declared as JSON. Invalid JSON stays a deterministic string and produces a warning rather than causing code generation to fail.

## SSE output

The SSE adapter emits an `AbortController`, passes its signal to Fetch, checks the response, incrementally decodes the stream, frames events by blank lines, and extracts `event`, `data`, `id`, and `retry`. The retry field is surfaced as a reconnect hint; the generator does not implement hidden automatic reconnect behavior.

## WebSocket output

The browser adapter emits explicit open, message, error, and close listeners. Custom/header authentication remains omitted because the browser WebSocket API cannot represent it; a structured warning explains the degradation.

## Security and determinism

Sanitization remains before model construction. Models contain no database identifiers, runtime metadata, filesystem paths, or resolved environment secrets. Adapter formatting is pure and contains no random values, timestamps, network calls, or filesystem access, so identical sanitized assets and language selections produce identical results.

## Scope

This phase adds no languages, AI generation, template engine, generated-code execution, file/project generation, schema migration, network execution, or dependency installation.
