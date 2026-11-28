# Verification log

## 2026-11-28 (local first-round walkthrough)

- A browser at phone width opened the splash, locked one choice, retained its receipt after a reload and showed the low-turnout reveal without distribution, score or sharing. A signed-out fixture could select a choice but could not lock it.
- The desktop browser opened the same splash, chose D, predicted B, reopened the sealed receipt, then used **Check reveal** after the simulated cutoff. The local fixture revealed all four counts and the correct five-point prediction bonus. These were real client interactions with simulated Devvit endpoints and votes. The recording runs 58.5 seconds.
- The private moderator sample regression proved that a previously frozen empty day could never reach the fallback. Tests now cover one private moderator sample, no sample outside the test subreddit and priority for approved community content. All 33 tests, typecheck, lint and build passed locally.
- The archived private post could not be opened for a fresh judge-access check. No Reddit upload or post action was run for this pass.

## 2026-11-25 (community pipeline slice, not deployed)

- `npm test`: 30 tests pass, including `server/core/community`: draft validation, rate limit of three per user per day, approve/reject transitions, author-only withdraw, one immutable ballot vote with self-vote and closed-ballot rejection, frozen-order scheduling by support then approval timestamp then id, tier-matched day picks, explicit no-content snapshots and the scheduled-to-used transition.
- `npm run test:types`, `npm run lint` and `npm run build` pass. The community UI is a lazy chunk (`dist/client/community.js`, about 6 KB raw) so the game entry budget is unchanged.
- Deploy is blocked: `devvit upload` and `devvit apps list` now return `permission_denied` ("account banned or suspended") for `u/jhahimanshu653`, the same error playtest gave earlier. Earlier uploads succeeded this week, so the suspension is new. The live install remains v0.0.3. Unblocked by the owner via https://www.reddit.com/appeal.
- Not yet verified live: submission form end to end, the review form's chained queue flow, ballot voting, schedule freezing on a real daily tick and reschedule-week after mid-week approvals.
- API evidence: `forms` config shape (name to `/internal/` endpoint map) and `UiResponse.showForm` confirmed against the official `devvit-template-mod-tool-devvit-web` template and `@devvit/shared-types` declarations; form submits POST the raw values object.

## 2026-11-21 (v0.0.3 on r/pick_the_rare_dev)

- `npm test`: 23 tests pass across `shared/rules`, `shared/streak`, `server/core/round` and `server/core/progress`.
- `npm run test:types` (tsc --build), `npm run lint` and `npm run build` pass.
- The sample round finalized after the 00:00 UTC cutoff: an authenticated call to `/api/init` on the live post returned `state: "revealed"`, `total: 1`, the sealed receipt `{choice: 0, prediction: 1}` and no competitive fields (under-ten suppression).
- `/api/init` and `/api/telemetry/journey/app-ready` on the v0.0.3 webview respond `missing authorization header` without a signed request context, confirming both routes are live behind the Devvit auth boundary.
- The sample day finalized before projections existed. Its result, streak and league writes are pending the one-time moderator action "Backfill projections" on the post; the action is idempotent.
- Not yet verified live: multi-participant distribution and percentile, share-as-comment as the user (playtest attributes user actions to the app account for non-owners), subscribe, flair application, Journeys receipts (denied until app approval) and moderator menu actions end to end.
- The bundled Redis mock does not enforce WATCH conflicts, so real concurrent admission safety remains untested. Projection exactly-once behavior is covered by markers and transaction pairing.

## API evidence

Official docs consulted for this slice: devvit.json configuration (permissions, settings, menu, triggers, scheduler), User Actions (`runAs: 'USER'`, SUBMIT_COMMENT, SUBSCRIBE_TO_SUBREDDIT, playtest attribution), Settings and Secrets (field schema and `settings.get`), Devvit Journeys (telemetry endpoints and `permissions.journeys`) and the installed SDK declarations for `submitComment`, `subscribeToCurrentSubreddit`, `setUserFlair`, `removeUserFlair`, `getCurrentUsername`, `zRange`, `zIncrBy`, `zScore`, `zCard`, `hMGet`, `watch`, `multi` and `exec`.

The analytics server router ships only as Express middleware, so `src/server/routes/telemetry.ts` reimplements its five `/api/telemetry/journey/*` endpoints in Hono against the public `telemetry` client surface.

## Historical notes

2026-11-15: `devvit playtest` failed with `permission_denied` (account appeal flow). A later private upload and install succeeded as `pick-the-rare` v0.0.1 on `r/pick_the_rare_dev`, and the sample post is live at https://www.reddit.com/r/pick_the_rare_dev/comments/1y0ye2w/.

The bundled Redis mock records watched keys but its exec does not check whether they changed; concurrent admission and cutoff conflicts still require verification against real Devvit Redis. Post creation writes a durable intent and never automatically retries an ambiguous external effect; the moderator inspect/adopt actions are the repair path.
