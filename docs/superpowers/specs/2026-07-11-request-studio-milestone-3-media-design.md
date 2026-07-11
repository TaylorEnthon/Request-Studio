# Request Studio Milestone 3 — Smart Response & Media Preview Design

## Current model

Milestone 2 classifies only from `Content-Type`, sends inline binary as Base64, stores large bodies as anonymous files, and exposes no controlled response-resource API. History owns at most one file path and the Renderer cannot reopen that file. The response panel is a single compact component with no media lifecycle.

## Chosen architecture

Three options were evaluated: all-Blob IPC, all-custom-protocol, and a hybrid. All-Blob duplicates large data; all-protocol needlessly writes small text. The selected hybrid keeps JSON/text inline and puts every binary/media response and Base64 extraction in the application-managed History asset directory. A random resource ID maps to an asset descriptor, and `request-studio-resource://resource/<id>` streams only registered assets. No absolute path crosses IPC.

No new production dependency is needed. Electron protocol handling, Chromium `<img>`, `<audio>`, `<video>`, sandboxed `<iframe>`, Node streams, Buffer and crypto cover the milestone. PDF.js, FFmpeg, Sharp, wavesurfer and broad file-type packages are deliberately excluded.

## Response classification

`ResponseBodyKind` becomes `empty | json | text | html | xml | image | audio | video | pdf | binary`. MIME parsing trims, lowercases, removes parameters, records charset, and recognizes `+json`/`+xml`. A pure signature detector reads at most 64 prefix bytes and recognizes PNG, JPEG, GIF, WebP, BMP, ICO, SVG, WAV, MP3, OGG, FLAC, AAC/ADTS, M4A/MP4, WebM, PDF, ZIP, GZIP, RAR, 7z, PE and ELF.

Priority is signature for active or binary media, then a compatible declared MIME, conservative UTF-8 text sniffing, then binary. A mismatch produces warnings and never claims codec playability. SVG remains untrusted and is shown as source/binary information rather than injected into the DOM.

## Resource contract and lifecycle

`ResponseResourceDescriptor` contains a random ID, History ID, source, kind, declared/detected/effective MIME, byte length, safe suggested filename, warnings, storage mode and reliable metadata only. The registry resolves only records recovered from `request_history` or created in the current session. `realpath` must remain below `history-assets` or `session-assets`; symlinks and traversal are rejected.

History assets use `<userData>/history-assets/<workspaceId>/<historyId>/response.bin` and `extraction-<sha256>.bin`. HTTP execution creates the History ID before streaming, so the asset and row share stable ownership. Delete, clear, retention eviction and workspace deletion remove only these directories after DB deletion. Startup removes only top-level History directories whose IDs are absent from the DB. Save As targets and request upload files are outside this ownership and are never cleaned.

## Resource loading and Range

The custom protocol is registered as standard, secure, stream-capable and CSP-allowed. It accepts only `/resource/<UUID>`. A pure Range parser supports no range, open-ended, closed and suffix ranges; invalid or unsatisfiable ranges return 416. Valid ranges stream from disk with 206, `Content-Range`, `Accept-Ranges` and exact `Content-Length`; full responses stream with 200. Prefix preview IPC is capped at 16 KiB and defaults to 4 KiB.

Inline text is not copied to the protocol unless the user saves it. Binary bodies are always managed resources, avoiding Base64 IPC and making current-response and History viewers identical. Registry recovery from the History row makes assets available after restart.

## Viewers and metadata

The panel owns one descriptor-based viewer model. Image uses native `<img>` with fit/100%/zoom, dimensions from load events and a 100-megapixel warning. Audio and video use native controls plus playback-rate and loop controls; duration and video dimensions come only from browser metadata. Codec/container recognition never implies playback support. PDF uses a sandboxed iframe pointed at the controlled protocol, with no `allow-scripts`, popups or navigation privileges; page count is omitted because it cannot be obtained reliably without a PDF parser. Binary reads the first 4096 bytes and renders offset, hex and ASCII plus executable/archive warnings.

Object URLs are unnecessary because media use the protocol. Async descriptor/preview loads use request tokens so switching response or History cannot apply stale results. HTML/XML remain escaped text. CSP permits the resource scheme only for image/media/frame sources and continues to deny remote and inline scripts.

## Base64 inspection

The JSON tree renders objects, arrays and primitives with bounded default depth and a node-count warning. String nodes offer copy value, copy JSON Path and Inspect as Base64. Inspection is explicit; the app never scans all strings. Data URLs and plain Base64 are accepted with ASCII whitespace removal, strict alphabet/padding validation and optional unpadded normalization. Input is capped at 70 MiB characters, estimated decoded bytes at 50 MiB, and minimum suggestion length is 16 characters. Estimation occurs before Buffer allocation.

Extraction reclassifies decoded bytes and writes directly into the owning History directory. `historyId + JSON path + sha256` deduplicates repeated extraction. Declared Data URL MIME is only a hint; conflicts produce warnings. Errors never echo payloads. Session extraction is allowed only for a response whose History row already exists, because HTTP execution persists History before emitting completion.

## Save As and filenames

Renderer sends only a resource ID, or an inline text payload with its response descriptor. Main validates with Zod, sanitizes `Content-Disposition filename*`, filename, URL basename, Windows reserved names, separators, controls and length, then shows `dialog.showSaveDialog`. Managed assets use streamed copy; inline text uses `writeFile`. The application neither logs the chosen path nor opens the result.

## Security boundaries

`contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` remain. There is no generic read/write/path/file-URL IPC. Protocol IDs cannot contain slashes or paths, and every resolved file is realpath-checked. HTML and SVG are never injected; PDF has no Node access and cannot navigate the main window. Downloaded content is never executed or automatically opened. Existing plaintext Environment secrets and redacted-History rerun behavior remain unchanged.

## Testing and limits

Pure tests cover MIME, signatures, conflicts, short headers, Range and Base64. Main integration tests cover registry recovery, traversal/symlink rejection, cleanup, dedup, prefix limits and save restrictions using temporary directories. Renderer tests cover viewer selection, metadata/error states, JSON actions and race protection. The local mock server supplies tiny original fixtures on `127.0.0.1`. Electron smoke verifies PNG, WAV, Base64 extraction and History reopen where Chromium is stable; playback itself stays a component/DOM responsibility.

Limits: 50 MiB response and decoded Base64, 70 MiB Base64 input, 4096-byte Hex preview, 16 KiB preview ceiling, 100-megapixel image warning, 500 History rows per workspace. Experiment/Compare can later reference the same immutable History/resource descriptors without changing this lifecycle. WebSocket, SSE, streaming media assembly and all other excluded features remain Milestone 4+.
