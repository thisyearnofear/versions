// MODULAR: MusicBrainz metadata adapter.
// DRY: TTL-caches every response; reuses runtime/cache.js.
// ENHANCEMENT FIRST: wallet resolution delegates to the existing audius.js
//                    adapter when supplied.
// PERFORMANT: cache + User-Agent header (required by MusicBrainz policy).

'use strict';

const { requestJson } = require('../runtime/http');
const { createTtlCache } = require('../runtime/cache');

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_UA = 'VERSIONS-Lepton-Marketplace/0.1 ( contact@versions.thisyearnofear.com )';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MBID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createMusicBrainzAdapter({ requestTimeoutMs = 8000, audius = null } = {}) {
  const cache = createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: 500 });

  async function fetchCached(path) {
    const cached = cache.get(path);
    if (cached) return cached;
    const data = await requestJson(
      `${MB_BASE}${path}`,
      {
        headers: { 'User-Agent': MB_UA, 'Accept': 'application/json' },
        timeoutMs: requestTimeoutMs
      },
      'MusicBrainz'
    );
    cache.set(path, data);
    return data;
  }

  function isValidMbid(mbid) {
    return typeof mbid === 'string' && MBID_REGEX.test(mbid);
  }

  return {
    isValidMbid,

    async getRecording(mbid) {
      if (!isValidMbid(mbid)) {
        throw new Error('Invalid MBID');
      }
      return fetchCached(`/recording/${mbid}?inc=artist-credits&fmt=json`);
    },

    async getArtist(mbid) {
      if (!isValidMbid(mbid)) {
        throw new Error('Invalid MBID');
      }
      return fetchCached(`/artist/${mbid}?fmt=json`);
    },

    /**
     * Resolve a (mbid, artistName) to a wallet address.
     *
     * For Day 3 this returns null: the MBID→wallet mapping is not exposed
     * by Audius's public API, and the Day 3 scope is the schema + flow.
     * Day 5's web client will use the artist's connected wallet directly
     * (preferred) and fall back to the audius search-by-name lookup if a
     * third-party submission references an MBID.
     */
    async resolveArtistWallet({ mbid, artistName } = {}) {
      if (!audius) return null;
      if (!artistName) return null;
      try {
        const search = await audius.searchTracks(artistName, 5);
        const userMatch = (search && search.data || []).find(
          (t) => t.user && t.user.name && t.user.name.toLowerCase() === artistName.toLowerCase()
        );
        if (!userMatch) return null;
        // Audius user_id is not a Solana wallet. The artist must link their
        // wallet via the web client (Day 5) for settlement to route to them.
        return null;
      } catch (err) {
        console.warn(`[musicbrainz] resolveArtistWallet failed: ${err.message}`);
        return null;
      }
    }
  };
}

module.exports = { createMusicBrainzAdapter };
