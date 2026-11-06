---
description: Plan and render a series of short videos for a niche (content calendar)
argument-hint: <niche or channel idea> [count, default 3] [language]
---

Create a series of short videos for: $ARGUMENTS

1. Propose N video ideas for this niche (default 3, max 10). Each one is a strong hook, specific and factual, and different from the others. Show the list briefly.
2. For each idea, one at a time, follow the same rules as `/shorts-studio:make`: write the narration (~45 s, hook first, plain spoken text), pick 4–8 English footage search terms, and call `make_short_video`. Give each video a distinct `title`.
3. At the end, give a table: # | title | path | duration, plus a posting plan with one video per day and the title, description and hashtags for each.
