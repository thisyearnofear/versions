const { requestJson } = require('../runtime/http');

function createAudiusAdapter({ apiKey, requestTimeoutMs }) {
  function ensureConfigured() {
    if (!apiKey) {
      throw new Error('AUDIUS_API_KEY not configured');
    }
  }

  function apiPath(path) {
    return `https://api.audius.co/v1${path}${path.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  }

  return {
    async getCoins(limit = 100) {
      ensureConfigured();
      return requestJson(apiPath(`/coins?limit=${limit}`), { timeoutMs: requestTimeoutMs }, 'Audius coins');
    },
    async resolve(url) {
      ensureConfigured();
      return requestJson(apiPath(`/resolve?url=${encodeURIComponent(url)}`), { timeoutMs: requestTimeoutMs }, 'Audius resolve');
    },
    async getTrending() {
      ensureConfigured();
      return requestJson(apiPath('/tracks/trending'), { timeoutMs: requestTimeoutMs }, 'Audius trending');
    },
    async getUserCoins(userId) {
      ensureConfigured();
      return requestJson(apiPath(`/users/${userId}/coins`), { timeoutMs: requestTimeoutMs }, 'Audius user coins');
    },
    async searchTracks(query, limit) {
      ensureConfigured();
      const searchLimit = limit ? `&limit=${encodeURIComponent(limit)}` : '';
      return requestJson(apiPath(`/tracks/search?query=${encodeURIComponent(query)}${searchLimit}`), { timeoutMs: requestTimeoutMs }, 'Audius search');
    },
    async getTrack(trackId) {
      ensureConfigured();
      return requestJson(apiPath(`/tracks/${trackId}`), { timeoutMs: requestTimeoutMs }, 'Audius track');
    },
    async getTrackAccessInfo(trackId) {
      ensureConfigured();
      return requestJson(apiPath(`/tracks/${trackId}/access-info`), { timeoutMs: requestTimeoutMs }, 'Audius access info');
    },
    async getArtistTracks(userId) {
      ensureConfigured();
      return requestJson(apiPath(`/users/${userId}/tracks`), { timeoutMs: requestTimeoutMs }, 'Artist tracks');
    },
    async getArtist(userId) {
      ensureConfigured();
      return requestJson(apiPath(`/users/${userId}`), { timeoutMs: requestTimeoutMs }, 'Artist info');
    },
    async streamTrack(trackId) {
      ensureConfigured();
      const streamUrl = `https://discoveryprovider.audius.co/v1/tracks/${trackId}/stream?api_key=${apiKey}`;
      const response = await fetch(streamUrl);
      if (!response.ok) {
        throw new Error(`Audius stream failed (${response.status})`);
      }
      return response;
    }
  };
}

module.exports = {
  createAudiusAdapter
};
