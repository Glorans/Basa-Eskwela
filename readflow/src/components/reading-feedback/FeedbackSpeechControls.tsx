import { LoaderCircle, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { getActivityText, type ActivityLanguage, type ActivityText } from "../../pages/reading-activity/activityLanguage";
import { getFeedbackSpeech } from "../../services/feedbackSpeech";
import { feedbackSpeechKey } from "../../services/feedbackSpeechPlayer";
import "./ReadingFeedback.css";

interface FeedbackSpeechControlsProps {
  /** Exactly the text shown on screen, in the activity language. */
  text: string;
  language: ActivityLanguage;
  /** What the listen button reads, e.g. "Listen to the hint". */
  listenLabel?: ActivityText;
  /** Blocks playback, e.g. while the microphone is recording. */
  disabled?: boolean;
  showMute?: boolean;
}

/** Re-renders when the shared player changes. */
export function useFeedbackSpeechState() {
  const player = getFeedbackSpeech();
  const [, setVersion] = useState(0);
  useEffect(() => player.subscribe(() => setVersion((value) => value + 1)), [player]);
  return player.getState();
}

/** Listen / Stop / sound on-off for one piece of feedback. Never plays on its own. */
export default function FeedbackSpeechControls({
  text, language, listenLabel = "Listen", disabled = false, showMute = false,
}: FeedbackSpeechControlsProps) {
  const { t } = getActivityText(language);
  const player = getFeedbackSpeech();
  const state = useFeedbackSpeechState();
  const [played, setPlayed] = useState(false);
  const key = feedbackSpeechKey(text, language);
  const mine = state.key === key;
  const active = mine && (state.status === "loading" || state.status === "playing");

  // Leaving the page (or a new message replacing this one) stops this clip.
  useEffect(() => () => player.stopIf(key), [player, key]);
  useEffect(() => { if (disabled) player.stopIf(key); }, [player, key, disabled]);
  useEffect(() => setPlayed(false), [key]);

  if (!text.trim()) return null;

  return (
    <span className="feedback-speech">
      {!state.muted && (active ? (
        <button type="button" className="feedback-speech-button" onClick={() => player.stop()}
          aria-label={state.status === "loading" ? t("Loading audio...") : t("Stop audio")}>
          {state.status === "loading"
            ? <LoaderCircle className="feedback-speech-spinner" size={18} aria-hidden="true" />
            : <Square size={16} fill="currentColor" aria-hidden="true" />}
        </button>
      ) : (
        <button type="button" className="feedback-speech-button" disabled={disabled}
          aria-label={played ? t("Listen again") : t(listenLabel)}
          onClick={() => { setPlayed(true); void player.play(text, language, key); }}>
          <Volume2 size={18} aria-hidden="true" />
        </button>
      ))}
      {showMute && (
        <button type="button" className="feedback-speech-button feedback-speech-button--mute"
          aria-pressed={state.muted} onClick={() => player.setMuted(!state.muted)} aria-label={t("Mute audio")}>
          <VolumeX size={18} aria-hidden="true" />
        </button>
      )}
      {mine && state.status === "error" && (
        <span className="feedback-speech-error" role="alert">{t("Audio is unavailable right now. Please try again.")}</span>
      )}
    </span>
  );
}
