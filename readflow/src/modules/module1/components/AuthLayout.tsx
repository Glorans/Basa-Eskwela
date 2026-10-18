import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import mascot from "../../../assets/mascot.png";
import "./AuthLayout.css";

interface AuthLayoutProps {
  title: string;
  className?: string;
  subtitle?: string;
  children: ReactNode;
  /** Where the back link goes. Defaults to the landing page. */
  backTo?: string;
  /** Label shown next to the back arrow. Defaults to "Back". */
  backLabel?: string;
}

export default function AuthLayout({
  title,
  className = "",
  subtitle,
  children,
  backTo = "/",
  backLabel = "Back",
}: AuthLayoutProps) {
  return (
    <main className={`auth-page ${className}`}>
      <div className="auth-card">
        <section className="auth-brand-panel" aria-label="Basa Eskwela branding">
          <div className="auth-mascot-frame">
            <img className="auth-mascot" src={mascot} alt="Basa Eskwela mascot" />
          </div>
          <p className="auth-brand-name">Basa Eskwela</p>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-container">
            <Link className="auth-back-link" to={backTo}>
              <ArrowLeft size={17} aria-hidden="true" />
              {backLabel}
            </Link>
            <header className="auth-header">
              <h1 className="auth-heading">{title}</h1>
              {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            </header>

            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
