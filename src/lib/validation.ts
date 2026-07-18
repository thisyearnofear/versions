// MODULAR: Zod schemas for request validation. Single source of truth for
// request shape; routes and services call these instead of hand-rolled checks.

import { z } from 'zod';
import type { VersionType, Energy, Tempo } from './types';

export const VERSION_TYPES = ['demo', 'live', 'acoustic', 'remix', 'remaster', 'studio', 'other'] as const;
export const ENERGIES = ['lower', 'same', 'higher'] as const;
export const TEMPOS = ['dragging', 'locked', 'rushing'] as const;

export const MAX_MOOD_TAGS = 10;
export const MAX_MOOD_TAG_LEN = 50;
export const MAX_NOTES_LEN = 1000;

export const ModeSchema = z.enum(['music', 'sfx']);

export const PromptTextSchema = z.string().trim().min(1).max(500);

export const SubmissionMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artistName: z.string().trim().min(1).max(100),
  versionType: z.enum(VERSION_TYPES),
  genre: z.string().max(50).optional().nullable(),
  mood: z.string().max(100).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  audiusTrackId: z.string().max(50).optional().nullable(),
  musicbrainzId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'musicbrainzId must be a valid MBID')
    .optional()
    .nullable(),
  // MODULAR: Move 3 — cover_svg is an optional string. The
  // client generates it client-side (decodeAudioData → peaks
  // → SVG). We only sanity-check the shape: must be a string
  // that starts with <svg, max 16KB.
  coverSvg: z
    .string()
    .max(16384, 'coverSvg must be 16KB or less')
    .refine((s) => s.startsWith('<svg'), { message: 'coverSvg must start with <svg' })
    .optional()
    .nullable(),
});
export type SubmissionMetadataInput = z.infer<typeof SubmissionMetadataSchema>;

export const ArcTxHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a 0x-prefixed 64-character hex string');

export const RatingSchema = z.object({
  solo_intensity: z.number().int().min(1).max(10),
  vocal_quality: z.number().int().min(1).max(10),
  energy_vs_studio: z.enum(ENERGIES),
  tempo_feel: z.enum(TEMPOS),
  mood_tags: z
    .array(z.string().trim().min(1).max(MAX_MOOD_TAG_LEN))
    .max(MAX_MOOD_TAGS)
    .optional(),
  notes: z.string().max(MAX_NOTES_LEN).optional().nullable(),
});
export type RatingInput = z.infer<typeof RatingSchema>;

// MODULAR: EVM signature helpers (replaces Solana bs58/tweetnacl).
// Wallet must be 0x-prefixed 20-byte hex; signature must be 0x-prefixed
// 65-byte hex (130 chars + "0x"). The signed message is the constant
// VERSIONS_LEPTON_SUBMIT.

export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'wallet must be a 0x-prefixed 20-byte hex address');

export const EvmSignatureSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, 'signature must be a 0x-prefixed 65-byte hex string');

// Legacy helpers (kept as thin wrappers for routes that still call them).
export function validateMode(value: unknown): boolean {
  return value === 'music' || value === 'sfx';
}

export function validatePromptText(value: unknown, fieldName: string): string | null {
  if (typeof value !== 'string') return `${fieldName} must be a string`;
  const trimmed = value.trim();
  if (!trimmed) return `${fieldName} is required`;
  if (trimmed.length > 500) return `${fieldName} must be 500 characters or less`;
  return null;
}

export function validateSubmissionMetadata(input: unknown): { ok: true } | { ok: false; errors: string[] } {
  const r = SubmissionMetadataSchema.safeParse(input);
  if (r.success) return { ok: true };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`) };
}

export function validateArcTxHash(hash: unknown): string | null {
  const r = ArcTxHashSchema.safeParse(hash);
  if (r.success) return null;
  return r.error.issues[0]?.message ?? 'invalid txHash';
}

export function validateRating(input: unknown): { ok: true; data: RatingInput } | { ok: false; errors: string[] } {
  const r = RatingSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`) };
}

export function parsePositiveInt(value: unknown, fallback: number | null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// ── Supervisor dashboard validation ─────────────────────

export const SUPERVISOR_ROLES = ['supervisor', 'sync_house', 'aandr'] as const;
export const LICENSING_STATUSES = ['interested', 'contacted', 'licensed', 'passed'] as const;

export const SupervisorProfileUpdateSchema = z.object({
  email: z.string().trim().email().max(254).optional().nullable(),
  name: z.string().trim().max(100).optional().nullable(),
  company: z.string().trim().max(100).optional().nullable(),
  role: z.enum(SUPERVISOR_ROLES).optional().nullable(),
});
export type SupervisorProfileUpdateInput = z.infer<typeof SupervisorProfileUpdateSchema>;

export const BriefTextInputSchema = z.object({
  briefText: z.string().trim().min(3).max(500),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type BriefTextInputValidated = z.infer<typeof BriefTextInputSchema>;

export const LicensingInterestSchema = z.object({
  submissionId: z.string().trim().min(1),
  status: z.enum(LICENSING_STATUSES).optional(),
  notes: z.string().max(MAX_NOTES_LEN).optional().nullable(),
});
export type LicensingInterestValidated = z.infer<typeof LicensingInterestSchema>;

export const LicensingInterestUpdateSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(LICENSING_STATUSES).optional(),
  notes: z.string().max(MAX_NOTES_LEN).optional().nullable(),
});
export type LicensingInterestUpdateValidated = z.infer<typeof LicensingInterestUpdateSchema>;

export type { VersionType, Energy, Tempo };
