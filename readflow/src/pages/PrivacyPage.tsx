
import { Link } from "react-router-dom";
import "./TermsPage.css";

export const privacySections = [
  {
    title: "1. Who this notice is for",
    paragraphs: [
      "Basa Eskwela is a capstone educational project that currently permits public registration. This notice explains how information may be handled when people register, complete reading activities, or use teacher and administrator features. The capstone team is responsible for verifying and publishing the identity and contact information of the actual personal-information controller before collecting real user data.",
      "This is a project-review draft, not a promise that every described process has already been implemented or audited.",
    ],
  },
  {
    title: "2. Information the platform may process",
    paragraphs: [
      "Account and profile details may include email addresses, role selections, names or profile information, and class or teacher associations. Authentication credentials are processed through the configured authentication provider; do not include passwords in support requests.",
      "Learning data may include reading passages assigned or attempted, answers, scores, diagnostic results, pronunciation or fluency indicators, progress, teacher feedback, and classroom activity records.",
      "Oral reading features may process microphone audio or uploaded recordings, transcripts, and speech-assessment results. Basic technical data required for security, troubleshooting, and service operation may also be handled.",
    ],
  },
  {
    title: "3. Why information is used",
    paragraphs: [
      "Information may be used to create and protect accounts; enable learning activities; assess reading and comprehension; show learner progress; support authorized teaching and administration; investigate technical problems; and evaluate or improve the capstone project.",
      "Capstone research or reporting should use minimized or de-identified information where practical. A separate consent or authorization process may be needed for identifiable learner data or recordings used outside normal learning functions.",
    ],
  },
  {
    title: "4. Children and guardian involvement",
    paragraphs: [
      "The platform supports school-age learners. Public sign-up does not remove the need for appropriate parent or guardian involvement, age-appropriate notices, and any required permission or lawful basis before processing a minor's personal information or voice.",
      "Do not submit a child's identifiable information or audio without appropriate authorization. The capstone team must confirm its child-data consent and verification procedure before inviting real minors to use the system.",
    ],
  },
  {
    title: "5. Services and sharing",
    paragraphs: [
      "The codebase includes integrations or configuration for Supabase authentication and storage/database features, and speech-processing services such as Google and Microsoft Azure. Which providers receive specific data depends on the enabled feature and deployment configuration; the project team must verify actual data flows, processing locations, and vendor terms.",
      "Information should be accessible only to users and project personnel authorized for an appropriate purpose. Public registration does not mean student records or recordings are intended to be public. Do not post other people's learner information in public pages or repositories.",
    ],
  },
  {
    title: "6. Storage, retention, and security",
    paragraphs: [
      "Information may be stored in the services configured for the deployed application. The capstone team must document how long each data category and backup is retained, when deletion occurs, and which technical and organizational safeguards are actually in place. No retention period or guaranteed deletion timeframe is claimed here.",
      "No internet service can guarantee perfect security. Please use a strong password and report suspected unauthorized access through the official project contact once published.",
    ],
  },
  {
    title: "7. Your choices and requests",
    paragraphs: [
      "You may ask the project team about access, correction, withdrawal of consent where applicable, objection, or deletion of personal information, subject to applicable law and legitimate retention requirements. A parent or authorized guardian may make relevant requests for a child.",
      "The project team must publish a working privacy-contact address and a verified process for reviewing and responding to requests before this notice is used with real learners. Until that channel is available, avoid sharing sensitive information or learner recordings.",
    ],
  },
  {
    title: "8. Updates and questions",
    paragraphs: [
      "This notice may be updated if the platform, service providers, or data handling changes. Material updates should be communicated before users are asked to continue under revised terms.",
      "Privacy contact: To be supplied and verified by the Basa Eskwela capstone team before public rollout. Effective date: To be set upon project-team approval.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="terms-page">
      <article className="terms-document">
        <header className="terms-header">
          <Link to="/signup" className="terms-back-link">
            ← Back to Sign Up
          </Link>

          <p className="terms-eyebrow">
            BASA ESKWELA · CAPSTONE PROJECT
          </p>

          <h1>Privacy Policy</h1>

          <p className="terms-intro">
            How Basa Eskwela may collect, use, and protect
            personal information, including learner data
            and oral reading recordings.
          </p>

          <p className="terms-review-note">
            <strong>Draft for project review:</strong>{" "}
            Confirm the actual data flows, child-data
            permissions, retention rules, and official
            privacy contact before using this notice
            with real participants.
          </p>
        </header>

        {privacySections.map((section) => (
          <section
            className="terms-section"
            key={section.title}
          >
            <h2>{section.title}</h2>

            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <footer className="terms-footer">
          <Link to="/terms" className="terms-back-link">
            Read Terms and Conditions →
          </Link>

          <Link to="/signup" className="terms-back-link">
            ← Return to Sign Up
          </Link>
        </footer>
      </article>
    </main>
  );
}
