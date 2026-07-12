# Request Studio Milestone 4 — WebSocket & SSE Streaming Design

## Current seams and chosen approach

Saved requests already distinguish `http | websocket | sse`, but only HTTP has typed aggregates and UI. Main owns fetch, cancellation, controlled file references, immutable History, managed resources and whitelisted event delivery. Milestone 4 reuses the key/value/auth/variable builder rules, FileRegistry, response classification, custom resource protocol and resource Viewer, while keeping HTTP execution IDs and History separate from streaming connection/session IDs and streaming History.

Three WebSocket clients were evaluated. Node 22.22.1 exposes a WHATWG WebSocket, but its local runtime has no `ping()` and no reliable custom-header options. Chromium WebSocket would violate Main-only transport ownership. `ws@8.21.0` is selected because it supports custom Headers, ordered Subprotocols, binary messages, protocol ping/pong, close metadata, `maxPayload`, deterministic local servers and Windows/Electron; it is MIT and adds one small production dependency. Socket.IO is not supported. SSE uses built-in fetch, streaming TextDecoder and a finite pure parser.

## Contracts and configuration

Shared streaming contracts define separate `connectionId` (active Main handle), `sessionId` (persistent immutable execution), lifecycle state, event envelope and bounded record view. IDs are Main-generated UUIDs. Event envelopes never include Electron events, paths, Headers or credentials and are sent only to the BrowserWindow that initiated a connection.

WebSocket drafts contain URL, query, Headers, reusable auth, ordered Subprotocols, connect/idle timeout, ping enabled/interval, auto-reconnect/max attempts/fixed delay and maximum message size. SSE drafts contain GET/POST, URL, query, Headers, auth, none/json/text/form body, connect/idle/session timeout and maximum event bytes. Defaults are finite. URL schemes are exactly `ws/wss` or `http/https`; TLS validation is never disabled.

Saved-request schema v4 adds `stream_config_json`. Zod validates aggregates and the update handler chooses the schema by stored request protocol so Renderer cannot replace identity/workspace/protocol fields. Message templates use a small table instead of speculative scripting.

## Database and retention

Schema v4 adds `stream_sessions`, `stream_records`, `stream_message_templates` and `stream_resources`. A session keeps a redacted request snapshot, timestamps, final state/close summary/error and counters. Records use one ordered table for WebSocket system/messages and SSE events; protocol-specific values live in explicit nullable columns plus bounded metadata JSON. Saved Request deletion uses `SET NULL`; Workspace/session deletion cascades. Per session DB retention is 5,000 records, live Renderer retention is 500, and per-workspace session retention is 200. Pruning removes managed directories after the transaction.

Resources live at `<userData>/stream-assets/<workspaceId>/<sessionId>/<recordId>.bin`. Binary messages always become resources; text over 64 KiB becomes a managed UTF-8 resource with a bounded preview. The existing protocol/registry is extended with `stream_resources` recovery and ownership, so media/binary Viewer and Range remain shared. Delete, clear, retention, Workspace deletion and orphan cleanup affect only stream-assets. User source files and Save As files are never owned.

## Redaction

Transport snapshots reuse auth/Header redaction and replace resolved secret Environment values in URL/query/body/messages before persistence. Text/JSON records additionally redact common credential field names and known secret values; binary is not scanned. Previews are capped and errors/close reasons are length-bounded without payload echo. UI states that arbitrary business secrets cannot all be inferred. A redacted snapshot cannot reconnect directly or create an executable draft without user re-entry.

## WebSocket service

One Main service owns `Map<connectionId, ActiveConnection>` and a same-request guard. Each entry keeps session/workspace/request, socket generation, state, sequence/counters, timers, reconnect attempt, last activity and close intent. Central transition logic permits validating → connecting → open → closing/closed, abnormal close → reconnecting → connecting, and terminal failed. Old-generation handlers return immediately. User disconnect and shutdown never reconnect; code 1000 does not reconnect; abnormal close uses a fixed delay and a finite maximum.

Connect builds URL/query/Headers/auth through shared helpers, validates Subprotocol tokens, creates the session first, registers the active entry and emits connecting. Connect timeout terminates; idle timeout uses any inbound/pong activity. Protocol ping is optional, only open, with interval 5–300 seconds; missing activity is handled by idle timeout. All timers/listeners are cleared on socket replacement or terminal state.

Text allows empty payload, resolves variables and records UTF-8 bytes. JSON resolves then reparses. Binary composer reuses strict Base64 inspection with the draft maximum. File uses an opaque FileRegistry ref and Main-side bytes capped by maximum message size. Send is allowed only when open. Inbound `ws` messages are already frame-assembled; text is JSON-probed, binary is classified and resourceized. A message over `maxMessageBytes` terminates with a stable too-large error rather than truncating.

## SSE parser and service

The pure parser accepts decoded text chunks and owns only line/event state. The service owns streaming `TextDecoder`, preserving split UTF-8, CR/LF/CRLF and split delimiters. Parser supports comments, event/data/id/retry, optional one space after colon, unknown fields, multiline data joined by LF, decimal nonnegative retry, ignores IDs containing NUL, strips a first BOM and dispatches on blank line. At stream end it flushes the decoder but does not invent an event without a terminating blank line.

SSE fetch runs in Main with AbortController. Explicit Headers override defaults `Accept: text/event-stream` and `Cache-Control: no-cache`. HTTP errors and non-event-stream content fail closed. Connect timeout lasts to response Headers; idle timeout resets on any bytes; session timeout is a hard cap. Events over configured size fail the session. Stop is idempotent and is a non-error terminal state. Metrics use `Date.now()` consistently: started, connected, first event, time-to-first-event, event/byte counts, duration, last event ID and retry hint.

## IPC, Renderer and History

Preload exposes named websocket connect/disconnect/sendText/sendJson/sendBinary/sendFile and SSE connect/stop methods, plus separate lifecycle/record subscriptions with unsubscribe. Streaming History exposes list/get/delete/clear/create request/reconnect; all Zod-validate IDs and ownership. No generic invoke/event/path API is added.

App selects a protocol-specific editor. Both editors reuse small Params/Auth/Headers components. WebSocket UI has URL/connect controls, tabs, native message composer, templates, state overview and a 500-record timeline with simple filters and pause/resume follow. SSE UI has method/URL/connect controls, Body/Settings, metrics, event timeline/detail and simple aggregated data. Switching requests filters by connection/session and unsubscribes; stale events cannot bind to the new request. Binary timeline details render the Milestone 3 ResourceViewer.

## Capacity, failures and shutdown

Defaults/hard limits: WebSocket 10 MiB/50 MiB message, SSE 1 MiB/10 MiB event, 64 KiB inline text, 500 live records, 5,000 DB records, 200 sessions/workspace, SSE duration 30 minutes default/24 hours maximum, reconnect maximum 10, ping 5–300 seconds, previews 2 KiB. Single Saved Request has one active connection per protocol; different requests may run concurrently.

Every connect attempt creates a stable session, including validation/connect failure. Error objects are display-safe and payload-free. `before-quit` disconnects/stops all with shutdown intent, clears timers and prevents reconnect. Tests own 127.0.0.1 random-port WebSocket/SSE servers and all temp roots; no public network, real keys or real userData are used.

## Scope boundary

This milestone creates stable complete-message and event records suitable for later audio-chunk assembly, but does not assemble or play streaming audio, add vendor adapters, scripts, pressure runners, Experiments, Compare, import/export, code generation, safeStorage or installer behavior.
