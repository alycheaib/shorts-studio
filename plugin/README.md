# shorts-studio (Claude Code plugin)

`/shorts-studio:make <topic>` → Claude writes the script, then the bundled MCP server renders an MP4 with a free neural voice-over, stock footage and word-highlight subtitles.

Requires Node 20+ and ffmpeg (Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`, Linux: `apt install ffmpeg`), or set `FFMPEG_PATH`.
Optional: `PEXELS_API_KEY` / `PIXABAY_API_KEY` (free) for better footage, and `SHORTS_BGM_DIR` (a folder of royalty-free music).
