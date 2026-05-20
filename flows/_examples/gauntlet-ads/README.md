# gauntlet-ads

Generated from `flows/_templates/url-to-ad-set/`. Re-generate via:

```bash
bun .claude/skills/braid/braid.ts create \
  --template url-to-ad-set \
  --name gauntlet-ads \
  --vars flows/_templates/url-to-ad-set/examples/gauntlet-ads.json \
  --force
```

Setup + run:

```bash
bun .claude/skills/braid/braid.ts setup gauntlet-ads
bun .claude/skills/braid/braid.ts run   gauntlet-ads
```

### How the fan-out works

`director` is the only agent with a session — it coordinates two roster
agents under one Managed Agents session:

```
session ── director (Opus)
            ├── scout (Sonnet, one-shot)        — facts.json, hero, logo, fonts
            ├── designer (Sonnet, thread 1)     — ad-1.html + ad-1.png
            ├── designer (Sonnet, thread 2)     — ad-2.html + ad-2.png
            ├── designer (Sonnet, thread 3)     — ad-3.html + ad-3.png
            ├── ...
            └── designer (Sonnet, thread N)     — ad-N.html + ad-N.png
```

All threads share the container filesystem and the scoutStore mount, so
designers read facts.json from one place and emit deterministic file names.
The director's `system_stable` is cached (1h ephemeral); designer threads
share the same agent definition, so their stable system prefix is also
cache-warm after the first thread starts streaming.
