# VERSIONS — Lepton API Reference

Base URL: `http://localhost:8080` (dev) · `https://<your-domain>` (prod)

All responses follow the same envelope:

```json
{ "success": true,  "data": { ... } }
{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }
```

Every response carries `x-request-id`. Errors include `requestId` in the
error body for log correlation.

## Health

| Method | Path                | Purpose                                          |
|--------|---------------------|--------------------------------------------------|
| GET    | `/health/live`      | Liveness — does the process exist?               |
| GET    | `/health/ready`     | Readiness — DB migrated, providers configured.   |

## Provider info

| Method | Path                | Purpose                                          |
|--------|---------------------|--------------------------------------------------|
| GET    | `/api/v1/arc/info`  | Chain id, USDC contract, platform wallet, `mock`.|

## Submissions

| Method | Path                                            | Body                                                                   | Returns                                             |
|--------|-------------------------------------------------|------------------------------------------------------------------------|-----------------------------------------------------|
| POST   | `/api/v1/submissions`                           | `{ artistWallet, signature, metadata, audio: { contentType, base64 } }` | `{ id, fee_quote_usdc, payment_address, status, audio_url, submission_message }` |
| GET    | `/api/v1/submissions/queue?limit=20&offset=0`   | —                                                                      | `[{ id, title, artist_name, version_type, status, ... }]` |
| GET    | `/api/v1/submissions/:id`                        | —                                                                      | full submission + `ratings[]` + `settlement_legs[]`    |
| POST   | `/api/v1/submissions/:id/verify-payment`         | `{ txHash }` (`0x` + 64 hex)                                            | updated submission; status flipped to `awaiting_curation` |

Submission `metadata` is validated server-side:

```
title         required, ≤ 200 chars
artistName    required, ≤ 100 chars
versionType   required, one of: demo live acoustic remix remaster studio other
genre         optional, ≤ 50
mood          optional, ≤ 100
description   optional, ≤ 1000
musicbrainzId optional, MBID format
audiusTrackId optional, ≤ 50
```

`signature` is `tweetnacl.sign.detached` over the UTF-8 bytes
`VERSIONS_LEPTON_SUBMIT`, base64-encoded. The server verifies it against
`artistWallet` (base58 Solana address).

`audio.base64` is the file bytes as base64. `audio.contentType` should be
`audio/mpeg`, `audio/wav`, etc. Max body size: 70 MB.

## Curation

| Method | Path                                            | Body                                              | Returns                                                                 |
|--------|-------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------|
| POST   | `/api/v1/submissions/:id/claim`                 | `{ curatorWallet, signature }`                    | `{ id, submission_id, curator_wallet, expires_at }` + `claim_message`   |
| DELETE | `/api/v1/submissions/:id/claim`                 | `{ curatorWallet }`                               | `{ released: bool }`                                                    |
| POST   | `/api/v1/submissions/:id/rate`                  | `{ curatorWallet, signature, rating }`            | `{ rating_id, rating_count, published: { version, settlement_legs, settle_results } | null }` |

`rate` signature is over the UTF-8 bytes `VERSIONS_LEPTON_RATE`. `claim`
signature is over `VERSIONS_LEPTON_CLAIM`. Claims auto-expire after 24h.

`rating` shape:

```
solo_intensity   integer 1-10
vocal_quality    integer 1-10
energy_vs_studio one of lower same higher
tempo_feel       one of dragging locked rushing
mood_tags        array of strings, ≤ 10 entries, each ≤ 50 chars
notes            optional string, ≤ 1000 chars
```

When the 3rd distinct curator rates, the submission is published
atomically. `published` carries the resulting `published_versions` row
and the 5 settlement legs (3 curator + 1 platform + 1 musicbrainz) with
their `tx_hash` and `settled_at`.

## Profiles

| Method | Path                              | Returns                                                                  |
|--------|-----------------------------------|--------------------------------------------------------------------------|
| GET    | `/api/v1/curators/:wallet`        | `{ wallet, ratings_count, total_earned_usdc, recent_ratings: [...] }`     |
| GET    | `/api/v1/artists/:wallet`         | `{ wallet, submissions_count, published_count, total_received_usdc, recent_submissions, recent_published }` |

## Feed

| Method | Path                                                              | Returns                                                                                |
|--------|-------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| GET    | `/api/v1/feed?limit=20&offset=0&mood=&energy=&tempo=&minSolo=&maxSolo=&artist=` | `{ total, limit, offset, rows: [...] }` — published versions, newest first.            |
| GET    | `/api/v1/versions/:id`                                           | `{ version, settlement_legs: [...] }` for a single published version. Returns 404 if not published. |

`mood` is a single tag substring match (e.g. `?mood=Bluesy` matches anything
whose `aggregated_mood_tags` JSON array contains `"Bluesy"`). `energy` and
`tempo` are exact-match. `minSolo`/`maxSolo` filter on `avg_solo_intensity`.

## Uploads

| Method | Path                                  | Returns                                                                                |
|--------|---------------------------------------|----------------------------------------------------------------------------------------|
| GET    | `/api/v1/uploads/:filename`           | The audio file bytes. Day 5 is unguessable-UUIDs only; Day 5+ adds a per-claim auth gate. |

## Errors

| Code                       | HTTP | Meaning                                                       |
|----------------------------|------|---------------------------------------------------------------|
| `INVALID_METADATA`         | 400  | One or more metadata fields failed validation.                |
| `INVALID_TX_HASH`          | 400  | `txHash` is missing or not a `0x`-prefixed 64-char hex string. |
| `INVALID_AUDIO`            | 400  | Audio bytes are missing or undecodable.                       |
| `MISSING_FIELD`            | 400  | A required field was missing from the body.                   |
| `SUBMISSION_REJECTED`      | 400  | Signature / wallet verification failed.                       |
| `CLAIM_REJECTED`           | 400  | Claim failed (artist self-claim, double-claim, wrong status). |
| `RATE_REJECTED`            | 400  | Rate failed (no claim, expired, double-rate, invalid rating).  |
| `VERIFY_PAYMENT_FAILED`    | 400  | `verify-payment` rejected (unknown submission, bad tx).       |
| `BAD_FILENAME`             | 400  | Upload path-traversal attempt.                                |
| `BODY_TOO_LARGE`           | 413  | Request body exceeded the route's size cap.                  |
| `NOT_FOUND`                | 404  | Submission / version / route not found.                       |
| `INTERNAL`                 | 500  | Server error. Check the logs and the returned request id.     |
