# Demo Script — VERSIONS × turbopuffer × ElevenLabs

**Project**: VERSIONS — Semantic music search → AI-generated versions  
**Hackathon**: #ElevenHacks (turbopuffer + ElevenLabs track)  
**Demo URL**: http://localhost:3000

---

## 🎬 Demo Script (60–90 seconds)

### Opening (0–10s)
> "VERSIONS uses turbopuffer to semantically index thousands of song versions and lets you describe what you're looking for in natural language."

**Action:** Show the landing page with the Audio Lab hero section visible.

### The Wow Moment (10–40s)

1. **Type a vibe description** in the Audio Lab prompt:
   - `dreamy lo-fi piano with rain sounds`
   - Alt: `upbeat funk bass groove at 120 BPM`
   - Alt: `ethereal ambient pads with choir`

2. **Click "✨ Compose"** — show the waveform animation pulsing.

3. **Results appear:**
   - Point out the semantic match cards with relevance scores.
   - "turbopuffer found these 5 tracks that match the vibe."

4. **Play the generated audio** — the inline player shows the AI-generated track.
   - "ElevenLabs generated a brand new track inspired by these matches."

### Track Detail Flow (40–60s)

5. **Click a track card** in the grid below.
   - Show the expanded detail view with existing versions.

6. **Click "Generate Missing Version"** (e.g., "acoustic demo").
   - Show how it pre-fills the Audio Lab and runs compose automatically.
   - "When a version doesn't exist yet, ElevenLabs generates it."

### Closing (60–75s)
> "VERSIONS turns vector search into a creative tool for music discovery and generation. Built with turbopuffer for semantic search and ElevenLabs for AI audio."

**Action:** Show the footer with turbopuffer + ElevenLabs branding.

---

## 🎤 Sample Prompts

| Prompt | Expected Vibe |
|--------|---------------|
| `dreamy synthwave rain at 110 BPM` | Retro electronic, atmospheric |
| `lo-fi jazz piano with vinyl crackle` | Chill, warm, nostalgic |
| `epic orchestral trailer music` | Cinematic, dramatic |
| `chill acoustic guitar sunset vibes` | Relaxed, organic |
| `dark ambient drone with thunder` | Moody, atmospheric |
| `funky disco bass groove 120 BPM` | Upbeat, groovy |
| `ethereal choir pads with reverb` | Spacious, spiritual |

---

## 🔧 Pre-Demo Checklist

- [ ] Ingest tracks: `TURBOPUFFER_API_KEY=<key> node scripts/ingest.js`
- [ ] Backend running: `TURBOPUFFER_API_KEY=<key> ELEVENLABS_API_KEY=<key> node proxy-server.js`
- [ ] Frontend running: `cd web && python3 -m http.server 3000`
- [ ] Browser open to http://localhost:3000
- [ ] Audio Lab shows "turbopuffer: ready" and "elevenlabs: ready"
- [ ] Track grid loads with Audius tracks
- [ ] Test one compose flow end-to-end before recording
- [ ] Close unnecessary browser tabs
- [ ] Mute system notifications
- [ ] Test audio output (generated audio should be audible)

---

## 🎥 Recording Tips

1. **Resolution**: 1080p or higher
2. **Browser zoom**: 100% (or 110% for readability)
3. **Dark mode**: Default — looks best on camera
4. **Length**: Under 90 seconds (judges are busy)
5. **Flow**: prompt → search → generate → play (show the full pipeline)
6. **Mention**: turbopuffer and ElevenLabs by name
7. **End**: Landing page visible with branding

---

## 📣 Posting Checklist

- [ ] Tag **@turbopuffer** and **@elevenlabsio**
- [ ] Use hashtag **#ElevenHacks**
- [ ] Post on X (+50 pts)
- [ ] Post on LinkedIn (+50 pts)
- [ ] Post on Instagram (+50 pts)
- [ ] Post on TikTok (+50 pts)
- [ ] Include a link to the GitHub repo
- [ ] Pin the video post for visibility

---

## 🚀 Demo URLs

- **Frontend**: http://localhost:3000
- **Backend Health**: http://localhost:8080/api/v1/health
- **Providers**: http://localhost:8080/api/v1/providers

Good luck! 🎵✨
