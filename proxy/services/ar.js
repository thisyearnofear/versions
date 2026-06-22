// MODULAR: A&R agent service. Autonomous playlist curation +
// agent-to-agent economics. The A&R agent browses the published
// feed, builds playlists, charges listeners per recommendation,
// and pays artists per play.
// DRY: play events go through ar_play_events. Settlement reuses
//      the existing arc adapter for both legs.
// CLEAN: the A&R agent is a single service. Playlist generation,
//        play recording, and payment are three methods on one object.
// ENHANCEMENT FIRST: reuses the feed service for track data and
//                    the settlement service for Arc payments.

'use strict';

const crypto = require('crypto');

const { openDb } = require('../db');

const LISTENER_FEE_USDC = '0.001';
const ARTIST_PAYOUT_USDC = '0.0005';

const PLAYLIST_GENRES = ['rock', 'jazz', 'electronic', 'folk', 'hip-hop', 'classical', 'pop'];
const PLAYLIST_MOODS = ['bluesy', 'raw', 'euphoric', 'melancholic', 'aggressive', 'dreamy', 'groovy', 'intimate', 'cinematic', 'nostalgic'];

function mockPlaylistName(genre, mood) {
  const adjectives = {
    rock: ['Electric', 'Raw', 'Amplified', 'Heavy', 'Driving'],
    jazz: ['Smooth', 'Late Night', 'Improvised', 'Swinging', 'Cool'],
    electronic: ['Synthetic', 'Pulsing', 'Digital', 'Atmospheric', 'Glitch'],
    folk: ['Rooted', 'Acoustic', 'Earthy', 'Wandering', 'Intimate'],
    'hip-hop': ['Boom Bap', 'Lyrical', 'Underground', 'Trap', 'Lo-fi'],
    classical: ['Orchestral', 'Chamber', 'Solo', 'Baroque', 'Contemporary'],
    pop: ['Bright', 'Catchy', 'Polished', 'Anthemic', 'Dreamy']
  };
  const adj = (adjectives[genre] || adjectives.rock);
  const seed = crypto.createHash('md5').update(`${genre}:${mood}`).digest();
  return `${adj[seed[0] % adj.length]} ${mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Mix'} Sessions`;
}

function mockPlaylistDescription(genre, mood) {
  return `A curated selection of ${genre} tracks with a ${mood || 'varied'} feel. ` +
    `The A&R agent selected these from the published catalog based on taste-graph ` +
    `compatibility, production quality, and listener engagement patterns.`;
}

