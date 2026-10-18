import { getActivityText, type ActivityLanguage } from "../../../pages/reading-activity/activityLanguage";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOralReadingAttempt } from "../services/oralReadingService";
import type { OralReadingAttempt } from "../types/oralReading";

export default function OralReadingSummary({ attemptId, language }: { attemptId: string; language?: ActivityLanguage }) {
  const [loadedAttempt, setAttempt] = useState<OralReadingAttempt>();
  const attempt = loadedAttempt?.id === attemptId ? loadedAttempt : undefined;
  const ui = getActivityText(attempt ? attempt.language : language);
  const { t } = ui;
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setAttempt(undefined);
    setError("");
    void getOralReadingAttempt(attemptId).then(saved => { if (active) setAttempt(saved); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to load oral reading."); });
    return () => { active = false; };
  }, [attemptId, retry]);
  return <section className="m6-card" aria-label={t("Oral Reading")}>
    <h2>{t("Oral Reading")}</h2>
    {error ? <p role="alert">{ui.message(error, "Unable to load oral reading.")} <button onClick={() => setRetry(value => value + 1)}>{t("Retry")}</button></p>
      : !attempt ? <p role="status">{t("Loading oral reading...")}</p> : <>
        <p>{t("Pronunciation accuracy (transcript-based): ")}<strong>{Math.round(attempt.pronunciationAccuracy)}%</strong>.{" "}
          <Link state={{ readingActivityLanguage: ui.language }} to={`/dashboard/read-aloud/results/${attempt.id}`}>{t("See my reading feedback")}</Link></p>
      </>}
  </section>;
}
