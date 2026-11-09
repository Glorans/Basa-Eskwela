
import { Link } from "react-router-dom";
import "./TermsPage.css";

export const termsSections = [
  {
    title: "1. About Basa Eskwela",
    paragraphs: [
      "Basa Eskwela is an educational platform developed as a capstone project to support Grade 5 learners with English and Filipino reading, oral reading activities, comprehension exercises, and learning progress tracking. These Terms and Conditions explain the rules for using the platform.",
      "By creating an account or using Basa Eskwela, you agree to follow these terms. If you do not agree, please do not create an account or use the platform.",
    ],
  },
  {
    title: "2. Learners, teachers, and guardians",
    paragraphs: [
      "Basa Eskwela currently accepts public registration for educational and capstone evaluation purposes. Public registration does not grant access to private learner records, classroom information, or teacher and administrator functions. Role-based features remain subject to applicable verification and authorization.",
      "Learners who are minors should participate with the knowledge and involvement of a parent or legal guardian. A guardian or authorized school representative should review the Privacy Policy and ensure appropriate permission before a child submits personal information or voice recordings. Do not register or upload a child's information if the required permission has not been obtained.",
    ],
  },
  {
    title: "3. Accounts and access",
    paragraphs: [
      "Provide accurate registration and profile information. Keep account credentials private, use your assigned role appropriately, and report suspected unauthorized access to the project or school administrator.",
      "Do not access another person's account, impersonate another user, or attempt to bypass role restrictions. Account access may be limited when needed to protect learners, maintain platform security, or respond to misuse.",
    ],
  },
  {
    title: "4. Appropriate educational use",
    paragraphs: [
      "Use Basa Eskwela for legitimate learning, teaching, and assessment activities. Do not upload harmful, abusive, unlawful, or inappropriate content; interfere with the platform; or attempt to access information you are not authorized to see.",
      "Teachers and administrators are responsible for reviewing learning materials and using learner results fairly and appropriately. Scores, fluency indicators, and automated feedback are learning aids, not a substitute for a teacher's professional judgment.",
    ],
  },
  {
    title: "5. Information and voice recordings",
    paragraphs: [
      "Depending on the activities used, Basa Eskwela may process account and profile information, role and class membership, reading activity submissions, comprehension answers, learning progress, and audio submitted for oral reading activities.",
      "This information is used to operate learning features, provide feedback, display progress, and support authorized teacher or administrator review. Only submit recordings and personal information when you are authorized to do so. Do not record or upload another person without appropriate permission.",
      "Please read our separate Privacy Policy for categories of data, purposes, service providers, and requests about personal information. The project team must confirm actual retention and deletion practices before collecting real learner data.",
    ],
  },
  {
    title: "6. Learning content and ownership",
    paragraphs: [
      "Reading passages, images, audio, and other materials may belong to their respective creators or rights holders. Upload or share only content you have permission to use, and respect school policies and copyright requirements.",
      "Do not copy, redistribute, or commercially reuse platform materials without the appropriate authorization.",
    ],
  },
  {
    title: "7. Availability and assessment limitations",
    paragraphs: [
      "Basa Eskwela is a capstone learning platform and may change during testing and evaluation. Features may be interrupted or contain errors. Where possible, users should verify important results with a teacher or project administrator.",
      "The platform is intended to assist educational activities and does not guarantee a particular learning outcome or an error-free assessment.",
    ],
  },
  {
    title: "8. Changes and account concerns",
    paragraphs: [
      "The project team may revise these terms when features, school requirements, or data-handling practices change. Updated terms should be made available to users, and material changes should be brought to their attention before continued use is required.",
      "For account access, correction, removal requests, or concerns about a learner's data, contact the designated Basa Eskwela capstone project administrator through the official channel once published. The project team must publish a verified privacy contact before collecting real learner data.",
    ],
  },
  {
    title: "9. Questions about these terms",
    paragraphs: [
      "If you have questions or do not understand any part of these terms, ask a parent or guardian, an educator, or the capstone project team before signing up.",
    ],
  },
];

export default function TermsPage() {
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

          <h1>Terms and Conditions</h1>

          <p className="terms-intro">
            Please read these terms and our{" "}
            <Link to="/privacy">
              Privacy Policy
            </Link>{" "}
            before creating an account or using Basa Eskwela.
          </p>

          <p className="terms-review-note">
            <strong>Draft for project review:</strong>{" "}
            The capstone project team must approve these terms and
            complete the privacy and contact details before using
            the system with real learners.
          </p>
        </header>

        {termsSections.map((section) => (
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
          <Link to="/signup" className="terms-back-link">
            ← Return to Sign Up
          </Link>

          <Link to="/privacy" className="terms-back-link">
            Read Privacy Policy →
          </Link>
        </footer>
      </article>
    </main>
  );
}
