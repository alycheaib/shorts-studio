# 🎬 shorts-studio: MoneyPrinterTurbo-style short videos inside Claude

**Type a topic and get a finished vertical video:** a script written by Claude, a natural neural voice-over, matching stock footage, word-by-word highlighted subtitles and a 1080×1920 MP4 ready for **YouTube Shorts, TikTok and Instagram Reels**.

```
/shorts-studio:make why honey never spoils
```

![shorts-studio demo: /shorts-studio:make why honey never spoils](docs/demo.gif)

<sub>Real output: one command, one finished 1080×1920 video. [More frames](docs/preview.png)</sub>

- **No LLM API key.** Claude *is* the scriptwriter, so there's no OpenAI or DeepSeek bill.
- **Free voice-over:** Microsoft Edge neural voices (300+ voices, 70+ languages, including Arabic), with word-level timing.
- **Footage:** Pexels or Pixabay (free keys), or **Wikimedia Commons with no key at all**. Falls back to Ken Burns zoom on photos. Letterbox bars are auto-cropped.
- **Viral-style subtitles:** current-word highlight or classic lines; bottom, center or top; any colour, font or size; RTL-safe.
- **Your own media:** your clips, images, voice recording and background music.
- **Credits file:** every clip's author, licence and source link, ready to paste into the description.
- **Formats:** portrait 9:16, landscape 16:9 or square 1:1.
- **Tested:** 16 automated tests (unit, offline render, live TTS and live footage), Windows, macOS and Linux.

## Install (Claude Code)
```bash
claude plugin marketplace add alycheaib/shorts-studio
claude plugin install shorts-studio@shorts-studio
```
You also need **ffmpeg**: `winget install Gyan.FFmpeg`, `brew install ffmpeg` or `apt install ffmpeg`. Or set `FFMPEG_PATH`.

Then, in Claude Code:
| Command | What it does |
|---|---|
| `/shorts-studio:make <topic> [language] [aspect] [~seconds]` | One finished video, plus a title, description and hashtags |
| `/shorts-studio:batch <niche> [count]` | A series of videos and a posting plan |

Videos are saved to `~/Videos/shorts-studio/<date>-<title>/`: `video.mp4`, `voice.mp3`, `subtitles.srt`, `script.txt`, `credits.txt`.

### Any MCP client (Claude Desktop, Cursor, …)
```json
{ "mcpServers": { "shorts-studio": { "command": "npx", "args": ["-y", "github:alycheaib/shorts-studio"] } } }
```

## Tools
| Tool | |
|---|---|
| `make_short_video` | script and search terms → MP4 (voice, footage, subtitles, music) |
| `generate_voiceover` | text → MP3 and word-timed SRT |
| `list_voices` | browse the Edge neural voices by language and gender |
| `search_footage` | preview stock clips with author and licence |
| `doctor` | check ffmpeg, providers and folders |
| `license_status` / `activate_license` | check or activate Pro |
| `make_short_videos` | **Pro**: batch-render up to 20 videos with shared defaults |

## ⭐ Pro
Everything above is free forever, with **no watermark**. Pro is for creators and agencies who post every day under a brand:

| Pro option | What you get |
|---|---|
| `brand` | your logo on every frame (position, size, opacity), brand colour, custom font file, "Follow @handle" end card |
| `hook_title` | a big title card for the first 3 seconds to stop the scroll |
| `caption_preset` | `pop` (active word grows), `neon` (glow), `bold-box`, `minimal` |
| `progress_bar` | an animated watch-progress bar in your colour |
| `extra_aspects` | one request → 9:16 **and** 1:1 / 16:9 from the same cut |
| `thumbnail` | `cover.jpg` for each format |
| `make_short_videos` | a week of content in one command |

Ask Claude: *"Make 5 shorts about saving money, with my logo C:\brand\logo.png, colour #00C853, handle @mybrand, hook titles, pop captions, progress bar, in portrait and square."*

| Plan | Price | |
|---|---|---|
| **Pro** | **$29 one-time** | 1 person, all Pro options, free updates for v0.x |
| **Agency** | **$99 one-time** | up to 5 seats, priority feature requests |

<!-- checkout:start -->
**Get it with USDT (instant, worldwide):**

| | |
|---|---|
| Network | **TRON (TRC20)** only. Other networks lose the funds |
| Address | `TQNuYTDhRAFN4Tr88hzyGBKBxXyjHEY1rL` |
| Amount | **29 USDT** Pro · **99 USDT** Agency |

<img src="docs/usdt-trc20.png" width="180" alt="USDT TRC20 QR code">

1. Send the amount from any wallet or exchange (Binance, OKX, Bybit, Trust Wallet…). If the exchange deducts a fee, add it so ≥ 28 USDT arrives. Sending from Binance? Choose the TRC20 network withdrawal (not "internal transfer"/Binance Pay) so there is an on-chain hash.
2. Email **aly.cheaib@gmail.com** with the subject **shorts-studio key**: paste the **transaction hash** and the name for the license.
3. Your key is emailed back **automatically**, usually within 2 hours, once the payment is confirmed on-chain.
4. Tell Claude *"activate my shorts-studio license SS1.…"*, or set `SHORTS_STUDIO_LICENSE`.

Lebanon: you can also pay by Whish. Email first and you'll get the details.
<!-- checkout:end -->
Keys are verified **offline** (Ed25519 signature): no account, no server and no tracking. Your videos never leave your machine.

## Configuration (all optional)
| Env var | |
|---|---|
| `PEXELS_API_KEY` | free at pexels.com/api, the best footage |
| `PIXABAY_API_KEY` | free at pixabay.com/api/docs |
| `SHORTS_BGM_DIR` | a folder of royalty-free music; a random track is mixed in at 15% volume |
| `SHORTS_OUTPUT_DIR` | default `~/Videos/shorts-studio` |
| `FFMPEG_PATH` | a custom ffmpeg binary |
| `SHORTS_FONTS_DIR` | extra fonts for subtitles |
| `SHORTS_STUDIO_LICENSE` | Pro license key (or use `activate_license`) |

## How it works
```
topic ──► Claude writes hook-first script + English search terms
        ──► Edge TTS (word boundaries) ──► captions (SRT + styled ASS)
        ──► Pexels / Pixabay / Wikimedia search ──► download + validate + cache
        ──► ffmpeg: cut 4 s segments, auto-crop, fill 9:16, concat
        ──► mix voice (+ music), burn subtitles ──► MP4 (H.264/AAC, faststart)
```

## Develop
```bash
npm install
npm test          # 21 tests (the online ones skip without network)
npm run build     # bundles plugin/server.mjs
```

## Credits
The pipeline design is inspired by [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT), rewritten from scratch in Node.js as an MCP server so it runs inside Claude. Respect each footage licence; `credits.txt` lists them for you.

## Need it customised?
Branded templates, auto-posting, a hosted API, or a white-label version for your agency: open an issue or contact [Aly Cheaib](https://github.com/alycheaib).

MIT © Aly Cheaib
