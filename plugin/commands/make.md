---
description: Turn a topic into a finished short video (script, voice-over, footage, subtitles, MP4)
argument-hint: <topic> [language] [portrait|landscape|square] [~seconds]
---

Make a short video about: $ARGUMENTS

1. Work out the topic, the language (default: the language the topic is written in), the aspect (default portrait) and the target length (default ~45 seconds; ~2.6 spoken words per second).
2. Write the narration yourself, MoneyPrinterTurbo-style:
   - The first sentence is a hook: a surprising fact, a question or a bold claim. No "welcome", "in this video", or "let's dive in".
   - Plain spoken text only: no markdown, emojis, headings, hashtags, scene labels or stage directions.
   - Short sentences, one idea each. Concrete facts and numbers. End with a punchy line or a question that invites comments.
   - Get facts right; leave out anything you are not sure of.
3. Write 4–8 stock-footage search terms in **English**, in the order the script mentions things. Use 1–3 concrete, filmable words each ("city traffic night", "coffee beans", "doctor tablet"). Never use abstract words like "success" or "knowledge".
4. Call the `make_short_video` tool with `script`, `search_terms`, `title`, `language` and `aspect`. Pick a voice that fits the language and tone (call `list_voices` if unsure; for Arabic, `ar-SA-HamedNeural` or `ar-EG-SalmaNeural`). Keep the default `highlight` subtitles unless asked otherwise.
5. When it finishes, reply with:
   - the video path (and the folder),
   - a ready-to-post **title**, a 1–2 line **description** and 5–8 **hashtags** in the video's language,
   - a reminder that `credits.txt` lists the footage authors and licences (CC BY / CC BY-SA clips need a credit line in the description),
   - any warnings returned (missing footage and so on).

If a render fails because no footage was found, retry once with broader search terms.
