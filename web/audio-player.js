// MODULAR: Audio player module for VERSIONS
// CLEAN: Separate audio logic from main app

import { appConfig } from './config.js';

class AudioPlayer {
    constructor() {
        this.audio = null;
        this.currentTrack = null;
        this.isPlaying = false;
        this.volume = 0.7;
        this.currentTime = 0;
        this.duration = 0;
        // PERFORMANT: Cache for audio metadata
        this.metadataCache = new Map();
    }

    // CLEAN: Initialize audio player
    init() {
        this.createPlayerUI();
        this.bindEvents();
    }

    // MODULAR: Create player UI elements
    createPlayerUI() {
        const playerHTML = `
            <div id="audio-player" style="
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px;
                box-shadow: 0 -2px 10px rgba(0,0,0,0.3);
                display: none;
                z-index: 1000;
            ">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div id="track-info" style="flex: 1; min-width: 0;">
                        <div id="track-title" style="font-weight: bold; font-size: 14px; margin-bottom: 2px;">No track loaded</div>
                        <div id="track-artist" style="font-size: 12px; opacity: 0.8;">Select a track to play</div>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button id="play-pause-btn" style="
                            background: rgba(255,255,255,0.2);
                            border: none;
                            color: white;
                            padding: 8px 12px;
                            border-radius: 20px;
                            cursor: pointer;
                            font-size: 16px;
                        ">⏸️</button>
                        
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span style="font-size: 12px;">🔊</span>
                            <input id="volume-slider" type="range" min="0" max="100" value="70" style="width: 80px;">
                        </div>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 5px;">
                        <div style="display: flex; gap: 10px; font-size: 11px;">
                            <span id="current-time">0:00</span>
                            <span>/</span>
                            <span id="total-time">0:00</span>
                        </div>
                        <input id="progress-slider" type="range" min="0" max="100" value="0" style="width: 150px;">
                    </div>
                    
                    <button id="close-player-btn" style="
                        background: none;
                        border: none;
                        color: white;
                        cursor: pointer;
                        font-size: 16px;
                        opacity: 0.7;
                    ">✕</button>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', playerHTML);
    }

    // CLEAN: Bind event handlers
    bindEvents() {
        const playPauseBtn = document.getElementById('play-pause-btn');
        const volumeSlider = document.getElementById('volume-slider');
        const progressSlider = document.getElementById('progress-slider');
        const closeBtn = document.getElementById('close-player-btn');

        if (playPauseBtn) playPauseBtn.onclick = () => this.togglePlayPause();
        if (volumeSlider) volumeSlider.oninput = (e) => this.setVolume(e.target.value / 100);
        if (progressSlider) progressSlider.oninput = (e) => this.seek(e.target.value / 100);
        if (closeBtn) closeBtn.onclick = () => this.close();
    }

    // ENHANCEMENT: Load and play audio track
    async loadTrack(fileId, metadata = null) {
        try {
            // PERFORMANT: Get metadata if not provided
            if (!metadata) {
                metadata = await this.getAudioMetadata(fileId);
            }

            // CLEAN: Create new audio element
            if (this.audio) {
                this.audio.pause();
                this.audio = null;
            }

            const streamUrl = `${appConfig.apiBase}/api/v1/audio/${fileId}/stream`;
            this.audio = new Audio(streamUrl);
            this.currentTrack = { fileId, metadata };

            // MODULAR: Set up audio event listeners
            this.setupAudioEvents();

            // CLEAN: Update UI
            this.updateTrackInfo(metadata);
            this.showPlayer();

            console.log(`🎵 Loaded track: ${metadata.title || fileId}`);
            
        } catch (error) {
            console.error('Failed to load track:', error);
            alert('Failed to load audio track. Please try again.');
        }
    }

    // MODULAR: Setup audio element event listeners
    setupAudioEvents() {
        if (!this.audio) return;

        this.audio.addEventListener('loadedmetadata', () => {
            this.duration = this.audio.duration;
            this.updateTimeDisplay();
        });

        this.audio.addEventListener('timeupdate', () => {
            this.currentTime = this.audio.currentTime;
            this.updateTimeDisplay();
            this.updateProgressBar();
        });

        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            this.updatePlayPauseButton();
        });

        this.audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            alert('Audio playback failed. Please check the file format.');
        });

        // PERFORMANT: Set initial volume
        this.audio.volume = this.volume;
    }

    // CLEAN: Update track information display
    updateTrackInfo(metadata) {
        const titleEl = document.getElementById('track-title');
        const artistEl = document.getElementById('track-artist');

        if (titleEl) titleEl.textContent = metadata.title || 'Unknown Title';
        if (artistEl) artistEl.textContent = metadata.artist || 'Unknown Artist';
    }

    // MODULAR: Toggle play/pause
    togglePlayPause() {
        if (!this.audio) return;

        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    // CLEAN: Play audio
    async play() {
        if (!this.audio) return;

        try {
            await this.audio.play();
            this.isPlaying = true;
            this.updatePlayPauseButton();
        } catch (error) {
            console.error('Playback failed:', error);
            alert('Playback failed. Please try again.');
        }
    }

    // CLEAN: Pause audio
    pause() {
        if (!this.audio) return;

        this.audio.pause();
        this.isPlaying = false;
        this.updatePlayPauseButton();
    }

    // MODULAR: Set volume
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.audio) {
            this.audio.volume = this.volume;
        }
    }

    // MODULAR: Seek to position
    seek(position) {
        if (!this.audio || !this.duration) return;

        const time = position * this.duration;
        this.audio.currentTime = time;
    }

    // PERFORMANT: Get audio metadata with caching
    async getAudioMetadata(fileId) {
        if (this.metadataCache.has(fileId)) {
            return this.metadataCache.get(fileId);
        }

        try {
            const response = await fetch(`${appConfig.apiBase}/api/v1/audio/${fileId}/metadata`);
            const data = await response.json();
            
            if (data.success) {
                this.metadataCache.set(fileId, data.data);
                return data.data;
            } else {
                throw new Error(data.error || 'Failed to get metadata');
            }
        } catch (error) {
            console.error('Failed to get audio metadata:', error);
            return {
                title: fileId,
                artist: 'Unknown',
                duration_seconds: null
            };
        }
    }

    // CLEAN: Update UI elements
    updatePlayPauseButton() {
        const btn = document.getElementById('play-pause-btn');
        if (btn) {
            btn.textContent = this.isPlaying ? '⏸️' : '▶️';
        }
    }

    updateTimeDisplay() {
        const currentEl = document.getElementById('current-time');
        const totalEl = document.getElementById('total-time');

        if (currentEl) currentEl.textContent = this.formatTime(this.currentTime);
        if (totalEl) totalEl.textContent = this.formatTime(this.duration);
    }

    updateProgressBar() {
        const progressSlider = document.getElementById('progress-slider');
        if (progressSlider && this.duration > 0) {
            const progress = (this.currentTime / this.duration) * 100;
            progressSlider.value = progress;
        }
    }

    // CLEAN: Format time for display
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // MODULAR: Show player
    showPlayer() {
        const player = document.getElementById('audio-player');
        if (player) {
            player.style.display = 'block';
        }
    }

    // MODULAR: Close player
    close() {
        if (this.audio) {
            this.audio.pause();
            this.audio = null;
        }
        
        const player = document.getElementById('audio-player');
        if (player) {
            player.style.display = 'none';
        }
        
        this.currentTrack = null;
        this.isPlaying = false;
    }

    // CLEAN: Get current track info
    getCurrentTrack() {
        return this.currentTrack;
    }

    // CLEAN: Check if playing
    getIsPlaying() {
        return this.isPlaying;
    }
}

// MODULAR: Export singleton instance
export const audioPlayer = new AudioPlayer();