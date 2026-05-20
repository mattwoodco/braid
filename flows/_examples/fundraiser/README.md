# fundraiser

Generated from `flows/_templates/fundraiser-video-site/`. To re-generate:

```bash
bun .claude/skills/braid/braid.ts create \
  --template fundraiser-video-site \
  --name fundraiser \
  --vars flows/_templates/fundraiser-video-site/examples/fundraiser.json \
  --force
```

To set up Anthropic resources and run:

```bash
bun .claude/skills/braid/braid.ts setup fundraiser
bun .claude/skills/braid/braid.ts run   fundraiser
```

The host post-session hook deploys to Vercel using `$VERCEL_TOKEN` on the host;
the token never enters the agent session.
