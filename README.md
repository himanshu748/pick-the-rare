# Pick the Rare

A daily crowd-psychology game: choose the answer you expect the fewest people to choose, lock once, and return after midnight UTC. The approved specification is in PLAN.md.

[58.5-second local demo](https://youtu.be/AJ5ZlrWMJLw) · [Local result screenshot](docs/local-reveal.png) · [Devpost project](https://devpost.com/software/pick-the-rare)

## How to play

1. Open a round from its Reddit post. Pick the answer you expect the fewest players to choose.
2. Optionally predict the most popular answer for a five-point bonus. Lock your choice once. Reloading shows the sealed receipt.
3. Reopen after midnight UTC. The final distribution and scores appear once at least ten participants have played and the round has finalized. Smaller rounds show participation only.

The 58.5-second local walkthrough covers the splash, optional prediction, sealed receipt, simulated midnight and final scoring. Its on-screen label identifies the simulated Reddit account, votes and Devvit endpoints throughout. The phone-width browser checks cover opening from the splash, low-turnout reveal and signed-out handling. See the [verification log](docs/verification.md) for what was observed on Reddit.

## How it works

The game implements UTC cutoff rules, integer rarity scoring, ties, low-turnout suppression, content validation and deterministic question scheduling. Run `npm test` to check the rule, round, scoring projection, scheduling and private moderator sample paths locally.

The 60 records in content/seed_questions.json are authoring TODOs, deliberately rejected by validation. No production question bank exists yet. The owner authorized one AI-assisted, explicitly labeled playtest sample on 2026-11-15; it is held separately in the server and is used only once. Picks and counters are written in one watched Redis transaction; repeated requests return the original receipt. Closing a gate precedes count aggregation, and no count/total/score is returned before a finalized reveal.

Post-cutoff, the scheduler finalizes counts then runs projections: per-user results, the daily leaderboard, weekly league totals, play streaks (one forgiven miss per rolling seven-day window) and the contrarian streak (reset by a loss or a missed eligible day, neutral on skipped or low-turnout days). An applied marker travels with each leaderboard write so retries cannot double-score, and a projected marker closes the day. The enriched view adds percentile, weekly league, streaks, Day N and a next-question countdown.

Sharing is explicit: the result comment posts as the user only on tap, with a copyable spoiler-safe fallback when user actions are unavailable. Subscribe and flair are opt-in and fail gracefully. Moderator post menus cover skip, regenerate (open, unvoted rounds only), inspect and post-intent adoption, plus a backfill that finishes projections for a finalized day. Subreddit settings hold the start date and a display timezone; storage and cutoff stay UTC. Analytics sit behind one track() helper on the Journeys endpoints; receipts are expected to be denied until the app is approved.

The [archived private sample post](https://www.reddit.com/r/pick_the_rare_dev/comments/1y0ye2w/) previously showed a sealed receipt and a correct one-participant reveal on v0.0.3, as recorded in the verification log. Current judge access and multi-player scoring on Reddit still need verification.

## Owner playtest and judge access

Use Node 24.18 or newer. From this directory, the owner can run:

```sh
npm ci
npm run login
npx devvit whoami
npm run dev -- pick_the_rare_dev
```

If the owner account still receives the previously documented suspension error, use the [Reddit appeal page](https://www.reddit.com/appeal). Follow the [official playtest guide](https://developers.reddit.com/docs/guides/tools/playtest).

The **Open playtest round** moderator action can use the existing one-time labeled sample on `r/pick_the_rare_dev` when no approved question is scheduled. Scheduled rounds use approved human-authored questions. To prepare a judge round, collect a human-authored suggestion from the community panel, approve it with the appropriate tier, and use **Reschedule this week** if the day was empty. Then verify the interactive post from a judge-accessible account and use that permalink for the entry. The [hackathon rules](https://redditgameofday2026.devpost.com/rules) explain public test subreddit and Devvit admin access options.
