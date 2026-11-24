# Daily contrarian-consensus game — approval plan

**Status: approved by the owner on 2026-11-15.** A one-round private playtest is installed. Implementation is in progress.

Daily Contrarian runs on Reddit as `pick-the-rare`, with its private playtest in `r/pick_the_rare_dev`.

## 1. Product outcome and decisions for approval

Audience: mobile Reddit readers who want a quick daily choice and a reason to return to discover how the community thought. Choose the least popular of four answers, optionally predict the most popular, lock once, and return after midnight UTC for the outcome. There are no factually correct answers, no lobby, and no need to be online with other players.

Smallest complete journey: today's post → choose → optional prediction → explicit lock → sealed receipt → next-day reveal → score and weekly league → optional result comment. Community submissions, moderation, voting, scheduling, streaks, and opt-in flair complete the requested scope.

Approval includes these explicit adaptations of conflicting requirements:

| Tension | Proposed resolution |
| --- | --- |
| Solver, solvability and par | Replace with deterministic content selection, structural validation and scoring invariants. There is no correct answer, provable crowd difficulty or meaningful puzzle par. Compare with the actual finalized field. |
| Easy Monday to hardest Sunday | Human authors/moderators label reasoning depth 1–7. Tests prove weekday label compliance; human playtesting assesses actual difficulty. |
| Immediate result versus delayed reveal | Two end-card states: sealed receipt immediately, scored reveal after cutoff and finalization. |
| Live blurred bar | Clearly labeled sealed illustration independent of actual votes. Never blur real counts: geometry, DOM, accessibility labels and network responses must not leak the distribution. No fabricated statistic. |
| UTC date versus timezone setting | UTC controls keys, cutoff and weeks. Moderator IANA timezone setting controls display only. Start date controls Day N. |
| Latecomers | Anyone may play before the day's cutoff. Closed posts remain readable/revealable but cannot accept a scored pick. |
| Streak flair versus weekly flair | Opt-in flair combines a finalized weekly points tier and a 3/7/30 participation milestone. No unearned tier or invented percentile. |
| All-user sharing versus never publishing | Official docs restrict user-account actions in unapproved apps. Verify actual sharing for the app owner; other players get copyable text with an explanation. Never silently fall back to an app-authored score comment. Universal user-account sharing remains blocked by approval, which this task forbids requesting. |

Non-goals: runtime LLMs, AI-generated playable questions/art, paid APIs, native Reddit vote automation, synchronous multiplayer, a separate marketing website, cross-subreddit league, publication/review/submission, commits or pushes without an explicit request.

## 2. Official API evidence

Read the live official docs on 2026-11-15 through HTTPS. No Devvit MCP search tool was exposed in this session. These references establish the plan, not successful integrations. Before writing implementation, check every exact signature/import against the current documentation and installed SDK types; do the same for any additional API.

