const { requestJson } = require('../runtime/http');
const { getEnv } = require('../runtime/config');

function createElevenLabsAdapter({ apiKey, requestTimeoutMs }) {
  const baseUrl = getEnv('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io');
  const musicPath = getEnv('ELEVENLABS_MUSIC_PATH', '/v1/music/generate');
  const sfxPath = getEnv('ELEVENLABS_SFX_PATH', '/v1/sound-generation');

  return {
    async generate({ mode, prompt, durationSeconds }) {
      if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY not configured');
      }

      const endpointPath = mode === 'sfx' ? sfxPath : musicPath;

      return requestJson(`${baseUrl}${endpointPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        timeoutMs: requestTimeoutMs,
        body: JSON.stringify({
          prompt,
          duration_seconds: durationSeconds || 10
        })
      }, `ElevenLabs ${mode || 'music'} generation`);
    }
  };
}

module.exports = {
  createElevenLabsAdapter
};
