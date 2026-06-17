# VERSIONS — Demo Video Script

A 60–90 second walkthrough of the Lepton Submission
Marketplace. The script is shot-by-shot, with the on-screen
text + the narration written out so the recording is a
one-take. The framing assumes a single 1440×900 capture
of the full browser window with the cursor visible.

Before you hit record:

  1. `npm install && node proxy-server.js` in one tab.
  2. `PORT=8080 node scripts/seed-demo.js` to populate the feed.
  3. `PORT=8080 node scripts/seed-pending.js` to add an
     awaiting-curation row.
  4. Open `http://localhost:8080` in a 1440×900 window.
  5. Resize the browser window so the column widths match
     the design tokens (~720px main column).
  6. Press the `?` key in the bottom-left to start the
     tour, then close it. (Resets the cookie so the tour
     is auto-launched on first paint for the recording.)
  7. Optional: cap the mouse trail or hide the OS cursor
     before recording.

---

## Shot 1 — Hero (0:00 – 0:05)

**On screen:** the Submit form, scrolled to the top.

**Voice:** *"Versions is a marketplace for alternate takes of
songs. A demo, a live recording, the cut your label told
you to bury — and the taste graph that lets curators rate
it on what actually changed."*

**Cursor:** idle.

---

## Shot 2 — Tour auto-launches (0:05 – 0:12)

**On screen:** the Step 1 of 3 tour overlay. The dim is on
the Submit tab; the arrow points at the form.

**Voice:** *"First time on the site, a three-step tour
walks through the mechanic. Step one: this is where you
submit a version."*

**Cursor:** hovers the "Next" button.

---

## Shot 3 — Submit form details (0:12 – 0:25)

**On screen:** the tour dismisses; the form is in focus.
The cursor scrolls to the MusicBrainz field, then the
dropzone, then the "Submit for 0.50 USDC" button.

**Voice:** *"You give it a title, the artist name, the
version type — demo, live, acoustic, remix. An optional
MusicBrainz ID if it's a known recording. Drop the audio
file. Hit submit."*

**Cursor:** scroll to the MBID field, then the dropzone,
then the submit button. No clicks.

---

## Shot 4 — Switch to Curate, tour auto-tabs (0:25 – 0:35)

**On screen:** the cursor clicks "Curate" on the tab bar;
the tour advances to Step 2; the curate view is in focus.

**Voice:** *"Step two: curate via the taste graph. When
you claim a submission, the radar loads with the
defaults — solo 5, vocal 5, same, locked."*

**Cursor:** click the Curate tab. Tour advances.

---

## Shot 5 — The radar in detail (0:35 – 0:50)

**On screen:** the cursor selects a queue item ("Tumbling
Dice (Acoustic Blues)"). The scorecard renders. The radar
is centered, the readout below shows the current values.

**Voice:** *"Four axes — solo intensity, vocal quality,
energy versus the studio version, tempo feel. Drag a
point along the axis, the polygon closes, the values
update live. Energy and tempo snap to lower/same/higher
and dragging/locked/rushing at submit time."*

**Cursor:** click the queue item. Then drag the SOLO
handle upward. Then drag the ENERGY handle downward. The
polygon + readout update with each move. End with a click
in the radar's center to reset.

---

## Shot 6 — Switch to Feed, tour auto-tabs (0:50 – 1:00)

**On screen:** the cursor clicks "Feed" on the tab bar;
the tour advances to Step 3; the feed renders with 4
published versions.

**Voice:** *"Step three: discover the feed. Three curators
have to rate a take before it publishes. When it does,
the taste graph you see on each row is the consensus of
the curators — not an average, the shape they collectively
drew."*

**Cursor:** click the Feed tab. Pause on a row.

---

## Shot 7 — The feed row (1:00 – 1:15)

**On screen:** the cursor hovers a feed row (e.g. "Rolling
in the Deep (Live at Brixton)" — the high-vocal radar
tilted right). The taste graph radar is visible on the
right. The custom audio player (play button + faux
waveform) is below the row.

**Voice:** *"Each row is a published version. The radar is
the aggregated taste graph. The audio player is on-brand
— no browser default, no SaaS player, a play button and a
24-bar faux waveform. Mood tags, ratings, energy and
tempo consensus — the metadata curators actually use to
decide what to listen to next."*

**Cursor:** hover the row. Click play. Pause.

---

## Shot 8 — Artist dashboard (1:15 – 1:30)

**On screen:** the cursor switches to the Submit tab
(where the artist dashboard lives for the connected
wallet). The dashboard renders. Then the Earnings card
below it.

**Voice:** *"If you're the artist, the same view shows your
versions — pending, in curation, published — and the
earnings card. The 0.50 USDC submission fee splits 70/20/10
between the curators, the platform, and your own
attribution. Your earnings card shows exactly where the
money went."*

**Cursor:** click Submit. Wait. Scroll to the Earnings
card.

---

## Shot 9 — End card (1:30 – 1:40)

**On screen:** the URL bar (or a final card with the
GitHub URL + the live URL).

**Voice:** *"Versions. A Lepton Submission Marketplace.
Source on GitHub. The full walkthrough is in the repo's
docs/DEMO_WALKTHROUGH.md."*

**Cursor:** idle.

---

## Recording tips

- **Single take.** The script is written to flow; record
  the whole thing in one pass. Edit later only if you have
  to.
- **Cursor speed.** A 5-second "and the radar loads" line
  needs a 3-4 second action on screen. Rehearse the cursor
  motion a few times before recording.
- **Audio.** A USB mic at 12-18 inches, gain just under
  the clipping point. No reverb, no music. The narration
  is the audio bed.
- **Mouse acceleration off.** macOS: System Settings →
  Accessibility → Pointer Control → Mouse Pointer → Disable
  "Accelerate when mouse moves slowly". This makes the
  cursor motion predictable for the drag demo.
- **Browser zoom.** Set the browser zoom to 100%. Don't
  use browser zoom to make the design fit; the design
  tokens assume 100%.
- **Window manager.** Use a window manager (Rectangle,
  Magnet, Spectacle) to snap the browser to 1440×900 with
  no chrome at the top. macOS: enable "Show all windows
  in the Mission Control" off, hide the dock.
- **Audio levels.** Audacity or QuickTime Player to monitor
  input during recording. Aim for peaks around -12dB,
  never above -6dB.
- **Final cut.** A simple editor (iMovie, DaVinci Resolve)
  is enough. Cut the dead space, add a 1-second fade-in
  on the first shot and a 1-second fade-out on the last.

## Alt: 30-second version

If the submission is on a tight character budget, cut to
the 3-tour walkthrough (shots 2, 4, 6) and the radar demo
(shot 5). That's the heart of the product: the mechanic
in 3 frames + the radar in 1. End on the URL.

## File naming

`versions-demo-60s.mp4` (or `-30s.mp4` for the short
version). Upload to YouTube unlisted; submit the link
in the Lepton hackathon form.
