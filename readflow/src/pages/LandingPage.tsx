import { Link } from "react-router-dom";
import mascot from "../assets/mascot.png";
import "./LandingPage.css";

export default function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-container">
        <section className="landing-mascot-card" aria-label="Basa Eskwela mascot">
          <div className="landing-mascot-frame">
            <img
              className="landing-mascot"
              src={mascot}
              alt="Basa Eskwela mascot"
              draggable="false"
            />
          </div>
          <p className="landing-brand">Basa Eskwela</p>
        </section>

        <section className="landing-content">
          <h1 className="landing-title">
            Basa Eskwela:{" "}
            <span>
              A Structured and Interactive Reading and Comprehension Learning
              Platform
            </span>
          </h1>

          <p className="landing-description">
            Basa Eskwela is a structured and interactive learning platform designed
            to help Grade 5 students improve their English and Filipino reading
            fluency and comprehension through guided reading activities, oral
            reading assessments, and comprehension exercises.
          </p>

          <div className="landing-actions" aria-label="Authentication options">
            <Link className="landing-primary-action" to="/signup">
              Get Started
            </Link>
            <Link className="landing-secondary-action" to="/login">
              Log In
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
