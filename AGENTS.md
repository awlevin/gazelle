<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Git workflow

Always commit and push changes directly to `main` (https://github.com/awlevin/gazelle.git) as you go — one commit per coherent change, not one big commit at the end of a session. Do not create feature branches or open pull requests for your own work — we're moving fast and have few users, so the PR overhead isn't worth it. (Only branch when the user explicitly asks for it.)

# Changelog

There's a reader-facing changelog at `CHANGELOG.md`. Maintain it proactively: when you ship a change worth a reader's attention, add it as part of the same commit — don't wait to be asked.

What belongs there:
- **Reader-facing changes only.** Describe what someone using Gazelle can see or do, in their words. Never list internal/technical work — refactors, gaze-math internals, build plumbing, lint fixes. Translate to a benefit or omit.
- **Skip the too-small stuff.** Copy/wording tweaks and pixel nudges are below the bar — leave them out entirely. When unsure, omit.

Format:
- Newest day on top. One `## <Month D, YYYY>` heading per day.
- Under each day, group items by `### 🔥 New Features`, then `### 🐛 Bug fixes`, then `### 💅 Nits` — in that order. Only include the categories that have items.
- Reserve `🔥 New Features` for substantial, net-new capabilities. Smaller polish goes under `💅 Nits` — including extending an existing feature to another surface, display/formatting tweaks, and minor UX refinements. When torn between Features and Nits, choose Nits.
- `-` bullets; bold a short lead-in on notable items. Keep it concise and lightly playful.
