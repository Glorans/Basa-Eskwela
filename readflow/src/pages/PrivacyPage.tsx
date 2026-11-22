import { Link } from "react-router-dom";
import { POLICY_REVIEW_STATUS } from "./policyStatus";
import "./TermsPage.css";
import KidsPrivacySummary from "./KidsPrivacySummary";

// Statements describe what the application does today. Keep them in step with the code;
// do not add retention periods, deletion timelines or security guarantees that are not implemented.
export const privacySections = [
  {
    title: "1. Who this notice is for",
    paragraphs: [
      "Basa Eskwela is a capstone educational project that currently permits public registration. This notice explains how information is handled when people register, complete reading activities, upload reading materials, or use teacher and administrator features.",
      "The organization responsible for this information (the personal-information controller) and its contact details have not yet been confirmed. They will be published here once confirmed and approved.",
    ],
  },
  {
    title: "2. Information the platform processes",
    paragraphs: [
      "Account and profile: your email address and password (the sign-in service stores passwords only in scrambled, hashed form, and the project team cannot read them), your role, your school, a nickname for learners or a full name for staff, whether a Teacher joined with a school invitation code (the codes themselves are stored only in hashed form), records of School Admin invitations, whether your account is active or deactivated, and the Learning Rooms you join or manage.",
      "Learning records: reading-diagnostic results; oral reading attempts, including transcripts, word-level feedback, accuracy and reading speed; saved oral reading recordings; comprehension answers and scores; experience points (XP), badges, achievements, reading streaks and daily sign-ins; your leaderboard choice (classroom nickname, \"Reader\" code or hidden for Students; chosen nickname, \"Reader\" code or hidden for Independent Learners); teacher support notes, interventions and reports about learners in their Learning Rooms; and automatic support suggestions about a learner (see section 3).",
      "Audio from the reading diagnostic is sent for speech-to-text and is not saved as a recording. Audio from read-aloud activities is saved as an oral reading recording.",
      "Uploaded materials: reading files you upload (PDF, Word or image files), the text extracted from them, and comprehension questions generated from that text. Reading text, titles and questions are checked by an automatic, rule-based content check that runs inside the project's own database; it records no result about you and sends nothing to another service.",
      "Your acknowledgment of these documents: the version, whether it was a draft or an approved version, and the time you agreed (see section 7).",
    ],
  },
  {
    title: "3. Why information is used",
    paragraphs: [
      "To create and protect accounts; run reading, oral reading and comprehension activities; give feedback and scores; show learners their own progress; let authorized teachers and administrators support learners; investigate technical problems; and evaluate and improve the capstone project.",
      "Basa Eskwela also shows automatic suggestions about learners who may need reading support: to Teachers and School Admins for Students in their school's Learning Rooms, to the System Admin for Independent Learners, and to each learner about their own reading. These suggestions come from fixed rules applied to the learner's results; no AI service is used for them. They are prompts for the teacher to consider, not decisions about the learner.",
      "Capstone research or reporting should use minimized or de-identified information where practical. A separate consent or authorization process may be needed for identifiable learner data or recordings used outside normal learning functions.",
    ],
  },
  {
    title: "4. Children and guardian involvement",
    paragraphs: [
      "The platform supports school-age learners. Public sign-up does not remove the need for appropriate parent or guardian involvement, age-appropriate notices, and any required permission or lawful basis before processing a minor's personal information or voice.",
      "Do not submit a child's identifiable information or audio without appropriate authorization. The project team must confirm its child-data consent and verification procedure before inviting real minors to use the system.",
    ],
  },
  {
    title: "5. Service providers",
    paragraphs: [
      "Supabase provides sign-in (including confirmation, password-reset and School Admin invitation emails), the database that stores accounts, profiles, uploaded-material details, reading results and assessment records, and file storage for uploaded materials and oral reading recordings.",
      "Microsoft Azure Speech receives oral reading audio (from read-aloud activities and the reading diagnostic) to convert speech to text and, for English, to assess pronunciation. It also receives short passages of text to produce read-aloud audio.",
      "Google Gemini receives the text of reading materials and passages submitted for comprehension-question generation (by Teachers, School Admins and the System Admin, and by Independent Learners for their own uploads), to create and check those questions. It does not receive audio recordings.",
      "The web application and its server are hosted on Render. Your browser loads web fonts from Google Fonts, which receives your IP address and basic browser information. Text extraction, image text recognition (OCR) and the automatic content check run on the project's own server and database; no additional moderation service is used.",
      "Processing locations and each provider's own terms are being reviewed by the project team.",
    ],
  },
  {
    title: "6. Who can see your information",
    paragraphs: [
      "You can see your own records. Approved Teachers can see the learning results, recordings and progress from work that Students do in that Teacher's own Learning Rooms, and the reading-diagnostic results of Students currently enrolled in one of their active Learning Rooms. Teachers do not see reading or quiz practice that a Student does on their own, outside a Learning Room.",
      "School Admins can manage the accounts of their own school, approve its Teachers, review its Students' learning results and reports, and oversee its uploaded materials; they cannot see other schools or Independent Learners' personal uploads. The System Admin manages schools, School Admin accounts and the shared reading-module catalog. The System Admin can see the list of all accounts on the platform (email address, name or nickname, role and school), can deactivate or reactivate accounts, and sees platform-wide summary reports. For Independent Learners, the System Admin can also see each learner's name or nickname, reading and quiz results, progress and support suggestions, but not the text or titles of the learner's own uploaded materials. In the System Admin's reports and suggestions, school Students appear only in summary counts, not individually.",
      "Each school's information is kept separate: users of one school cannot see another school's learners, classrooms, materials or results.",
      "Classroom leaderboards are visible only to active Students in the same Learning Room and show XP for the week. Classmates appear as \"Reader\" followed by a code. Classroom nicknames can be shown only if the project team switches them on for the whole platform after the required approval; this switch is currently off. Each Student can choose to show their classroom nickname (when switched on), stay a \"Reader\", or hide from the leaderboard. In an archived Learning Room, everyone appears as a \"Reader\" code. On the Independent Learner leaderboard, other Independent Learners see a \"Reader\" code. You can choose your own leaderboard nickname only if nicknames are switched on for Independent Learners (currently off), and you can also hide.",
      "An Independent Learner's personal uploads and privately generated questions are not shared with teachers. Public registration does not make student records or recordings public. Do not post other people's learner information in public pages or repositories.",
    ],
  },
  {
    title: "7. Your acknowledgment",
    paragraphs: [
      "When you create an account, you tick \"I have read and agree to the Terms of Use and Privacy Notice.\" If your agreement can be saved at that moment, Basa Eskwela records your account, the version of these documents, whether that version was a draft or an approved version, and the time. If it cannot be saved then (for example, when your email address must be confirmed first), you are asked to press \"I Agree\" the first time you sign in, and the same details are recorded. You are asked again only when a new approved version is published. Agreeing to a draft version never counts as agreeing to an approved version.",
      "Ticking the box or pressing \"I Agree\" is an acknowledgment that you were shown these documents. It is not a parent's or guardian's consent, and it does not give permission to show or publish a child's name, picture, voice or other information. Any required parent or guardian authorization, and the child's own agreement (assent), are handled separately from this acknowledgment. The process for this, and who keeps its records, have not yet been confirmed.",
    ],
  },
  {
    title: "8. Storage, retention, and removal",
    paragraphs: [
      "Information is stored with the service providers above. Read-aloud recordings and learning records are kept. Basa Eskwela has no automatic retention or deletion schedule, and database backups may be kept for recovery. Retention periods, how deletion requests are handled, and who is responsible for them have not yet been approved; they will be published here once approved.",
      "Deactivating an account stops it from being used but does not delete its existing records, including learning records and recordings. Permanent account deletion is not available in Basa Eskwela.",
      "When an Independent Learner uses \"Remove from Reading Materials\", the material is hidden from their list and can no longer be used for new practice, but the uploaded file, its saved text, any privately generated questions, and the related reading and comprehension results are kept. This is not a permanent deletion. A material uploaded by a Teacher or administrator can be permanently deleted only if no reading module uses it. Reading modules are first moved to the Trash and can be permanently deleted only if no learner has used them. Archived Learning Rooms keep their records in read-only form.",
      "No internet service can guarantee perfect security. Please use a strong password and report suspected unauthorized access once the official contact is published.",
    ],
  },
  {
    title: "9. Your choices and requests",
    paragraphs: [
      "You may ask the project team about access, correction, withdrawal of consent where applicable, objection, or deletion of personal information, subject to applicable law and legitimate retention requirements. A parent or authorized guardian may make relevant requests for a child.",
      "A working privacy contact and a verified process for handling requests will be published before this notice is used with real learners. Until then, avoid sharing sensitive information or learner recordings.",
    ],
  },
  {
    title: "10. Updates and questions",
    paragraphs: [
      "This notice will be updated if the platform, service providers, or data handling change. Material updates should be communicated before users are asked to continue under revised terms.",
      "Privacy contact and effective date: not yet published (awaiting school and adviser approval).",
    ],
  },
];

export default function PrivacyPage() {
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

          <h1>Privacy Notice</h1>

          <p className="terms-intro">
            How Basa Eskwela collects, uses, and shares
            personal information, including learner data
            and oral reading recordings.
          </p>

          <p className="terms-review-note" role="note">
            {POLICY_REVIEW_STATUS}
          </p>
        </header>

        <KidsPrivacySummary />

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
            Read Terms of Use →
          </Link>

          <Link to="/" className="terms-back-link">
            ← Return to Home
          </Link>
        </footer>
      </article>
    </main>
  );
}
