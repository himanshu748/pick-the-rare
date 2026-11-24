import { telemetry } from '@devvit/analytics/client/reddit';

export type FunnelEvent =
  | 'post_view' | 'first_interaction' | 'attempt_start' | 'attempt_complete'
  | 'share_comment' | 'return_next_day' | 'reveal_view'
  | 'question_submitted' | 'ballot_vote';

// Single analytics boundary. Journeys receipts are denied for unapproved apps
// (JOURNEY_RECEIPT_DENIED_PLAYTEST), so every call is fire-and-forget.
export async function track(event: FunnelEvent, details: Record<string, string | number | boolean> = {}): Promise<void> {
  const actionDetails = JSON.stringify(details).slice(0, 200);
  try {
    switch (event) {
      case 'post_view':
        await telemetry.startJourney();
        await telemetry.appReady();
        break;
      case 'attempt_start':
        await telemetry.progress({ progress: 0.5, action: event, actionDetails });
        break;
      case 'attempt_complete':
        await telemetry.endJourney({ complete: true, game: { win: false, score: typeof details.points === 'number' ? details.points : 0 } });
        await telemetry.interaction({ action: event, actionDetails });
        break;
      case 'reveal_view':
        await telemetry.progress({ progress: 1, action: event, actionDetails });
        break;
      default:
        await telemetry.interaction({ action: event, actionDetails });
    }
  } catch {
    // Telemetry is best-effort and unavailable during playtest.
  }
}
