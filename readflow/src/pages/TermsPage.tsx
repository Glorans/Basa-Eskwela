import { Link } from "react-router-dom";
import { POLICY_REVIEW_STATUS } from "./policyStatus";
import "./TermsPage.css";

export const termsSections = [
  {
    title: "1. About Basa Eskwela",
    paragraphs: [
      "Basa Eskwela is an educational platform developed as a capstone project to support Grade 5 learners with English and Filipino reading, oral reading activities, comprehension exercises, and learning progress tracking. These Terms of Use explain the rules for using the platform.",
      "By creating an account or using Basa Eskwela, you agree to follow these terms. If you do not agree, please do not create an account or use the platform.",
    ],
  },
  {
    title: "2. Learners, teachers, and guardians",
    paragraphs: [
      "Basa Eskwela has five kinds of accounts: Students, who join their school's Learning Rooms; Independent Learners, who practise on their own; Teachers, who join with an invitation code from their school and are approved by a School Admin of that school; School Admins, who manage their own school; and the System Admin, who manages the platform.",
      "Basa Eskwela currently accepts public registration for educational and capstone evaluation purposes. Public registration does not grant access to private learner records, classroom information, or teacher and administrator functions. Role-based features remain subject to applicable verification and authorization.",
      "Learners who are minors should participate with the knowledge and involvement of a parent or legal guardian. A guardian or authorized school representative should review the Privacy Notice and ensure appropriate permission before a child submits personal information or voice recordings. Do not register or upload a child's information if the required permission has not been obtained.",
      "Any required parent or guardian authorization, and the child's own agreement (assent), are handled separately from the acknowledgment in Basa Eskwela. The process for this, and who keeps its records, have not yet been confirmed.",
    ],
  },
  {
    title: "3. Accounts and access",
    paragraphs: [
      "Provide accurate registration and profile information. Keep account credentials private, use your assigned role appropriately, and report suspected unauthorized access to the project or school administrator.",
      "Do not access another person's account, impersonate another user, or attempt to bypass role restrictions. Account access may be limited when needed to protect learners, maintain platform security, or respond to misuse.",
      "A School Admin (for their own school) or the System Admin can deactivate an account and can reactivate it later. A deactivated account cannot be used, but its existing records, including learning records and recordings, are kept. Permanent account deletion is not available in Basa Eskwela.",
    ],
  },
  {
    title: "4. Appropriate educational use",
    paragraphs: [
      "Use Basa Eskwela for legitimate learning, teaching, and assessment activities. Do not upload harmful, abusive, unlawful, or inappropriate content; interfere with the platform; or attempt to access information you are not authorized to see.",
      "Teachers and administrators are responsible for reviewing learning materials and using learner results fairly and appropriately. Scores, fluency indicators, and automated feedback are learning aids, not a substitute for a teacher's professional judgment.",
      "Reading files can be uploaded as PDF (up to 5 pages), Word (DOCX), JPG or PNG, up to 25 MB. Reading text, titles, questions, answer choices and answer keys are checked automatically for clearly unsuitable language, personal information (such as phone numbers, e-mail addresses or ID numbers) and web links before they can be saved, published or assigned. This automatic check is preliminary: it does not find everything and does not replace a teacher's review.",
    ],
  },
  {
    title: "5. Information and voice recordings",
    paragraphs: [
      "Depending on the activities used, Basa Eskwela may process account and profile information, role and class membership, reading activity submissions, comprehension answers, learning progress, and audio submitted for oral reading activities.",
      "This information is used to operate learning features, provide feedback, display progress, and support authorized teacher or administrator review. Only submit recordings and personal information when you are authorized to do so. Do not record or upload another person without appropriate permission.",
      "Please read our separate Privacy Notice for categories of data, purposes, service providers, who can see information, and requests about personal information.",
      "When an Independent Learner removes an uploaded material from their Reading Materials, it is hidden from their list but is not permanently deleted. A material uploaded by a Teacher or administrator can be permanently deleted only if no reading module uses it. Reading modules are first moved to the Trash and can be permanently deleted only if no learner has used them. See the Privacy Notice.",
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
      "The project team may revise these terms when features, school requirements, or data-handling practices change. When a new approved version of these Terms and the Privacy Notice is published, every user is asked to read it and press \"I Agree\" once before continuing. Agreeing to a draft version does not count as agreeing to a later approved version.",
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
          <Link to="/" className="terms-back-link">
            ← Basa Eskwela home
          </Link>

          <p className="terms-eyebrow">
            BASA ESKWELA · CAPSTONE PROJECT
          </p>

          <h1>Terms of Use</h1>

          <p className="terms-intro">
            Please read these terms and our{" "}
            <Link to="/privacy">
              Privacy Notice
            </Link>{" "}
            before creating an account or using Basa Eskwela.
          </p>

          <p className="terms-review-note" role="note">
            {POLICY_REVIEW_STATUS}
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
          <Link to="/" className="terms-back-link">
            ← Basa Eskwela home
          </Link>

          <Link to="/privacy" className="terms-back-link">
            Read Privacy Notice →
          </Link>
        </footer>
      </article>
    </main>
  );
}