function createArService({ arc, settlement, arWallet }) {
  const db = openDb();

  const insertPlaylistStmt = db.prepare(`
    INSERT INTO ar_playlists (id, name, description, genre, mood, ar_wallet, track_count, updated_at)
    VALUES (@id, @name, @description, @genre, @mood, @ar_wallet, @track_count, @updated_at)
  `);

  const insertTrackStmt = db.prepare(`
    INSERT INTO ar_playlist_tracks (id, playlist_id, version_id, position)
    VALUES (@id, @playlist_id, @version_id, @position)
  `);

  const updateTrackCountStmt = db.prepare(`
    UPDATE ar_playlists SET track_count = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const insertPlayStmt = db.prepare(`
    INSERT INTO ar_play_events (
      id, playlist_id, version_id, listener_wallet, artist_wallet,
      listener_fee_usdc, artist_payout_usdc, status
    ) VALUES (
      @id, @playlist_id, @version_id, @listener_wallet, @artist_wallet,
      @listener_fee_usdc, @artist_payout_usdc, @status
    )
  `);

  const markPlaySettled = db.prepare(`
    UPDATE ar_play_events
    SET listener_tx_hash = ?, artist_tx_hash = ?, status = 'settled'
    WHERE id = ?
  `);

  const markPlayFailed = db.prepare(`
    UPDATE ar_play_events SET status = 'failed' WHERE id = ?
  `);

  function generatePlaylists() {
    const published = db.prepare('SELECT * FROM published_versions ORDER BY published_at DESC').all();
    if (published.length === 0) return [];

    const playlists = [];

    const byGenre = new Map();
    for (const v of published) {
      const sub = db.prepare('SELECT genre FROM submissions WHERE id = ?').get(v.submission_id);
      const genre = (sub && sub.genre) || 'other';
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      byGenre.get(genre).push(v);
    }

    for (const [genre, tracks] of byGenre) {
      const sorted = [...tracks].sort((a, b) => {
        const scoreA = (a.avg_solo_intensity || 0) + (a.avg_vocal_quality || 0);
        const scoreB = (b.avg_solo_intensity || 0) + (b.avg_vocal_quality || 0);
        return scoreB - scoreA;
      });

      const moods = new Map();
      for (const t of sorted) {
        const tags = JSON.parse(t.aggregated_mood_tags || '[]');
        for (const tag of tags) {
          moods.set(tag, (moods.get(tag) || 0) + 1);
        }
      }
      const topMood = moods.size > 0
        ? [...moods.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;

      const playlistId = crypto.randomUUID();
      const name = mockPlaylistName(genre, topMood);
      const description = mockPlaylistDescription(genre, topMood);

      insertPlaylistStmt.run({
        id: playlistId,
        name,
        description,
        genre,
        mood: topMood,
        ar_wallet: arWallet,
        track_count: 0,
        updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
      });

      const selected = sorted.slice(0, 10);
      selected.forEach((track, idx) => {
        insertTrackStmt.run({
          id: crypto.randomUUID(),
          playlist_id: playlistId,
          version_id: track.submission_id,
          position: idx + 1
        });
      });

      updateTrackCountStmt.run(selected.length, playlistId);

      playlists.push({
        id: playlistId,
        name,
        description,
        genre,
        mood: topMood,
        ar_wallet: arWallet,
        track_count: selected.length
      });
    }

    return playlists;
  }

  function listPlaylists() {
    const playlists = db.prepare('SELECT * FROM ar_playlists ORDER BY updated_at DESC').all();
    return playlists.map(p => ({
      ...p,
      tracks: db.prepare(`
        SELECT pt.position, pv.submission_id, pv.title, pv.artist_name,
               pv.artist_wallet, pv.version_type, pv.audio_path, pv.avg_solo_intensity,
               pv.avg_vocal_quality, pv.energy_consensus, pv.tempo_consensus,
               pv.aggregated_mood_tags, pv.published_at
        FROM ar_playlist_tracks pt
        JOIN published_versions pv ON pv.submission_id = pt.version_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position
      `).all(p.id)
    }));
  }

  function getPlaylist(playlistId) {
    const p = db.prepare('SELECT * FROM ar_playlists WHERE id = ?').get(playlistId);
    if (!p) return null;
    const tracks = db.prepare(`
      SELECT pt.position, pv.submission_id, pv.title, pv.artist_name,
             pv.version_type, pv.audio_path, pv.avg_solo_intensity,
             pv.avg_vocal_quality, pv.energy_consensus, pv.tempo_consensus,
             pv.aggregated_mood_tags, pv.published_at, pv.artist_wallet
      FROM ar_playlist_tracks pt
      JOIN published_versions pv ON pv.submission_id = pt.version_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `).all(playlistId);
    return { ...p, tracks };
  }

  async function recordPlay({ playlistId, versionId, listenerWallet }) {
    const playlist = db.prepare('SELECT * FROM ar_playlists WHERE id = ?').get(playlistId);
    if (!playlist) return { ok: false, error: 'Playlist not found' };

    const version = db.prepare('SELECT * FROM published_versions WHERE submission_id = ?').get(versionId);
    if (!version) return { ok: false, error: 'Version not found' };

    const playId = crypto.randomUUID();
    insertPlayStmt.run({
      id: playId,
      playlist_id: playlistId,
      version_id: versionId,
      listener_wallet: listenerWallet,
      artist_wallet: version.artist_wallet,
      listener_fee_usdc: LISTENER_FEE_USDC,
      artist_payout_usdc: ARTIST_PAYOUT_USDC,
      status: 'pending'
    });

    let listenerTx = null;
    let artistTx = null;

    try {
      const listenerResult = await arc.sendTransfer({
        from: listenerWallet,
        to: arWallet,
        amountUsdc: LISTENER_FEE_USDC
      });
      listenerTx = listenerResult.hash;
    } catch (err) {
      markPlayFailed.run(playId);
      return { ok: false, error: 'Listener payment failed: ' + err.message };
    }

    try {
      const artistResult = await arc.sendTransfer({
        from: arWallet,
        to: version.artist_wallet,
        amountUsdc: ARTIST_PAYOUT_USDC
      });
      artistTx = artistResult.hash;
    } catch (err) {
      markPlayFailed.run(playId);
      return { ok: false, error: 'Artist payment failed: ' + err.message };
    }

    markPlaySettled.run(listenerTx, artistTx, playId);

    return {
      ok: true,
      play: {
        id: playId,
        playlist_id: playlistId,
        version_id: versionId,
        listener_wallet: listenerWallet,
        artist_wallet: version.artist_wallet,
        listener_fee_usdc: LISTENER_FEE_USDC,
        artist_payout_usdc: ARTIST_PAYOUT_USDC,
        listener_tx_hash: listenerTx,
        artist_tx_hash: artistTx,
        status: 'settled'
      }
    };
  }

  function getPlaylistStats(playlistId) {
    const total = db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(SUM(CAST(listener_fee_usdc AS REAL)), 0) AS revenue,
             COALESCE(SUM(CAST(artist_payout_usdc AS REAL)), 0) AS paid_out
      FROM ar_play_events WHERE playlist_id = ? AND status = 'settled'
    `).get(playlistId);
    return {
      total_plays: total ? total.c : 0,
      total_revenue_usdc: total ? total.revenue : 0,
      total_paid_to_artists_usdc: total ? total.paid_out : 0,
      ar_margin_usdc: total ? total.revenue - total.paid_out : 0
    };
  }

  return {
    generatePlaylists,
    listPlaylists,
    getPlaylist,
    recordPlay,
    getPlaylistStats,
    listenerFee: LISTENER_FEE_USDC,
    artistPayout: ARTIST_PAYOUT_USDC
  };
}

module.exports = { createArService, LISTENER_FEE_USDC, ARTIST_PAYOUT_USDC };
