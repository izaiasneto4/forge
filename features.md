# Forge Feature Suggestions

Based on analysis of the codebase, here are potential improvements for the AI-powered GitHub PR code review application.

## High-Impact Features

1. **GitHub Webhooks Integration** - Replace polling with real-time PR updates via webhooks
2. **Review Analytics Dashboard** - Show stats: reviews per week, issues by severity, average review time, AI model performance comparison
3. **PR Filtering & Search** - Filter by author, labels, size, date range; search by title/description
4. **Review Templates** - Save custom prompts for different review types (security audit, performance check, API review)
5. **Batch/Queue Reviews** - Queue multiple PRs for sequential automated review instead of one-at-a-time

## Workflow Enhancements

6. **Auto-Review on Sync** - Option to automatically start reviews when new PRs are synced
7. **Review Scheduling** - Schedule reviews for off-hours or recurring reviews
8. **Draft Comment Mode** - Edit/curate AI comments before submitting to GitHub
9. **Review Iteration Diff** - Compare what changed between review iterations visually
10. **Multi-Repository Dashboard** - Cross-repo overview with aggregated metrics

## Integration & Automation

11. **CI/CD Integration** - Webhook endpoint for CI events; optionally block merges based on review results
12. **Slack/Discord Notifications** - Alert when reviews complete or critical issues found
13. **Linear/JIRA Integration** - Link PRs to tickets, auto-update ticket status on review completion
14. **Code Coverage Overlay** - Display test coverage data alongside review comments

## Quality of Life

15. **Keyboard Shortcuts** - Navigate kanban board, trigger actions without mouse
16. **Dark/Light Theme Toggle** - Currently appears to use CSS variables—make it user-selectable
17. **PR Size Warnings** - Flag large PRs (>500 lines) as hard to review effectively
18. **Stale PR Detection** - Highlight PRs sitting >7 days without review
19. **Export Reviews** - Download review as Markdown/PDF for documentation

## Advanced Review Features

20. **Custom Severity Rules** - Configure what constitutes critical/major/minor per project
21. **Review Confidence Scoring** - AI assigns confidence levels to each finding
22. **Dependency Security Scan** - Flag vulnerable dependencies in PR changes
23. **Review Presets** - One-click configurations (e.g., "Quick Check" vs "Deep Dive")
24. **Comment Threading** - Track GitHub comment conversations in Forge

---

*Generated on 2026-02-03*
