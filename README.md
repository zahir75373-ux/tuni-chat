# তুনির বন্ধু (tuni-chat)

Static PWA (no server, no build). Host on GitHub Pages. See `THIRD_PARTY.md` for licences.

- Chat: Gemini `generateContent` called from the browser (key typed in ⚙️ Settings, stored on the device only).
- Voice in: Web Speech `bn-BD`. Voice out: Piper `bn_BD-google-medium` in the browser (first run downloads ~110 MB, then cached for offline).
- Talking photo / cartoon: MediaPipe Face Landmarker + 2D canvas puppet.
- Emotions, poke reactions, bedtime mode, daily timer: all in the browser.
