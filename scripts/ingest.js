#!/usr/bin/env node
/**
 * scripts/ingest.js
 *
 * Fetches trending/popular tracks from Audius, extracts metadata,
 * generates text embeddings, and upserts them into the turbopuffer
 * namespace so the demo has real searchable data.
 *
 * Usage:
 *   TURBOPUFFER_API_KEY=<key> HF_API_TOKEN=<hf_token> node scripts/ingest.js
 *
 * Optional env:
 *   HF_API_TOKEN          — Hugging Face token for real embeddings (free tier)
 *   AUDIUS_API_KEY        — Audius API key (optional, works without)
 *   TURBOPUFFER_NAMESPACE — namespace to upsert into (default: versions-audio)
 *   INGEST_LIMIT          — max tracks to ingest (default: 50)
 */

require('dotenv').config();

const TURBOPUFFER_API_KEY = process.env.TURBOPUFFER_API_KEY;
const TURBOPUFFER_BASE_URL = process.env.TURBOPUFFER_BASE_URL || 'https://api.turbopuffer.com';
const NAMESPACE = process.env.TURBOPUFFER_NAMESPACE || 'versions-audio';
const HF_API_TOKEN = process.env.HF_API_TOKEN || '';
const AUDIUS_BASE = 'https://discoveryprovider.audius.co';
const LIMIT = parseInt(process.env.INGEST_LIMIT || '50', 10);
const EMBED_DIM = 384; // all-MiniLM-L6-v2

if (!TURBOPUFFER_API_KEY) {
  console.error('❌ TURBOPUFFER_API_KEY is required');
  process.exit(1);
}

/** Generate embeddings via HF Inference API, with hash fallback */
async function textToVector(text, dimensions = EMBED_DIM) {
  const input = (text || '').trim();
  if (!input) return new Array(dimensions).fill(0);

  if (HF_API_TOKEN) {
    try {
      const res = await fetch(
        'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${HF_API_TOKEN}`
          },
          body: JSON.stringify({ inputs: input })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const vec = Array.isArray(data[0]) ? data[0] : data;
        if (Array.isArray(vec) && vec.length === dimensions) return vec;
        console.warn(`  ⚠ HF embedding unexpected shape (${vec.length})`);
      } else {
        const errText = await res.text();
        console.warn(`  ⚠ HF API error (${res.status}): ${errText.slice(0, 100)}`);
      }
    } catch (err) {
      console.warn(`  ⚠ HF request failed: ${err.message}`);
    }
  }

  // Deterministic hash fallback
  const normalized = input.toLowerCase();
  const vector = new Float32Array(dimensions);
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    for (let d = 0; d < dimensions; d++) {
      vector[d] += Math.sin(code * (d + 1) * 0.01 + i * 0.1) * Math.cos((i + 1) * (d + 1) * 0.007);
    }
  }
  let norm = 0;
  for (let d = 0; d < dimensions; d++) norm += vector[d] * vector[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dimensions; d++) vector[d] /= norm;
  return Array.from(vector);
}

async function fetchAudiusTrending() {
  console.log(`📡 Fetching trending tracks from Audius (limit: ${LIMIT})…`);
  const url = `${AUDIUS_BASE}/v1/tracks/trending?limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audius API error: ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

function extractMetadata(track) {
  const title = track.title || 'Untitled';
  const artist = track.user?.name || 'Unknown';
  const genre = track.genre || '';
  const mood = track.mood || '';
  const description = (track.description || '').slice(0, 200);
  const tags = track.tags || '';

  // Build a rich text representation for embedding
  const textForEmbedding = [title, artist, genre, mood, description, tags]
    .filter(Boolean)
    .join(' ');

  return {
    id: String(track.id),
    title,
    artist,
    genre,
    mood,
    description,
    tags,
    artwork: track.artwork?.['480x480'] || track.artwork?.['150x150'] || '',
    textForEmbedding
  };
}

async function upsertBatch(upsertRows, schema) {
  const url = `${TURBOPUFFER_BASE_URL}/v2/namespaces/${encodeURIComponent(NAMESPACE)}`;
  const body = { upsert_rows: upsertRows };
  if (schema) body.schema = schema;
  
  // Default to cosine_distance for vector similarity
  if (upsertRows && upsertRows[0] && upsertRows[0].vector) {
    body.distance_metric = 'cosine_distance';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TURBOPUFFER_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turbopuffer upsert failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function main() {
  console.log('🚀 VERSIONS Ingestion Script');
  console.log(`   Namespace: ${NAMESPACE}`);
  console.log('');

  const tracks = await fetchAudiusTrending();
  console.log(`✅ Fetched ${tracks.length} tracks from Audius`);

  const metadataList = tracks.map(extractMetadata);

  // Generate embeddings and build rows for turbopuffer v2 API
  console.log(`🧠 Generating ${EMBED_DIM}-dim embeddings${HF_API_TOKEN ? ' via HF Inference API' : ' (hash fallback — set HF_API_TOKEN for real embeddings)'}…`);

  const rows = [];
  for (const meta of metadataList) {
    const vector = await textToVector(meta.textForEmbedding);
    rows.push({
      id: meta.id,
      vector,
      title: meta.title,
      artist: meta.artist,
      genre: meta.genre,
      mood: meta.mood,
      description: meta.description,
      tags: meta.tags,
      artwork: meta.artwork,
      search_text: meta.textForEmbedding
    });
  }

  // First batch includes schema to enable BM25 on search_text and ANN on vector
  const schema = {
    vector: { type: `[${EMBED_DIM}]f32`, ann: true },
    search_text: { type: 'string', bm25: true }
  };

  const BATCH_SIZE = 20;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`📤 Upserting batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} rows)…`);
    await upsertBatch(batch, i === 0 ? schema : undefined);
    upserted += batch.length;
  }

  console.log('');
  console.log(`✅ Done! Upserted ${upserted} tracks into turbopuffer namespace "${NAMESPACE}"`);
  console.log('');
  console.log('Sample tracks ingested:');
  metadataList.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i + 1}. "${m.title}" by ${m.artist} [${m.genre || 'no genre'}]`);
  });
}

main().catch(err => {
  console.error('❌ Ingestion failed:', err.message);
  process.exit(1);
});
