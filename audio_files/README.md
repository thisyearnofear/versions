# Audio Files Directory

This directory contains audio files for VERSIONS platform testing.

## Supported Formats
- **MP3** - MPEG Audio Layer III
- **FLAC** - Free Lossless Audio Codec
- **WAV** - Waveform Audio File Format
- **M4A** - MPEG-4 Audio
- **OGG** - Ogg Vorbis
- **AIFF** - Audio Interchange File Format

## File Naming Convention
Files should be named with descriptive IDs:
- `bohemian-rhapsody-studio.mp3`
- `bohemian-rhapsody-live-wembley.flac`
- `stairway-to-heaven-acoustic.wav`

## Testing
Place audio files here to test the streaming functionality.
The audio service will automatically detect and serve them via the REST API.

## API Endpoints
- `GET /api/v1/audio/files` - List available files
- `GET /api/v1/audio/{file_id}/metadata` - Get file metadata
- `GET /api/v1/audio/{file_id}/stream` - Stream audio file
- `POST /api/v1/audio/upload` - Upload new audio file