const { requestJson } = require('../runtime/http');
const { getEnv } = require('../runtime/config');

function createTurbopufferAdapter({ apiKey, requestTimeoutMs }) {
  const baseUrl = getEnv('TURBOPUFFER_BASE_URL', 'https://api.turbopuffer.com');
  const searchPath = getEnv('TURBOPUFFER_SEARCH_PATH', '/v1/search');

  return {
    async semanticSearch({ query, topK = 5, namespace }) {
      if (!apiKey) {
        throw new Error('TURBOPUFFER_API_KEY not configured');
      }

      return requestJson(`${baseUrl}${searchPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        timeoutMs: requestTimeoutMs,
        body: JSON.stringify({
          query,
          top_k: topK,
          namespace: namespace || getEnv('TURBOPUFFER_NAMESPACE', 'versions-audio')
        })
      }, 'Turbopuffer semantic search');
    }
  };
}

module.exports = {
  createTurbopufferAdapter
};
