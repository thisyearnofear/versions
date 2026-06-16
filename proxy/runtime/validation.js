// MODULAR: input validation helpers. Single source of truth for request
// shape; routes and services call these instead of rolling their own checks.

'use strict';

const VALID_VERSION_TYPES = new Set([
  'demo', 'live', 'acoustic', 'remix', 'remaster', 'studio', 'other'
]);

function validateMode(value) {
  return value === 'music' || value === 'sfx';
}

function validatePromptText(value, fieldName) {
  if (typeof value !== 'string') {
    return `${fieldName} must be a string`;
  }
  const trimmed = value.trim();
  if (!trimmed) return `${fieldName} is required`;
  if (trimmed.length > 500) return `${fieldName} must be 500 characters or less`;
  return null;
}

function validateSubmissionMetadata(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['metadata object is required'] };
  }
  const errors = [];
  const { title, artistName, versionType, genre, mood, description, audiusTrackId, musicbrainzId } = input;

  if (!title || typeof title !== 'string' || !title.trim()) errors.push('title is required');
  else if (title.length > 200) errors.push('title must be 200 characters or less');

  if (!artistName || typeof artistName !== 'string' || !artistName.trim()) errors.push('artistName is required');
  else if (artistName.length > 100) errors.push('artistName must be 100 characters or less');

  if (!versionType || !VALID_VERSION_TYPES.has(versionType)) {
    errors.push(`versionType must be one of: ${[...VALID_VERSION_TYPES].join(', ')}`);
  }

  if (genre != null && (typeof genre !== 'string' || genre.length > 50)) {
    errors.push('genre must be a string of 50 characters or less');
  }
  if (mood != null && (typeof mood !== 'string' || mood.length > 100)) {
    errors.push('mood must be a string of 100 characters or less');
  }
  if (description != null && (typeof description !== 'string' || description.length > 1000)) {
    errors.push('description must be a string of 1000 characters or less');
  }
  if (audiusTrackId != null && (typeof audiusTrackId !== 'string' || audiusTrackId.length > 50)) {
    errors.push('audiusTrackId must be a string of 50 characters or less');
  }
  if (musicbrainzId != null) {
    const mbidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof musicbrainzId !== 'string' || !mbidRe.test(musicbrainzId)) {
      errors.push('musicbrainzId must be a valid MBID');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

function validateArcTxHash(hash) {
  if (typeof hash !== 'string' || !hash) return 'txHash is required';
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return 'txHash must be a 0x-prefixed 64-character hex string';
  }
  return null;
}

module.exports = {
  parsePositiveInt,
  validateMode,
  validatePromptText,
  validateSubmissionMetadata,
  validateArcTxHash,
  VALID_VERSION_TYPES
};

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
