# Development conventions retained from revision 8

Current contributor instructions are in [AGENTS.md](../../AGENTS.md).

- Local examples and review environments remain separate from production.
- Import only approved local content; preserve public wording, photos and brand assets.
- Use shared tokens/components and the sanitizing renderer. Preserve tenant boundaries.
- Keep database tests disposable and isolated from retained/review installations.
- Review authoring at 1440/1024 and public pages at 390. Inspect visual differences.
- Run one browser suite at a time, at most two workers; retain assertions and timeouts.
- Keep secrets, raw tickets, archives and operational evidence outside Git.
- Changes to cloud resources, billing, identities and domains require the relevant
  administrator's authorization. Production cutover is a separate reviewed action.
