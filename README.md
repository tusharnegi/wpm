# WPM Reader

Guided reading at the speed you choose: paste text, pick a words-per-minute pace and a chunk size, and a highlight walks through it.

https://tusharnegi.github.io/wpm/

- **Guide** mode highlights words in the full text; **Flash** mode shows one chunk at a time, centred, with a focus letter.
- Optional pauses at commas, full stops and paragraph ends.
- Click any word or the progress bar to jump; drop a `.txt` file to load it.
- Text, position and settings are saved on the device. Installable, works offline, and accepts text shared to it (`?text=…`).

Keys: `Space` play/pause · `←` `→` speed (±10, Shift ±1) · `↑` `↓` chunk · `[` `]` sentence back/forward · `R` restart · `F` mode · `E` edit · `,` `.` text size.

No build step: plain `index.html`, `style.css` and `app.js`. Run locally with `python3 -m http.server`.
