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

## Configuration (all optional)
| Env var | |
|---|---|
| `PEXELS_API_KEY` | free at pexels.com/api, the best footage |
| `PIXABAY_API_KEY` | free at pixabay.com/api/docs |
| `SHORTS_BGM_DIR` | a folder of royalty-free music; a random track is mixed in at 15% volume |
| `SHORTS_OUTPUT_DIR` | default `~/Videos/shorts-studio` |
| `FFMPEG_PATH` | a custom ffmpeg binary |
| `SHORTS_FONTS_DIR` | extra fonts for subtitles |

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
npm test          # 16 tests (the online ones skip without network)
npm run build     # bundles plugin/server.mjs
```

## Credits
The pipeline design is inspired by [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT), rewritten from scratch in Node.js as an MCP server so it runs inside Claude. Respect each footage licence; `credits.txt` lists them for you.

## Need it customised?
Branded templates, auto-posting, a hosted API, or a white-label version for your agency: open an issue or contact [Aly Cheaib](https://github.com/alycheaib).

MIT © Aly Cheaib
