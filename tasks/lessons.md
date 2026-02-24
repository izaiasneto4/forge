# Lessons Learned

## 2026-02-24

- If unexpected local edits appear, ask user before proceeding. In multi-agent workflows, keep those files untouched and commit only files changed for the requested fix.
- For responsive board layouts, never center overflowing flex rows (`justify-content: center`) at wide breakpoints; it can clip both left and right edges. Keep left-aligned overflow and test with real viewport screenshots.
- For board UIs, responsive design must be mode-based (phone/tablet/desktop), not only fluid scaling. Ensure phone mode keeps every status reachable via chips/tabs when non-selected columns are hidden.
- In review outputs, `suggested_fix` must be code-only. If the agent has prose guidance, keep it in `comment` and never wrap it in a fenced language block.
