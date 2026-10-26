# Third-party files / লাইসেন্স

| What | Where | Licence |
|---|---|---|
| Piper voice `bn_BD-google-medium` (VITS, 16 speakers) | `model/` (4 parts) | Model from rhasspy/piper-voices. Training data: Google Bengali multi-speaker TTS data, CC BY-SA 4.0 – credit Google, share-alike. |
| Piper (idea/ONNX export) | – | MIT |
| onnxruntime-web 1.30.0 | `vendor/ort/` | MIT |
| piper-phonemize (WASM) incl. espeak-ng | `vendor/piper/` | espeak-ng is GPL-3.0 (compiled into the .wasm), CMU dictionary data BSD-like. Source: github.com/rhasspy/piper-phonemize, github.com/espeak-ng/espeak-ng |
| MediaPipe Tasks Vision + Face Landmarker | `vendor/mediapipe/` | Apache-2.0 |
| Everything else (app code, cartoon faces drawn in code, icons) | root | Written for this project |

Because espeak-ng (GPL-3.0) is inside the WASM, if you share this app publicly keep the repository public with these notes.
