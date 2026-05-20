# fraction-blocks

Generated from `flows/_templates/static-site-builder-deployer/`. Re-generate:

```bash
bun .claude/skills/braid/braid.ts create \
  --template static-site-builder-deployer \
  --name fraction-blocks \
  --vars flows/_templates/static-site-builder-deployer/examples/fraction-blocks.json \
  --force
```

Setup + run:

```bash
bun .claude/skills/braid/braid.ts setup fraction-blocks
bun .claude/skills/braid/braid.ts run   fraction-blocks
```

Single-agent session — no coordinator. The builder agent's stable system
prompt (role + hard rules + path discipline + manifest contract) is cached;
the per-run brief / design system / required elements are in `system_dynamic`.
Set `tier: orchestrate` in vars if the brief genuinely requires deep design
judgment (3D, interactive, large layout) — otherwise leave default Sonnet.