| Need | Confirmed contract | Source |
| --- | --- | --- |
| Fresh project | Official React template at developers.reddit.com/new; Node 24.18.0+; src/client, src/server, src/shared | [Quickstart](https://developers.reddit.com/docs/quickstart/quickstart.md) |
| CLI | `npx devvit init [code] [--template <name>]`, `npx devvit login`, playtest and upload; publish requests review | [CLI](https://developers.reddit.com/docs/guides/tools/devvit_cli.md) |
| Configuration | devvit.json entrypoints, permissions, scheduler, menus, forms, settings, install/upgrade triggers | [Configuration](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_configuration.md) |
| Daily post | `reddit.submitCustomPost({ title, entry, postData, textFallback, styles })` | [Custom posts](https://developers.reddit.com/docs/capabilities/creating_custom_post.md) |
| Preview | Inline HTML entrypoint; expanded mode follows an explicit user action, using `requestExpandedMode` | [View modes](https://developers.reddit.com/docs/capabilities/server/launch_screen_and_entry_points/view_modes_entry_points.md) |
| Metadata | `context.postData` in client and server; public to client; 2 KB limit | [Post data](https://developers.reddit.com/docs/capabilities/server/post-data.md) |
| Scheduling | `scheduler.tasks.<name>` with internal endpoint and cron; `scheduler.runJob`, `listJobs`, `cancelJob` | [Scheduler](https://developers.reddit.com/docs/capabilities/server/scheduler.md) |
| Redis | get/set, hGet/hSet/hSetNX/hIncrBy/hScan, zAdd/zRange/zScore/zRank/zCard/zIncrBy, expire, watch/multi/exec/discard/unwatch | [Redis](https://developers.reddit.com/docs/capabilities/server/redis.md) |
| Share | `reddit.submitComment({ id, text, runAs: 'USER' })`; `SUBMIT_COMMENT` asUser permission; explicit tap; plain score shares reply to one stickied comment | [User actions](https://developers.reddit.com/docs/capabilities/server/userActions.md) |
| Sticky reply thread | `comment.distinguish(true)` | [Comment](https://developers.reddit.com/docs/api/redditapi/models/classes/Comment.md#distinguish) |
| Join | `reddit.subscribeToCurrentSubreddit()`, `SUBSCRIBE_TO_SUBREDDIT` permission, separate explicit action; no query for subscription state | [User actions](https://developers.reddit.com/docs/capabilities/server/userActions.md) |
| Identity/flair | `context.userId`, `reddit.getCurrentUsername()`, `reddit.setUserFlair(options)` | [RedditClient](https://developers.reddit.com/docs/api/redditapi/RedditClient/classes/RedditClient.md), [flair options](https://developers.reddit.com/docs/api/redditapi/models/type-aliases/SetUserFlairOptions.md), [logged-out users](https://developers.reddit.com/docs/guides/logged-out-users.md) |
| Moderator UI | `menu.items[].forUserType: "moderator"`, internal handlers, forms, UiResponse; moderator form action window is 10 minutes | [Menu actions](https://developers.reddit.com/docs/capabilities/client/menu-actions.md) |
| Settings | `settings.subreddit`, validationEndpoint, `settings.get(key)` | [Settings](https://developers.reddit.com/docs/capabilities/server/settings-and-secrets.md) |
| Journeys | `permissions.journeys: true`; telemetry from `@devvit/analytics/client/reddit`; server adapter from `@devvit/analytics/server/reddit`; App.Ready and Journey.Start/Progress/Interaction/End | [Journeys](https://developers.reddit.com/docs/capabilities/analytics/devvit-journeys.md) |
| Analytics status | Calls return receipts; not-allowlisted events are dropped; HTTP success does not prove ingestion | [Receipts](https://developers.reddit.com/docs/capabilities/analytics/journeys-receipts.md) |
| Backend tests | `createDevvitTest()` from `@devvit/test/server/vitest` | [Testing](https://developers.reddit.com/docs/guides/tools/devvit_test.md) |

The docs explicitly say unapproved/playtest `runAs: 'USER'` acts as the app account except for the app owner. This plan disables non-owner automatic sharing rather than disguising that behavior. Subscription behavior also needs live verification within approval restrictions.

Platform bounds: unpublished Redis installations have 100 MB storage and a 5 MB request payload limit. The Redis page inconsistently states 20 and 30 concurrent transaction blocks; design conservatively for **20**, with 5-second transaction timeout. App requests have a 30-second limit. Do not assume Lua, lists, plain sets, or unlimited throughput.

## 3. Fresh-project architecture

This workspace is a planning repository, not a Devvit app. Current shell Node is **22.14.0**, below the requirement. After approval, select/install and verify Node 24.18+ before dependencies. Use developers.reddit.com/new and its React template in a fresh `app/` directory, or the actual slug directory created by the documented initialization flow. Preserve existing files; do not transplant another game.

If login is required in a headless environment, stop and report `npx devvit login`, the need for the user's interactive Reddit authorization, and intended app/test subreddit. Do not bypass auth or move tokens between identities. No login is attempted during planning.

```text
app/
  devvit.json
  src/shared/                   pure strict TypeScript, no DOM/Devvit imports
    content.ts dates.ts score.ts streaks.ts validation.ts contracts.ts
  src/client/
    preview.html preview.ts     small custom inline entry
    game.html App.tsx           choice, receipt, reveal, league
    community/                 lazy submission/voting UI
    lib/                       track, sound, theme
  src/server/
    index.ts                   official template server/framework
    routes/                    public API + internal task/menu/form endpoints
    services/                  days, votes, finalization, content, flair, sharing
  content/seed_questions.json   at least 60 TODO-only records
  tests/                       Vitest pure and backend tests
  AGENTS.md
  .kiro/steering/product.md
  .kiro/steering/tech.md
  README.md DEVPOST_STORY.md VIDEO_SHOTLIST.md SUBMISSION_CHECKLIST.md
```

Use the generated template's actual supported versions/framework. React for application views; HTML/CSS/SVG for preview and charts. No Three.js or chart library is needed. Lazy-load community tools, secondary league views and optional sound.

Server owns identity, UTC dates, canonical post/day binding, content revisions, vote acceptance, scoring and permissions. Clients submit only validated choice/prediction and request IDs, never trusted user IDs, scores or roles. Keep unpublished distributions out of public metadata and every client endpoint. Validate schemas at runtime as well as with strict TS.

Remove any generated `launch` script. Inspect scripts before execution. Allowed: build, tests, types/lint, `npm run dev` playtest, and verified private `npm run deploy` / `npx devvit upload`. Never run publish, launch, review submission, or a script that wraps them. No operations before approval.

## 4. Rules, scoring and streaks

- Day D opens at D 00:00 UTC and closes at D+1 00:00 UTC. Weekly leagues run Monday–Sunday UTC, keyed by Monday's date. Client clock is never authoritative.
- Pick A–D; optionally predict the most popular A–D or skip. Picking the same answer for both is allowed. Both fields lock together once per Reddit user/day. Retry returns the original receipt; prediction cannot be added later.
- No crowd-dependent information before finalization. Immediately after lock show own choice/prediction, participation streak, sealed illustration and countdown. Today has no live rarity score or leaderboard.
- At N ≥ 10, base rarity = `100 × (1 − count[pick]/N)`. Correct prediction earns **5 bonus points**. Weekly total sums finalized base plus bonus, displayed separately too.
- Store integer hundredths: `round(10000 × (N − count[pick])/N) + bonusHundredths`. Format for display only. Equal scores share rank; no time-based tiebreak advantage.
- All minimum-count answers are co-winners. All maximum-count answers qualify for prediction bonus. A four-way tie qualifies everyone; a zero-vote minimum has no winning player. Do not pretend there must be one winner.
- N < 10: show **“Too few players”** and actual participant count; hide percentages, competitive points, percentile and rankings. Participation counts, no prediction bonus, and Contrarian streak holds neutral. Weeks with no eligible results remain empty.
- Field comparison uses actual finalized total scores. “Scored higher than X%” means strictly lower scores / N, so tied players are not counted as beaten. A small real distribution histogram plus an accessible numeric table fulfills the chart requirement. No invented par.
- Play streak: current/best, last-played date, grace-use date. One missed calendar day in a rolling seven-day window may preserve the streak; it adds no played day. A second miss or a gap of two days resets it. Explain grace on the card. App-skipped/no-content days are neutral and do not consume grace.
- Contrarian streak: eligible co-win advances, eligible loss or missed eligible day resets. No personal grace. Low-turnout and app-skipped days are neutral. Process outcomes chronologically, never count a pending day as a win.
- Opt-in flair combines last finalized weekly tier and play milestone. Proposed point thresholds: Starter 0+, Scout 150+, Contrarian 300+, Outlier 450+; no tier until real eligible scoring exists. These are point tiers, not percentiles. Warn that opting in replaces existing subreddit flair. Opt-out stops updates; do not erase unrelated flair. Disabled flair/permissions produce a graceful message, never roll back a result.

## 5. Redis model and write safety

Common prefix `cc:v1:<subredditId>:`; daily keys use UTC yyyy-mm-dd, weekly keys use their Monday UTC date. Long-lived user/content records are deliberately not duplicated per date.

| Key after prefix | Type and purpose |
| --- | --- |
| `day:<D>:meta` | Content snapshot/version, open/close, status, revision, post ID, finalization version |
| `day:<D>:gate:<shard>` | Open/closed/void state and revision for accepting votes |
| `day:<D>:vote:<userId>` | Immutable choice, prediction, admission timestamp, request ID, revision |
| `day:<D>:voters:<shard>` | ZSET user IDs, stable timestamp score, bounded iteration |
| `day:<D>:counts:<shard>` | Hash total and A/B/C/D counters |
| `day:<D>:final:<version>` | Immutable counts, min/max sets, turnout state, score histogram |
| `day:<D>:result:<userId>` | Final score/bonus/outcome and projection version |
| `day:<D>:leaderboard` | ZSET user → final integer score |
| `week:<monday>:leaderboard` | ZSET user → finalized weekly integer sum |
| `day:<D>:applied:<userId>` | Exactly-once projection marker |
| `user:<userId>:progress` | Current/best streaks, cursor, grace date, flair opt-in |
| `question:<id>` | Text, four answers, author, tier, source, revision, review state |
| `queue:<submittedDate>` | ZSET moderator queue index |
| `community:<roundDate>:vote:<userId>` | Immutable weekly support vote |
| `community:<roundDate>:ranking` | ZSET candidate → support count |
| `schedule:<D>` | Frozen selected question/version or no-content state |
| `day:<D>:share:<userId>` | Share intent, outcome and Reddit comment ID |
| `day:<D>:jobs`, `day:<D>:events` | Task cursors/leases and aggregate diagnostic counters |

Retention proposal: detailed votes/results/indexes/markers/weekly leagues 90 days, diagnostics 30 days, pending/rejected submissions 30 days, inactive user progress 365 days. Keep minimal public day snapshots and scheduled content archives within quota. Markers must live at least as long as replayable jobs/results. Cleanup uses known date keys/indexes, not unsupported global key scans. Expired personal detail has an honest archive state.

### Immutable vote transaction

1. Hash user into one of 64 stable shards. WATCH user's vote key and shard day gate. Check existing receipt, canonical post, revision, open status and server time. Do not WATCH a shared counter that changes on every vote.
2. In one MULTI/EXEC: create vote, ZADD voter index, HINCRBY shard total and chosen answer, apply retention. A same-user race aborts one transaction. Counters/index and vote cannot independently succeed in the normal transaction path.
3. Keep transactions short, with no external API calls. Clean up with discard/unwatch on early exit. Bounded jittered retries; on exhaustion return retryable failure, never claim a vote saved. Lost HTTP response is safe to retry using the immutable receipt.
4. Reject admissions at/after cutoff using server time. At cutoff close every shard gate; conflicting in-flight transactions abort. A request admitted just before cutoff may commit before its gate closes: document this admission-time rule. Final counts are read only after all gates close. Scheduler delay must not admit new post-cutoff requests.

Sharding removes a global optimistic-lock hotspot but does not raise Devvit's transaction cap. Thousands of writes are a load-test target, not a throughput claim. Measure limits/backpressure and report whether the target is met.

### Finalization, projections and external effects

Aggregate all closed shards into an immutable snapshot. Iterate voter indexes in bounded batches below 30 seconds; persist cursors and resume via scheduled work. A recurring sweep recovers missed continuations.

Each result derives from the frozen snapshot. Pair weekly ZINCRBY, daily ZADD and application marker in a transaction so retries never double-score. Histogram updates are either part of that exactly-once transaction or derived from the small answer/prediction outcome groups. Publish a coherent version only after required projections finish; meanwhile show “Finalizing”.

Process streaks by date with a per-user cursor and optimistic locking. Out-of-order retries cannot reset newer progress. Accepted participation can be displayed immediately from records while projections catch up. A voided day requires deterministic rebuild of affected projections; never silently rewrite a finalized answer.

Redis cannot transact Reddit post/comment APIs. Persist intent, then API result ID. An ambiguous timeout means **needs reconciliation**, not blind retry. Provide moderator repair/adopt-ID flow with ownership validation. Do not claim exactly-once external posting. Test partial failures, quotas and invalid Redis key types; preserve immutable records for repair.

## 6. Human-authored content and daily scheduling

After approval create `content/seed_questions.json` with **at least 60 explicit TODO-only records**: ID, TODO question, four TODO answers, author-required marker, tier and approval=false. No LLM-written playable questions. TODOs always fail live eligibility. Synthetic structural fixtures are test-only and never shipped as playable content.

Validation: question 1–160 characters; exactly four distinct nonempty answers, each 1–48 characters after normalized comparison; valid Unicode; no control characters, links or personal-information requests; server-derived author; human-approved tier 1–7. A local profanity filter flags whole words/common obfuscations, with documented false-positive/negative limits. It never replaces moderation. Bound payloads, escape text, and rate-limit submissions to three per user/UTC day.

Content states: pending → approved → ballot → scheduled → used; reject/remove/withdraw paths are audited. Edits create a revision requiring reapproval. Human moderators reject factual trivia, targeted harassment, sensitive/unsafe questions and unsuitable material. Include report/removal flow and revalidate immediately before scheduling.

Community voting is **in-app support in Redis**, not native Reddit upvote automation (prohibited by docs). One immutable candidate support per authenticated user per weekly ballot; no self-vote. Pair vote and ranking increment atomically. Rotate candidate order stably per user, hide totals until ballot closure, and resolve ties by approval timestamp then stable question ID.

Freeze each weekly ballot before scheduling the next week. For each weekday select the highest-supported unused approved question matching that tier, then the next eligible candidate, then an unused human-authored seed. Reserve selections atomically so no question is assigned twice. Credit the actual author on the post. Deleted accounts receive an unavailable-author label.

`generate(dateUTC)` is pure over a **versioned frozen schedule manifest**, not a mutable vote pool. Same manifest/date returns identical question, answer order, tier, visual motif and cutoff. Store full selected content snapshots so edits cannot rewrite past posts. Empty eligible inventory produces an explicit no-content state and moderator alert, never a TODO game.

**60 questions cannot supply 120 unique days.** The required 120-consecutive-day test uses clearly labeled synthetic fixtures to prove selection/validation. Actual 120-day unique-content readiness needs at least 120 eligible human-authored questions across tiers or continuing approved community supply. No silent repeats by default, and no “60 questions ready” claim while the file contains TODOs.

Scheduler design:

- A minute cron evaluates UTC date and persistent work state, making midnight transitions recoverable without assuming exact delivery time.
- Close yesterday's gates, enqueue bounded finalization, and create today's post when approved content is available. Today's post includes yesterday's reveal panel when finalized; no redundant second daily reveal post.
- Title `Day N · <human-authored hook>`; neutral fallback `Day N · Make your pick`. Feed preview uses the actual question and a deterministic geometric daily motif, never vote-derived graphics.
- Public postData contains day, content reference/public preview, revision and motif under 2 KB; no hidden counts, individual picks or secrets.
- Create one stickied app-authored result-reply thread per post. Reveal discussion prompt such as “Why did you pick C?” refers to a real revealed answer. No automatic user-authored comments.
- Deduplicate install/upgrade/task retries by stored day state and intent. If a post is late or missing, report it accurately. Very late recovery may skip a day rather than imply a full-day competition.

Moderator menu: review and approve/reject with tier; remove candidate; inspect schedule/job status; regenerate today's selection **only before opening**; skip/void with reason; reconcile ambiguous post creation. Never replace a question after players could see or lock it. Use protected moderator internal menu/forms and validate the 10-minute action window. Additional moderator API routes require documented server permission checks before implementation.

Settings: `startDateUTC` (strict date; no retroactive renumbering), `displayTimezone` (IANA, default UTC), content-pause switch and flair-enable switch. Future settings do not change existing snapshots/cutoffs.

## 7. Screens, art direction and accessibility

Proposed character: compact editorial game built around a sealed choice and a next-day reveal. No Snoo/karma motifs, stock-template dashboard or generated art. Public entry is the Reddit inline post; it connects to the expanded game. No separate website.

Palette: warm paper #F6F1E7, ink #202533, blue #2864B7, amber #E6A642; dark background #171C26 with warm off-white text. Validate actual contrast; amber is not small text on paper. Answers use letters and geometric/pattern markers so color never carries identity alone.

Typography: proposed self-hosted licensed **Atkinson Hyperlegible** for question/body/buttons; system monospace with tabular numerals for countdown/score. Scale 14/16/20/28/40 px, interactive copy ≥16 px. Verify licensing, glyph appearance, real browser loading and long-content layout during implementation. Before substantial styling inspect 2–3 concrete mobile reference screens for choices, receipt and distribution; none have been inspected yet, so this proposal is not claimed to be reference-led.

Screens:

1. **Inline custom entry:** day/question, four large cards when content fits or compact entry to expanded choice. No blocking splash animation. First actionable control within 3 seconds; first paint target <1.5 seconds, inline loading near documented <1 second guidance. One brief ghost-hand/select hint, stopped by input; static icon under reduced motion. Hint never submits a vote.
2. **Expanded choice:** ≥48 px controls, reversible selection, optional prediction and Skip, explicit irreversible Lock. Keyboard Tab/Enter/Space and A–D/1–4 shortcuts outside text inputs. Do not capture feed scroll or browser keys in inline mode.
3. **Sealed receipt:** own choice/prediction, confirmation, participation streak, neutral sealed graphic, UTC reveal countdown with local display, community entry. No rarity score yet.
4. **Final reveal/end card:** real four-answer distribution plus accessible table; own choice, base/bonus/total, field comparison, both streaks, weekly rank/total, share preview/button, separate join prompt, next-day countdown. Below ten, substitute “Too few players”.
5. **Weekly league:** real participants, tied ranks, own position, week dates, finalized-through label. Intentional empty state: “Be the first today” or “The league begins after the first eligible reveal”, depending on state.
6. **Community:** submission form/counters, own review status, approved ballot, credited scheduled question. Moderator queue uses protected menu/forms.
7. **Exceptional states:** logged-out browse/sign-in, empty content, closed/void day, duplicate pick, retryable failure, unknown save outcome (refetch receipt), disabled flair, permission failure, removed post, finalization pending and expired archive.

Motion follows the preferred motion-design skill and context-adaptation guidance: tap feedback <100 ms; 120/200/300 ms duration palette, restrained ease-out and transform/opacity. Lock closure and final reveal animate once. Reduced motion removes spatial hand/bar animations, bounce and loops. Preserve semantic controls, focus, screen-reader live status, zoom and responsive content. Sound is off by default with a labeled opt-in toggle; small locally synthesized UI tones, no external audio service or narration.

Performance budgets are provisional: ≤80 KB gzipped initial preview JS, ≤200 KB first expanded JS; account separately for fonts/media. Lazy chunks cannot block choice. Measure cold/warm loads on representative mobile with explicit network/device settings; do not claim these targets are achieved until measured.

## 8. Journeys and analytics

One `track(event, metadata)` boundary. Recheck exact telemetry method signatures in docs/installed SDK before use; do not infer methods from event labels. No PII, question text, answer choice, user ID or username in custom analytics fields. Gameplay must succeed even when telemetry fails.

| Product event | Trigger and mapping |
| --- | --- |
| post_view | App becomes interactive → App.Ready; never Journey.Start for a view |
| first_interaction | Completed intentional tap/key action → Journey.Start plus interaction; dedupe per session |
| attempt_start | First deliberate choice selection → Journey.Progress after start |
| attempt_complete | Server confirms immutable lock → Journey.End complete=true; no unknown score/win |
| share_comment | Confirmed actual user-account comment → separate explicit share interaction journey; copying is a different event |
| return_next_day | Server recognizes return after previous-day participation; aggregate return flag, attach to intentional engagement, not passive Journey.Start |

Use a separate reveal journey when a player intentionally opens finalized results; only then send known score/win metadata. Log receipts as implementation diagnostics. Accepted, denied, invalid and rate-limited are distinct; non-allowlisted ingestion remains unverified/blocked. Do not submit for review to enable it.

Keep small deduplicated first-party funnel counters in Redis with short retention and strictly allowed event names. They are private diagnostics, not public player statistics. Test adapter mappings and denial/error handling. If a required documented SDK entry point is unavailable at implementation, retain a single no-op adapter and explicit README limitation rather than fabricate analytics.

## 9. Test and playtest plan

No application tests have run; there is no new app yet.

**Pure Vitest:** generate 120 consecutive dates from a frozen test-only manifest; determinism across timezones, structural validity, weekday tier, distinct answers, immutable snapshots and content exhaustion. Negative tests reject TODOs, invalid dates, duplicate answers, tier gaps and unapproved revisions. Exhaustive small-count distributions plus large-count properties cover all ties, zero-count options, N=0/1/9/10, base/bonus bounds, rounding, tied ranks and strictly-lower percentile. Test UTC midnight, leap days, month/year/week boundaries, DST display changes, fake client clocks, grace, neutral days, missed eligible days, chronological replay, best streak and weekly resets.

**Backend/integration:** many same-user concurrent locks produce exactly one vote/index/count and unchanged prediction; distinct-user counters match records. Test transaction caps, bounded backoff, quota failures, lost responses, cutoff/shard-close races, stale revision, spoofed identity/date/post, logged-out writes, non-moderator calls and expired forms. Restart finalization at every step; duplicate/out-of-order tasks cannot double-score or regress streaks. Validate histogram/leaderboard consistency and recovery from missed continuations. Community tests cover duplicate/self support, submission limits, review changes, ties, atomic reservations, withdrawals and no content. Share tests cover repeated taps, ambiguous outcomes, non-owner gate and missing sticky thread; flair disabled/opt-out and subscribe failures. Mocks are not proof of live APIs.

**Real playtest after implementation:**

- Use allowed development/private upload commands. Record actual app listing and post URLs. Confirm the test subreddit is public and has fewer than 200 members; no fabricated URLs or member counts.
- Exercise choose → optional prediction → lock → receipt → scheduled close → reveal → league. Shortened test clocks may accelerate isolated checks but must be labeled. Observe at least one real UTC transition before claiming the live daily loop verified.
- Exercise authored submission → moderator approval → ballot → reservation → credited post. User-authored test content is required; without it this is blocked, not replaced with LLM questions.
- Verify a real owner-account share, non-owner copy-only behavior, separate subscribe action, opted-in flair success, disabled-flair failure, actual Journeys receipts, moderator protections and settings.
- Inspect mobile/desktop browser, keyboard, labels, reduced motion, light/dark, sound default, actual fonts, long answers, scrolling, retry/error/empty states, console and load timing. Test actual Reddit mobile app if available; otherwise explicitly mark it untested.
- Load-test isolated synthetic keys and report measured throughput/limits. Never create fake Reddit players, contaminate the real leaderboard, or describe test concurrency as real participation.

Every required system gets passed / failed / blocked / not tested with evidence. Content, platform gates, authentication and real-clock gaps must remain visible.

## 10. Phases and deliverables after approval

1. **Foundation:** fresh React project, Node check, strict TS, verified API imports, AGENTS.md and Kiro steering, 60 TODO placeholders, pure rule tests.
2. **Risk-first vertical slice:** real Devvit immutable pick, hidden-data boundary, cutoff and finalized result; test owner sharing and Journeys receipt limitations early.
3. **Daily/community systems:** scheduling, bounded finalization, league/streaks, submissions/moderation/support voting, content reservations, settings and flair.
4. **Product finish:** inline entry, sealed/result cards, accessible responsive light/dark UI, motion/sound, meaningful states and performance checks.
5. **Evidence/package:** real playtest, focused checks/diff inspection, honest documentation and submission materials. No publication, review request, submission, commit or push.

Create these in the actual app root during implementation:

- **AGENTS.md (Factory)** and **.kiro/steering/product.md + tech.md (Kiro):** concept, UTC/privacy/concurrency invariants, verified APIs, Node/strict TS, no-publish/no-paid/no-runtime-AI rules, human-authored content and evidence standards.
- **README.md:** what/how to play, delayed daily loop, Reddit features, content authoring and validation, setup/run/test commands, required Node, grace/scoring rules, privacy/retention, limitations and real verification status.
- **DEVPOST_STORY.md:** inspiration from the stated crowd-psychology premise, actual behavior/build/challenges, factual next steps. No invented personal experiences, metrics, users, testimonials, novelty or winning odds.
- **VIDEO_SHOTLIST.md:** under 60 seconds from the real demo post. Proposed 0–6s question/first interaction; 6–16s choice/prediction/lock; 16–22s sealed receipt; 22–35s actual prior-day reveal; 35–43s actual share/league/flair; 43–53s community workflow/credited question; 53–58s return cue. Use a genuine prior-day result or label time-compressed test footage. No generated narration unless separately requested under the Deepgram-only preference.
- **SUBMISSION_CHECKLIST.md:** actual `https://developers.reddit.com/apps/{name}` listing, actual public demo post and <200 member evidence, README present, app unpublished/no review request, video duration and verified feature gaps. Verify current official eligibility, deadline/timezone and category.

Category: provisionally the event's new/original daily-game category, **exact label unverified**. Do not copy “Best Ported Daily Game” from the old plan. The judging rubric is supplied by the user; an official event URL was not supplied or independently verified here. Obtain it during implementation before claiming eligibility or submission readiness; do not invent dates or category labels.

## 11. Risks and acceptance checkpoint

| Risk | Response |
| --- | --- |
| No authored content | TODOs only; live content and content-dependent demo remain blocked until user authors questions with tier coverage. |
| Subjective difficulty | Automated label checks plus human playtesting; no fake par/solvability claim. |
| Delayed payoff / low turnout | Sealed receipt, play streak, community activity; under-ten rounds neutral, never fake players. |
| Collusion / multiple accounts | Immutable authenticated pick and hidden counts; cannot claim to eliminate Sybil behavior. |
| Platform approval gates | Owner-only share verification/copy fallback, receipt-based analytics reporting; no publish workaround. |
| Limits and job failures | Bounded transactions/jobs/retries, persistent intent, quota-aware retention, measured load and moderator repair. |
| Harmful UGC / moderator error | Human review, report/removal path, immutable revisions and no rewriting a visible round. |
| Event facts unknown | Verify organizer rules/category before claiming compliance. |

**STOP for approval here.** Approval should cover the final consensus concept, replacement of maze-specific solver/par requirements, UTC cutoff, +5 prediction bonus, low-turnout/tie/streak rules, in-app community voting, and documented platform limitations. Final app name, official event URL, user-authored questions and test-community access can be supplied during implementation; none is assumed to exist.
