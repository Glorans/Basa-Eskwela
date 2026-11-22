// A short, child-friendly explanation shown on the Privacy Notice and on the one-time acknowledgment screen.
// Keep it true to what the application does today; it is not a legal document on its own.
export const KIDS_PRIVACY_POINTS = [
  "Basa Eskwela saves your readings, your answers, your points and your badges so you can see how you are doing.",
  "Your teacher can see the reading work you do in their Learning Rooms and your reading check results. Reading you practise on your own, outside a Learning Room, stays yours. Other learners cannot see your recordings, scores or answers.",
  "When you read aloud, your voice is sent to a speech service so it can be turned into text and checked.",
  "On leaderboards, other learners see a \"Reader\" code and your points. Your nickname is shown only if nicknames are switched on, and you can choose to stay a \"Reader\" or hide from the leaderboard.",
  "Never share your password. If something feels wrong, tell your teacher or a grown-up at home.",
] as const;

export default function KidsPrivacySummary() {
  return (
    <section className="terms-section" aria-label="In simple words">
      <h2>In simple words</h2>
      <ul>
        {KIDS_PRIVACY_POINTS.map((point) => <li key={point}>{point}</li>)}
      </ul>
    </section>
  );
}
