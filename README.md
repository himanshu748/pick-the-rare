# Pick the Rare: implementation in progress

A daily crowd-psychology game: choose the answer you expect the fewest people to choose, lock once, and return after midnight UTC. The approved specification is in PLAN.md.

Implemented: pure UTC date and cutoff rules, integer rarity scoring with a five-point prediction bonus, tied outcomes, no competitive score below ten participants, content validation and deterministic frozen-manifest lookup. Twenty-three Vitest tests pass, including 120 consecutive synthetic dates and projection exactly-once guarantees. These are local rule tests, not live Reddit validation.

The 60 records in content/seed_questions.json are authoring TODOs, deliberately rejected by validation. No production question bank exists yet. The owner authorized one AI-assisted, explicitly labeled playtest sample on 2026-11-15; it is held separately in the server and is used only once. Picks and counters are written in one watched Redis transaction; repeated requests return the original receipt. Closing a gate precedes count aggregation, and no count/total/score is returned before a finalized reveal.

Post-cutoff, the scheduler finalizes counts then runs projections: per-user results, the daily leaderboard, weekly league totals, play streaks (one forgiven miss per rolling seven-day window) and the contrarian streak (reset by a loss or a missed eligible day, neutral on skipped or low-turnout days). An applied marker travels with each leaderboard write so retries cannot double-score, and a projected marker closes the day. The enriched view adds percentile, weekly league, streaks, Day N and a next-question countdown.

Sharing is explicit: the result comment posts as the user only on tap, with a copyable spoiler-safe fallback when user actions are unavailable. Subscribe and flair are opt-in and fail gracefully. Moderator post menus cover skip, regenerate (open, unvoted rounds only), inspect and post-intent adoption, plus a backfill that finishes projections for a finalized day. Subreddit settings hold the start date and a display timezone; storage and cutoff stay UTC. Analytics sit behind one track() helper on the Journeys endpoints; receipts are expected to be denied until the app is approved.

Community content: any signed-in player can suggest a question (three per day), moderators approve or reject from a review-queue form, and the approved pool feeds a weekly support ballot with hidden totals. Each week's frozen ballot schedules tier-matched days; empty inventory produces an explicit no-content state, never a TODO game. Winning authors are credited on the post.

Live status: v0.0.4 is installed on r/pick_the_rare_dev at https://github.com/himanshu748/pick-the-rare. The one-participant sample round revealed correctly after the cutoff (state `revealed`, total 1, competitive fields suppressed). The live reveal, sealed receipt and persisted receipt were verified through the authenticated init endpoint. Multi-player distribution, streak and league behavior are covered by tests but not yet exercised live. The submission, review and ballot flow is test-covered but not yet exercised live.

Use Node 24.18 or newer. Run npm install, then npm test. Never run devvit publish or submit for review. The launch script has been removed. Run `npm run dev` from this directory using the Reddit developer account that owns the private test installation.

## Private Reddit playtest

Open the [private sample round](https://www.reddit.com/r/pick_the_rare_dev/comments/1y0ye2w/) with an approved Reddit account. Choose one answer and optionally predict the most popular answer. After locking, reload and open the game again to see the saved receipt. Results become available after midnight UTC once the round finalizes. The sample day finalized before projections existed; run the moderator action "Backfill projections" on the post to finish its result, streak and league writes.
