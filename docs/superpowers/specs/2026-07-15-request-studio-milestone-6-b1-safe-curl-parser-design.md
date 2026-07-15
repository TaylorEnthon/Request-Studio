# Request Studio Milestone 6 Phase B1 — Safe cURL Parser Design

## 1. Scope

Phase B1 adds a deterministic, non-executing cURL tokenizer and parser for HTTP request import foundations. It does not create Saved Requests or Environments and does not connect to UI, IPC, Preload, SQLite, execution, export, or code generation.

The parser accepts at most 256 KiB of UTF-8 input and supports POSIX shell, PowerShell, and Windows CMD syntax through explicit dialects plus conservative auto-detection.

## 2. Components

Only two production files are needed under `src/shared/curl/`:

- `curl-tokenizer.ts`: dialect detection, quoting, escaping, multiline continuation, token positions, input limit, and shell-metacharacter rejection.
- `curl-parser.ts`: supported cURL option parsing, normalized HTTP request output, secret replacement, and stable errors.

Types and errors remain next to their only consumer. No dependency is added: a generic shell parser would accept syntax this boundary must reject, while regular expressions alone cannot safely model all three dialects.

## 3. Tokenizer Contract

The tokenizer accepts a string and `auto | posix | powershell | cmd`. It returns the selected dialect and ordered tokens with source positions.

It supports:

- whitespace-separated arguments;
- POSIX single and double quotes plus backslash escapes and continuation;
- PowerShell single and double quotes plus backtick continuation and supported escapes;
- CMD double quotes plus caret continuation and supported escapes.

It never expands variables or executes commands. Active shell operators, redirects, pipes, command substitution, and statement separators are blocking errors. Quote characters and operator characters inside a quoted literal remain data when that dialect would not execute them.

Malformed quoting, dangling escapes, unsupported shell constructs, and oversized input produce `CurlParseError` without echoing the input.

## 4. Parser Contract

The parser accepts only `curl` or `curl.exe` and supports:

- positional URL and `--url`;
- `-X` and `--request`;
- `-H` and `--header`, preserving order and duplicates;
- `-d`, `--data`, and `--data-raw`, joining repeated values with `&`;
- `-u` and `--user`.

Body data infers `POST` when no method is explicit. Without data, the default method is `GET`. JSON content with a JSON content type becomes a JSON body; other data remains text. URL query entries are normalized into ordered RequestAsset-compatible params.

The result contains the selected dialect, warnings, `sensitiveFields`, and an HTTP request object compatible with the `RequestAssetV1` request shape. It does not create the full Asset envelope because Phase B1 has no import name or persistence context.

Unsupported flags fail explicitly. File-reading and credential-file flags are always rejected, including `@file` data, `--data-binary`, `-F/--form`, `--upload-file`, `--cert`, `--key`, and `--config`. `file://` URLs are rejected.

## 5. Secret Boundary

Credential-shaped input is replaced during parsing, before a result can be returned:

- bearer credentials use `{{TOKEN}}`, then stable numeric suffixes on collision;
- Basic username/password use `{{BASIC_USERNAME}}` and `{{BASIC_PASSWORD}}`;
- other sensitive header/query fields use semantic names such as `{{API_KEY}}` or `{{HEADER_SECRET}}`, with stable numeric suffixes.

Placeholder generation depends only on field semantics and occurrence order. It never uses secret content, hashes, prefixes, suffixes, or length.

`sensitiveFields` stores only kind, source position, and placeholder. It never stores the original credential. Returned requests, errors, logs, snapshots, and tests must not contain raw secrets. Phase B1 intentionally does not implement the future Main-only in-memory secret mapping channel.

## 6. Error Model

`CurlParseError` contains:

- stable `code`;
- user-facing generic `message`;
- optional `position`;
- optional `dialect`;
- optional unsupported `flag`.

Errors never include the command, token value, header value, body, credential, or nearby source excerpt.

## 7. Tests

One focused test file covers real tokenizer and parser behavior:

- POSIX, PowerShell, and CMD quoting/continuation;
- GET and POST JSON;
- repeated headers and data;
- method, URL, body, Basic auth, and secret placeholder mapping;
- oversized input, malformed tokens, unknown flags, file references, `file://`, and shell syntax rejection;
- proof that results and errors do not contain raw credential fixtures.

Implementation follows RED → GREEN → refactor. Full repository lint, typecheck, tests, build, database/media/streaming/Electron smoke, and `git diff --check` run before the feature commit.

## 8. Impact Boundary

CodeGraph shows the new shared parser can remain disconnected from Renderer, Main, request repositories, execution services, IPC, Preload, and SQLite. Phase B1 adds no caller outside its tests. A later import phase may consume the parser through a Main-only preview flow after a separate secret-mapping design.
