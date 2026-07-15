import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  rateLimitedResponse,
  requestIdFor,
  clientIpFor,
  headerBag,
} from '@/lib/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  const svc = services();
  if (!(await svc.audioLimiter.allow({ headers: headerBag(req) }, clientIpFor(req)))) {
    return rateLimitedResponse(rid);
  }
  try {
    const contentType = req.headers.get('content-type') || '';
    let metadata: Record<string, unknown> | null = null;
    let signature: string | null = null;
    let artistWallet: string | null = null;
    let audioBuffer: Buffer | null = null;
    let audioContentType = 'audio/mpeg';
    let audiusTrackId: string | null = null;

    if (contentType.startsWith('multipart/form-data')) {
      const { parseMultipart } = await import('@/lib/multipart');
      const arrayBuf = await req.arrayBuffer();
      const raw = Buffer.from(arrayBuf);
      parseMultipart({
        contentType,
        body: raw,
        onField(name: string, value: string) {
          if (name === 'signature') signature = value;
          else if (name === 'artistWallet') artistWallet = value;
          else if (name === 'audiusTrackId') audiusTrackId = value || null;
          else if (name === 'metadata') {
            try {
              metadata = JSON.parse(value);
            } catch (err) {
              throw new Error('metadata is not valid JSON: ' + (err as Error).message);
            }
          }
        },
        onFile(name: string, _filename: string, ct: string, data: Buffer) {
          if (name !== 'audio') return;
          audioBuffer = data;
          audioContentType = ct;
        },
      });
    } else {
      const body = (await req.json().catch(() => null)) || {};
      metadata = body.metadata ?? null;
      signature = body.signature ?? null;
      artistWallet = body.artistWallet ?? null;
      audiusTrackId = body.metadata?.audiusTrackId ?? null;
      if (body.audio?.base64) {
        try {
          audioBuffer = Buffer.from(body.audio.base64, 'base64');
        } catch {
          return errorResponse(rid, 400, 'INVALID_AUDIO', 'audio.base64 could not be decoded');
        }
        audioContentType = body.audio.contentType || 'audio/mpeg';
      }
    }

    if (!metadata) return errorResponse(rid, 400, 'MISSING_FIELD', 'metadata is required');
    if (!artistWallet) return errorResponse(rid, 400, 'MISSING_FIELD', 'artistWallet is required');
    if (!signature) return errorResponse(rid, 400, 'MISSING_FIELD', 'signature is required');
    if (!audioBuffer || audioBuffer.length === 0) {
      return errorResponse(rid, 400, 'MISSING_FIELD', 'audio file is required');
    }

    const ext = (audioContentType || 'audio/mpeg').replace(/^audio\//, '').replace(/[^a-z0-9]/gi, '') || 'mp3';
    const crypto = await import('crypto');
    const filename = `${crypto.randomUUID()}.${ext}`;
    const path = await import('path');
    const fs = await import('fs');
    // MODULAR: sha256 of the raw audio bytes — captured ONCE here
    // so the dedup check matches the actual upload content
    // (content-addressed against intent, not the storage
    // location). The service uses audioSha256 + lowercased
    // artistWallet as the dedup key against uq_audio_sha256_wallet
    // in schema.ts.
    const audioSha256 = crypto.createHash('sha256').update(audioBuffer).digest('hex');

    // MODULAR: Pinata-first upload, local FS fallback. We always
    // attempt IPFS because the operator may have configured Pinata
    // but not local storage. If Pinata fails for any reason, we
    // fall back to the local-FS path so the submission still works
    // (IPFS is best-effort, not blocking).
    let audioPath = `data/uploads/${filename}`;
    let audioIpfsCid: string | null = null;
    let ipfsResult: Awaited<ReturnType<typeof svc.ipfs.uploadAudio>> | null = null;
    let ipfsAttempted = false;
    if (svc.ipfs.isConfigured()) {
      ipfsAttempted = true;
      try {
        ipfsResult = await svc.ipfs.uploadAudio(audioBuffer, filename, audioContentType);
        audioIpfsCid = ipfsResult.cid;
        audioPath = `ipfs://${ipfsResult.cid}`;
        log.info('audio uploaded to IPFS', { request_id: rid, cid: ipfsResult.cid, source: ipfsResult.source });
      } catch (err) {
        log.warn('IPFS upload failed, falling back to local FS', {
          request_id: rid,
          err: (err as Error).message,
        });
      }
    }
    if (!ipfsResult) {
      // Fallback path: write to local upload dir.
      const fullPath = path.join(svc.config.uploadDir, filename);
      if (!fs.existsSync(svc.config.uploadDir)) {
        fs.mkdirSync(svc.config.uploadDir, { recursive: true });
      }
      try {
        fs.writeFileSync(fullPath, audioBuffer);
      } catch (err) {
        return errorResponse(rid, 500, 'UPLOAD_FAILED', (err as Error).message);
      }
    }

    const result = await svc.submissions.createSubmission({
      audioPath,
      contentType: audioContentType,
      sizeBytes: audioBuffer.length,
      durationSeconds: null,
      metadata: { ...(metadata as Record<string, unknown>), audiusTrackId } as never,
      artistWallet,
      signature,
      audioIpfsCid,
      audioSha256,
    });

    if (!result.ok) {
      // Best-effort cleanup: remove the IPFS pin (Pinata has unpin API)
      // and/or the local file. We don't surface a failure here.
      try {
        const fullPath = path.join(svc.config.uploadDir, filename);
        fs.unlinkSync(fullPath);
      } catch {
        // ignore cleanup errors
      }
      return errorResponse(rid, 400, 'SUBMISSION_REJECTED', result.error);
    }

    // MODULAR: dedup short-circuit cleanup. A retried upload
    // pinned/uploaded the same audio twice; the canonical
    // artifact already exists from the prior submission, so
    // remove the redundant copy in BOTH storage paths.
    //   - IPFS: best-effort unpin via `svc.ipfs.unpin(cid)` so
    //     Pinata's per-pin quota doesn't leak under retried
    //     IPFS uploads (the exact scenario dedup exists for).
    //   - Local FS: unlinkSync the redundant file.
    if (result.deduped) {
      if (ipfsResult) {
        try {
          await svc.ipfs.unpin(ipfsResult.cid);
        } catch (err) {
          log.warn('IPFS unpin failed on dedup (best-effort)', {
            request_id: rid,
            cid: ipfsResult.cid,
            err: (err as Error).message,
          });
        }
      } else {
        try {
          const fullPath = path.join(svc.config.uploadDir, filename);
          fs.unlinkSync(fullPath);
        } catch {
          // ignore cleanup errors
        }
      }
      audioIpfsCid = null;
    }

    // MODULAR: dedup short-circuit surface. A retried upload
    // (same audio bytes + same wallet) hits the unique index, so
    // the service returns the EXISTING submission with
    // deduped:true. We surface 200 (vs 201 fresh) and the same
    // payload shape so the client doesn't need a separate code
    // branch — only the `deduped` flag distinguishes the paths.
    return successResponse(
      result.deduped ? 200 : 201,
      {
        id: result.submission.id,
        fee_quote_usdc: result.submission.fee_quote_usdc,
        payment_address: svc.config.platformWallet,
        status: result.submission.status,
        audio_url: result.deduped ? result.submission.audio_path : `/api/v1/uploads/${filename}`,
        audio_ipfs_cid: audioIpfsCid,
        submission_message: 'VERSIONS_LEPTON_SUBMIT',
        deduped: result.deduped,
      },
      rid,
    );
  } catch (err) {
    log.error('submission create failed', { request_id: rid, err: (err as Error).message });
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
