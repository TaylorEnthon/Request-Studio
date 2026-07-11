# Request Studio Milestone 3 Report

## Scope delivered

Smart MIME normalization, finite signature detection, mismatch warnings, image/audio/video/PDF/Binary viewers, controlled resource protocol with Range, schema v3 resource ownership, History reopen/cleanup/recovery, manual JSON Base64 inspection/extraction/dedup, safe filenames, inline/managed Save As, CSP, and navigation hardening.

## Limits

Responses and decoded Base64 are capped at 50 MiB; Base64 input at 70 MiB characters; Hex preview at 4096 bytes (IPC ceiling 16 KiB); History at 500 rows; image warning at 100 megapixels. Chromium determines codec and PDF-preview availability. PDF page count, waveform, transcoding, editing, WebSocket, SSE, Experiment, and Compare are not implemented. Environment secrets remain plaintext in SQLite.

## Verification record

Local mock fixtures bind only to `127.0.0.1`. Final command results, commit hashes, GitHub run/job IDs, and the exact CI conclusion are recorded after remote closure.
