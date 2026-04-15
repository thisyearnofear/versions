const { getEnv } = require('../runtime/config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_DIR = path.resolve(__dirname, '../../audio_files/generated');

function createElevenLabsAdapter({ apiKey, requestTimeoutMs }) {
  const baseUrl = getEnv('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io');
  const musicPath = getEnv('ELEVENLABS_MUSIC_PATH', '/v1/music/generate');
  const sfxPath = getEnv('ELEVENLABS_SFX_PATH', '/v1/sound-generation');

  // Ensure output directory exists
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  return {
    /**
     * Generate audio via ElevenLabs.
     * The Music API and SFX API return binary audio (not JSON),
     * so we fetch the raw response, save to disk, and return a playable URL.
     */
    async generate({ mode, prompt, durationSeconds }) {
      if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY not configured');
      }

      const endpointPath = mode === 'sfx' ? sfxPath : musicPath;
      const url = `${baseUrl}${endpointPath}`;

      const controller = new AbortController();
      const timer = requestTimeoutMs > 0
        ? setTimeout(() => controller.abort(), requestTimeoutMs)
        : null;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey
          },
          signal: controller.signal,
          body: JSON.stringify({
            prompt,
            duration_seconds: durationSeconds || 10
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ElevenLabs ${mode || 'music'} generation failed (${response.status}): ${errorText.slice(0, 220)}`);
        }

        // Response is binary audio data
        const contentType = response.headers.get('content-type') || 'audio/mpeg';
        const buffer = Buffer.from(await response.arrayBuffer());

        // Save to disk with unique filename
        const hash = crypto.createHash('md5').update(prompt + mode + durationSeconds).digest('hex').slice(0, 12);
        const ext = contentType.includes('wav') ? 'wav' : contentType.includes('ogg') ? 'ogg' : 'mp3';
        const filename = `${mode}_${hash}_${Date.now()}.${ext}`;
        const filepath = path.join(AUDIO_DIR, filename);
        fs.writeFileSync(filepath, buffer);

        return {
          audio_url: `/api/v1/audio/files/${filename}`,
          filename,
          content_type: contentType,
          size_bytes: buffer.length,
          prompt,
          mode,
          duration_seconds: durationSeconds || 10
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
}

module.exports = {
  createElevenLabsAdapter,
  AUDIO_DIR
};
