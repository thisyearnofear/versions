const { requestJson } = require('../runtime/http');
const { getEnv } = require('../runtime/config');

const EMBED_DIM = 384; // all-MiniLM-L6-v2

/**
 * Generate real text embeddings via Hugging Face Inference API.
 * Requires HF_API_TOKEN env var (free tier).
 * Falls back to a deterministic hash vector when HF is unavailable.
 */
async function textToVector(text, dimensions = EMBED_DIM) {
  const hfToken = getEnv('HF_API_TOKEN', '');
  const input = (text || '').trim();
  if (!input) return new Array(dimensions).fill(0);

  if (hfToken) {
    try {
      const res = await fetch(
        'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hfToken}`
          },
          body: JSON.stringify({ inputs: input })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const vec = Array.isArray(data[0]) ? data[0] : data;
        if (Array.isArray(vec) && vec.length === dimensions) return vec;
        console.warn(`HF embedding unexpected shape (${vec.length}), using fallback`);
      } else {
        const errText = await res.text();
        console.warn(`HF embedding API error (${res.status}): ${errText.slice(0, 120)}, using fallback`);
      }
    } catch (err) {
      console.warn(`HF embedding request failed: ${err.message}, using fallback`);
    }
  }

  return hashVector(input, dimensions);
}

/** Deterministic hash-based vector (fallback only) */
function hashVector(text, dimensions) {
  const normalized = text.toLowerCase();
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

function createTurbopufferAdapter({ apiKey, requestTimeoutMs }) {
  const baseUrl = getEnv('TURBOPUFFER_BASE_URL', 'https://api.turbopuffer.com');
  const defaultNamespace = getEnv('TURBOPUFFER_NAMESPACE', 'versions-audio');

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };
  }

  return {
    /** Upsert documents: POST /v2/namespaces/{namespace} (v2 API) */
    async upsert({ vectors, rows, namespace, schema, distanceMetric }) {
      if (!apiKey) throw new Error('TURBOPUFFER_API_KEY not configured');
      const ns = namespace || defaultNamespace;

      let upsertRows = rows;
      if (!upsertRows && vectors) {
        upsertRows = vectors.map(v => ({
          id: v.id,
          vector: v.vector,
          ...v.attributes
        }));
      }

      const body = { upsert_rows: upsertRows };
      if (schema) body.schema = schema;
      if (distanceMetric) body.distance_metric = distanceMetric;
      
      // Default to cosine_distance if it's not specified and we have vectors
      if (!body.distance_metric && (upsertRows && upsertRows[0] && upsertRows[0].vector)) {
        body.distance_metric = 'cosine_distance';
      }

      return requestJson(`${baseUrl}/v2/namespaces/${encodeURIComponent(ns)}`, {
        method: 'POST',
        headers: authHeaders(),
        timeoutMs: requestTimeoutMs,
        body: JSON.stringify(body)
      }, 'Turbopuffer upsert');
    },

    /** Query documents: POST /v2/namespaces/{namespace}/query (v2 API) */
    async query({ vector, topK = 5, namespace, includeAttributes, rankBy }) {
      if (!apiKey) throw new Error('TURBOPUFFER_API_KEY not configured');
      const ns = namespace || defaultNamespace;

      const rank = rankBy || ['vector', 'ANN', vector];
      const payload = {
        rank_by: rank,
        top_k: topK
      };
      if (Array.isArray(includeAttributes)) {
        payload.include_attributes = includeAttributes;
      }

      return requestJson(`${baseUrl}/v2/namespaces/${encodeURIComponent(ns)}/query`, {
        method: 'POST',
        headers: authHeaders(),
        timeoutMs: requestTimeoutMs,
        body: JSON.stringify(payload)
      }, 'Turbopuffer query');
    },

    /** BM25 full-text search (v2 query) */
    async textSearch({ query, field = 'search_text', topK = 5, namespace }) {
      if (!apiKey) throw new Error('TURBOPUFFER_API_KEY not configured');
      const ns = namespace || defaultNamespace;

      return requestJson(`${baseUrl}/v2/namespaces/${encodeURIComponent(ns)}/query`, {
        method: 'POST',
        headers: authHeaders(),
        timeoutMs: requestTimeoutMs,
        body: JSON.stringify({
          rank_by: [field, 'BM25', query],
          top_k: topK
        })
      }, 'Turbopuffer BM25 search');
    },

    /** Semantic search: embed query then ANN, with BM25 fallback */
    async semanticSearch({ query, topK = 5, namespace, includeAttributes }) {
      if (!apiKey) throw new Error('TURBOPUFFER_API_KEY not configured');
      const attrs = includeAttributes || ['title', 'artist', 'genre', 'mood', 'description', 'tags', 'artwork'];

      try {
        const vector = await textToVector(query);
        const results = await this.query({ vector, topK, namespace, includeAttributes: attrs });
        const rows = results.rows || results.vectors || results.data || results;
        if (Array.isArray(rows) && rows.length > 0) return rows;
      } catch (error) {
        console.warn('Vector search failed, trying BM25 fallback:', error.message);
      }

      try {
        const results = await this.textSearch({ query, topK, namespace });
        return results.rows || results.vectors || results.data || results || [];
      } catch (error) {
        if (error.message && (error.message.includes('404') || error.message.includes('not found') || error.message.includes('empty'))) {
          console.warn('Turbopuffer namespace empty or not found, returning empty results');
          return [];
        }
        throw error;
      }
    },

    /** Delete namespace: DELETE /v2/namespaces/{namespace} (v2 API) */
    async deleteNamespace({ namespace }) {
      if (!apiKey) throw new Error('TURBOPUFFER_API_KEY not configured');
      const ns = namespace || defaultNamespace;
      return requestJson(`${baseUrl}/v2/namespaces/${encodeURIComponent(ns)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        timeoutMs: requestTimeoutMs
      }, 'Turbopuffer delete namespace');
    },

    /** Get namespace metadata: GET /v1/namespaces/{namespace}/metadata (Legacy/Current) */
    async metadata({ namespace }) {
      if (!apiKey) throw new Error('TURBOPUFFER_API_KEY not configured');
      const ns = namespace || defaultNamespace;
      return requestJson(`${baseUrl}/v1/namespaces/${encodeURIComponent(ns)}/metadata`, {
        method: 'GET',
        headers: authHeaders(),
        timeoutMs: requestTimeoutMs
      }, 'Turbopuffer metadata');
    }
  };
}

module.exports = {
  createTurbopufferAdapter,
  textToVector,
  EMBED_DIM
};
