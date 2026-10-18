import "./AuthSubmitButton.css";

interface AuthSubmitButtonProps {
  label: string;
  submitting: boolean;
  submittingLabel: string;
  disabled?: boolean;
}

export default function AuthSubmitButton({
  label,
  submitting,
  submittingLabel,
  disabled = false,
}: AuthSubmitButtonProps) {
  return (
    <button
      className="auth-submit"
      disabled={disabled || submitting}
      type="submit"
    >
      {submitting ? submittingLabel : label}
    </button>
  );
}
