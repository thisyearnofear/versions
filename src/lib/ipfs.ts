// MODULAR: Pinata IPFS client wrapper.
// CLEAN: same interface for real and mock clients — the route handler
//        asks the client to upload and gets back { cid, url }.
// DRY: the only place that talks to Pinata; the route handler doesn't
//      import the SDK directly.
// PERFORMANT: mock client is deterministic (sha256 → base32 CIDv1) so
//             dev mode and tests get the same CID for the same input.

import { createHash } from "node:crypto";
import { PinataSDK } from "pinata";

export interface PinataUploadResult {
  cid: string;
  url: string;
  size: number;
  contentType: string;
  source: "pinata" | "mock";
}

export interface PinataClient {
  uploadAudio(
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<PinataUploadResult>;
  gatewayUrl(cid: string, filename?: string): string;
  isConfigured(): boolean;
  mode(): "pinata" | "mock";
}

export interface PinataConfig {
  jwt?: string;
  gateway?: string;
}

const DEFAULT_GATEWAY = "https://gateway.pinata.cloud";

function resolveGateway(config: PinataConfig): string {
  // Strip any trailing /ipfs path segment so that gatewayUrl()
  // doesn't double it.
  return (config.gateway || DEFAULT_GATEWAY)
    .replace(/\/ipfs\/?$/i, "")
    .replace(/\/$/, "");
}

// MODULAR: deterministic CIDv1 base32 from a buffer hash. Not a real
// IPFS CID (no multihash/multibase encoding of the actual content)
// but a stable, content-addressable identifier that's good enough
// for dev + tests. Format matches real Pinata output (bafy... + base32).
function mockCid(buffer: Buffer): string {
  const hash = createHash("sha256").update(buffer).digest();
  // CIDv1 base32-lowercase with sha256 (code 0x12, length 0x20).
  // Multicodec: dag-pb (0x70) wrapped in varint; multibase: base32lower 'b'.
  const prefix = Buffer.from([0x01, 0x70, 0x12, 0x20]);
  const full = Buffer.concat([prefix, hash]);
  // base32 lowercase without padding
  const base32 = full.toString("base64").replace(/=/g, "").toLowerCase();
  // Pad/truncate to 59 chars (matches CIDv1 + sha256 length)
  return "bafy" + base32.replace(/[^a-z2-7]/g, "").slice(0, 55);
}

export function createPinataClient(config: PinataConfig): PinataClient {
  const jwt = config.jwt;
  const configured = Boolean(jwt);
  const gateway = resolveGateway(config);

  // MODULAR: real client. Constructed lazily so dev mode (no keys)
  // doesn't try to authenticate at boot.
  let sdk: PinataSDK | null = null;
  function getSdk(): PinataSDK {
    if (sdk) return sdk;
    if (!configured) {
      throw new Error("Pinata not configured — set PINATA_JWT");
    }
    sdk = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: gateway.replace(/^https?:\/\//, ""),
    });
    return sdk;
  }

  return {
    mode() {
      return configured ? "pinata" : "mock";
    },
    isConfigured() {
      return configured;
    },
    gatewayUrl(cid: string, filename?: string) {
      const base = `${gateway}/ipfs/${cid}`;
      return filename ? `${base}/${filename}` : base;
    },
    async uploadAudio(
      buffer: Buffer,
      filename: string,
      contentType: string,
    ): Promise<PinataUploadResult> {
      if (!configured) {
        const cid = mockCid(buffer);
        return {
          cid,
          url: this.gatewayUrl(cid, filename),
          size: buffer.length,
          contentType,
          source: "mock",
        };
      }
      // Real upload. Pinata's SDK expects a Web `File`. Buffer → File
      // shim works in Node 22 (the SDK constructor accepts either).
      const file = new File([new Uint8Array(buffer)], filename, { type: contentType });
      const result = await getSdk().upload.public.file(file, {
        metadata: { name: filename },
      });
      return {
        cid: result.cid,
        url: this.gatewayUrl(result.cid, filename),
        size: result.size,
        contentType: result.mime_type || contentType,
        source: "pinata",
      };
    },
  };
}

export function createIpfsFromEnv(): PinataClient {
  const config: PinataConfig = {
    jwt: process.env.PINATA_JWT || undefined,
    gateway: process.env.PINATA_GATEWAY || undefined,
  };
  return createPinataClient(config);
}
