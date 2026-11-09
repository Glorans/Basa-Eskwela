
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  GraduationCap,
  Mic,
  BarChart3,
  Users,
  Target,
  Eye,
} from "lucide-react";

import mascot from "../assets/mascot.png";
import "./AboutUsPage.css";

const features = [
  {
    icon: <BookOpen size={28} />,
    title: "Interactive Reading",
    description:
      "Engaging English and Filipino reading materials designed to help Grade 5 learners develop their reading skills.",
  },
  {
    icon: <Mic size={28} />,
    title: "Oral Reading Activities",
    description:
      "Guided oral reading activities that help learners practice fluency, pronunciation, and reading confidence.",
  },
  {
    icon: <GraduationCap size={28} />,
    title: "Reading Comprehension",
    description:
      "Comprehension exercises that encourage students to understand, interpret, and reflect on what they read.",
  },
  {
    icon: <BarChart3 size={28} />,
    title: "Learning Progress",
    description:
      "Reading results and progress information that help learners and educators identify strengths and areas for improvement.",
  },
];

// Replace these details with your actual capstone members.
const developers = [
  {
    name: "Developer Name",
    role: "Capstone Team Member",
    image: "",
  },
  {
    name: "Developer Name",
    role: "Capstone Team Member",
    image: "",
  },
  {
    name: "Developer Name",
    role: "Capstone Team Member",
    image: "",
  },
  {
    name: "Developer Name",
    role: "Capstone Team Member",
    image: "",
  },
];

export default function AboutUsPage() {
  return (
    <main className="about-page">
      <div className="about-container">
        {/* Navigation */}
        <nav className="about-navigation">
          <Link to="/" className="about-back">
            <ArrowLeft size={18} />
            Back to Home
          </Link>

          <span className="about-nav-brand">
            Basa Eskwela
          </span>
        </nav>

        {/* Hero Section */}
        <section className="about-hero">
          <div className="about-hero-content">
            <span className="about-eyebrow">
              OUR CAPSTONE PROJECT
            </span>

            <h1>
              About <span>Basa Eskwela</span>
            </h1>

            <p>
              Basa Eskwela is a structured and interactive
              reading and comprehension learning platform
              developed to support Grade 5 students in
              strengthening their English and Filipino
              reading abilities.
            </p>

            <p>
              Through guided reading activities, oral
              reading practice, and comprehension exercises,
              our platform aims to make reading more
              engaging, accessible, and meaningful.
            </p>

            <a href="#about-mission" className="about-hero-button">
              Discover Our Purpose
            </a>
          </div>

          <div className="about-hero-visual">
            <div className="about-mascot-card">
              <img
                src={mascot}
                alt="Basa Eskwela mascot"
                className="about-mascot"
              />
            </div>
          </div>
        </section>

        {/* Mission and Vision */}
        <section
          className="about-section"
          id="about-mission"
        >
          <div className="about-section-heading">
            <span className="about-eyebrow">
              OUR PURPOSE
            </span>

            <h2>Mission &amp; Vision</h2>

            <p>
              Building a more engaging reading experience
              through technology and education.
            </p>
          </div>

          <div className="about-purpose-grid">
            <article className="about-purpose-card">
              <div className="about-icon">
                <Target size={30} />
              </div>

              <h3>Our Mission</h3>

              <p>
                To develop an interactive educational
                platform that supports Grade 5 learners
                in improving their reading fluency
                and comprehension in English and Filipino
                through accessible learning activities
                and meaningful feedback.
              </p>
            </article>

            <article className="about-purpose-card">
              <div className="about-icon">
                <Eye size={30} />
              </div>

              <h3>Our Vision</h3>

              <p>
                To contribute to a learning environment
                where young readers become more confident,
                independent, and motivated through
                engaging educational technology.
              </p>
            </article>
          </div>
        </section>

        {/* Features */}
        <section className="about-section about-features-section">
          <div className="about-section-heading">
            <span className="about-eyebrow">
              WHAT WE DO
            </span>

            <h2>Supporting Every Reading Journey</h2>

            <p>
              Basa Eskwela brings together learning tools
              that support reading practice, assessment,
              and progress monitoring.
            </p>
          </div>

          <div className="about-features-grid">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="about-feature-card"
              >
                <div className="about-icon">
                  {feature.icon}
                </div>

                <h3>{feature.title}</h3>

                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Meet the Developers */}
        <section className="about-section about-team-section">
          <div className="about-section-heading">
            <span className="about-eyebrow">
              THE PEOPLE BEHIND THE PROJECT
            </span>

            <h2>Meet the Developers</h2>

            <p>
              Basa Eskwela is developed by a team of
              capstone students who share a goal of
              making reading education more engaging
              and accessible through technology.
            </p>
          </div>

          <div className="about-team-grid">
            {developers.map((developer, index) => (
              <article
                key={index}
                className="about-developer-card"
              >
                <div className="about-developer-photo">
                  {developer.image ? (
                    <img
                      src={developer.image}
                      alt={developer.name}
                    />
                  ) : (
                    <Users
                      size={44}
                      aria-hidden="true"
                    />
                  )}
                </div>

                <h3>{developer.name}</h3>

                <p>{developer.role}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Closing Section */}
        <section className="about-closing">
          <h2>
            Learn. Read. Grow.
          </h2>

          <p>
            Every reading journey begins with a single
            page. Basa Eskwela aims to help make that
            journey more meaningful.
          </p>

          <Link to="/signup" className="about-cta">
            Get Started
          </Link>
        </section>

        {/* Footer */}
        <footer className="about-footer">
          <strong>Basa Eskwela</strong>

          <span>
            An Educational Capstone Project
          </span>

          <div className="about-footer-links">
            <Link to="/">Home</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
