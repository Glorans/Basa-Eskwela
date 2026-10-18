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
            Welcome to Basa Eskwela:
            <span>Enhancing Reading and Comprehension Skills</span>
          </h1>

          <p className="landing-description">
            Welcome to Basa Eskwela, where we empower young learners to enhance
            their English and Filipino reading fluency and comprehension
            through engaging activities.
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
