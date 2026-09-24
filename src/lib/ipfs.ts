// MODULAR: Grove object storage (Lens) — replaces Pinata.
// Docs: https://lens.xyz/docs/storage/usage/upload
// CLEAN: same interface the submissions route already uses —
//        uploadAudio → { cid, url, … }. `cid` is Grove's storage_key
//        (hex); we keep the field name so audio_ipfs_cid / schema stay.
// DRY: only this module talks to api.grove.storage.
//
// Immutable uploads need no API key — only a chain_id for ACL/retention.
// Default: Lens Chain mainnet (232). Override with GROVE_CHAIN_ID.
// Mock mode (tests / GROVE_MOCK=1): deterministic synthetic key, no network.

import { createHash } from "node:crypto";

const GROVE_API = "https://api.grove.storage";
/** Lens Chain mainnet — see https://lens.xyz/docs/chain/resources/network-information */
const DEFAULT_CHAIN_ID = 232;

export interface ObjectStorageUploadResult {
  /** Grove storage_key (hex). Stored in audio_ipfs_cid for historical reasons. */
  cid: string;
  /** HTTPS gateway URL for players / attribution. */
  url: string;
  /** lens://<storage_key> */
  uri: string;
  size: number;
  contentType: string;
  source: "grove" | "mock";
}

export interface ObjectStorageClient {
  uploadAudio(
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): Promise<ObjectStorageUploadResult>;
  /** Immutable Grove objects cannot be deleted; always a no-op. */
  unpin(cid: string): Promise<void>;
  gatewayUrl(storageKey: string, filename?: string): string;
  isConfigured(): boolean;
  mode(): "grove" | "mock";
}

export interface GroveConfig {
  /** When true, never hit the network (tests). */
  mock?: boolean;
  /** EVM chain id for immutable ACL / retention. */
  chainId?: number;
  /** Explicit disable (LOCAL_UPLOADS=0 will then fail closed). */
  disabled?: boolean;
}

type GroveUploadJson = {
  storage_key?: string;
  gateway_url?: string;
  uri?: string;
  status_url?: string;
};

function mockStorageKey(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseChainId(raw: string | undefined): number {
  if (!raw || !raw.trim()) return DEFAULT_CHAIN_ID;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CHAIN_ID;
}

async function waitForStatus(statusUrl: string, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(statusUrl);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        ready?: boolean;
      } | null;
      if (
        body?.ready === true ||
        body?.status === "ready" ||
        body?.status === "completed" ||
        body?.status === "ok"
      ) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function createGroveClient(config: GroveConfig = {}): ObjectStorageClient {
  const mock = Boolean(config.mock);
  const disabled = Boolean(config.disabled);
  const chainId = config.chainId ?? DEFAULT_CHAIN_ID;
  const configured = !disabled && !mock;

  return {
    mode() {
      return configured ? "grove" : "mock";
    },
    isConfigured() {
      // Grove needs no JWT — "configured" means we will attempt a real upload
      // (not mock / not explicitly disabled).
      return configured;
    },
    gatewayUrl(storageKey: string, _filename?: string) {
      const key = storageKey.replace(/^lens:\/\//, "");
      return `${GROVE_API}/${key}`;
    },
    async unpin(_cid: string): Promise<void> {
      // Immutable ACL: deletes are not allowed. Dedup short-circuit used to
      // unpin Pinata pins; under Grove we leave the redundant object.
    },
    async uploadAudio(
      buffer: Buffer,
      _filename: string,
      contentType: string,
    ): Promise<ObjectStorageUploadResult> {
      if (!configured) {
        const cid = mockStorageKey(buffer);
        const url = this.gatewayUrl(cid);
        return {
          cid,
          url,
          uri: `lens://${cid}`,
          size: buffer.length,
          contentType,
          source: "mock",
        };
      }

      // One-step immutable upload (docs): POST body + chain_id query.
      const endpoint = `${GROVE_API}/?chain_id=${chainId}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": contentType || "application/octet-stream",
        },
        body: new Uint8Array(buffer),
      });

      if (!res.ok && res.status !== 201 && res.status !== 202) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Grove upload failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
        );
      }

      const json = (await res.json()) as GroveUploadJson;
      const storageKey = json.storage_key;
      if (!storageKey) {
        throw new Error("Grove upload response missing storage_key");
      }

      if (res.status === 202 && json.status_url) {
        await waitForStatus(json.status_url).catch(() => {
          // Best-effort — object is usually readable at the gateway shortly after.
        });
      }

      const url = json.gateway_url || this.gatewayUrl(storageKey);
      const uri = json.uri || `lens://${storageKey}`;

      return {
        cid: storageKey,
        url,
        uri,
        size: buffer.length,
        contentType,
        source: "grove",
      };
    },
  };
}

/** @deprecated Use ObjectStorageClient — kept for services.ts typing. */
export type PinataClient = ObjectStorageClient;
/** @deprecated */
export type PinataUploadResult = ObjectStorageUploadResult;

export function createIpfsFromEnv(): ObjectStorageClient {
  const mock =
    process.env.GROVE_MOCK === "1" ||
    process.env.GROVE_MOCK === "true" ||
    // Vitest / empty Grove force mock unless explicitly enabled
    (process.env.VITEST === "true" && process.env.GROVE_LIVE !== "1");
  const disabled =
    process.env.GROVE_DISABLED === "1" || process.env.GROVE_DISABLED === "true";

  return createGroveClient({
    mock,
    disabled,
    chainId: parseChainId(process.env.GROVE_CHAIN_ID),
  });
}

/** @deprecated alias */
export const createPinataClient = (config: {
  jwt?: string;
  gateway?: string;
  mock?: boolean;
}): ObjectStorageClient =>
  createGroveClient({
    // Old tests passed jwt to mean "configured" — map to live grove only if
    // they somehow still call this; prefer mock when no jwt (legacy semantics).
    mock: config.mock ?? !config.jwt,
  });
