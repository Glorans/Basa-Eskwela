
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { termsSections } from "../../../pages/TermsPage";
import { privacySections } from "../../../pages/PrivacyPage";

import "./PolicyModal.css";

type Policy = "terms" | "privacy";

interface PolicyModalProps {
  policy: Policy | null;
  onClose: () => void;
  onSwitch: (policy: Policy) => void;
}

export default function PolicyModal({
  policy,
  onClose,
  onSwitch,
}: PolicyModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (policy && !dialog.open) {
      dialog.showModal();
    }

    if (!policy && dialog.open) {
      dialog.close();
    }
  }, [policy]);

  const isTerms = policy === "terms";

  const sections = isTerms
    ? termsSections
    : privacySections;

  const title = isTerms
    ? "Terms and Conditions"
    : "Privacy Policy";

  return (
    <dialog
      ref={dialogRef}
      className="auth-policy-dialog"
      aria-labelledby="auth-policy-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {policy && (
        <div className="auth-policy-dialog-inner">
          <header className="auth-policy-dialog-header">
            <div>
              <p className="auth-policy-kicker">
                BASA ESKWELA · CAPSTONE PROJECT
              </p>

              <h2 id="auth-policy-title">
                {title}
              </h2>
            </div>

            <button
              type="button"
              className="auth-policy-close"
              onClick={onClose}
              aria-label="Close policy"
            >
              <X size={22} aria-hidden="true" />
            </button>
          </header>

          <div
            className="auth-policy-dialog-content"
            tabIndex={0}
          >
            <p className="auth-policy-note">
              <strong>Draft for project review:</strong>{" "}
              The capstone team must approve this policy
              and verify its privacy practices and contact
              details before public rollout.
            </p>

            {sections.map((section) => (
              <section
                key={section.title}
                className="auth-policy-section"
              >
                <h3>{section.title}</h3>

                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>

          <footer className="auth-policy-dialog-footer">
            <button
              type="button"
              className="auth-policy-switch"
              onClick={() =>
                onSwitch(isTerms ? "privacy" : "terms")
              }
            >
              {isTerms
                ? "View Privacy Policy"
                : "View Terms and Conditions"}
            </button>

            <button
              type="button"
              className="auth-policy-done"
              onClick={onClose}
            >
              I Understand
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
