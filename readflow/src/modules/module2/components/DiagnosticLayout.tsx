import type { ReactNode } from "react";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/nunito/latin-500.css";
import "@fontsource/nunito/latin-600.css";
import "@fontsource/nunito/latin-700.css";
import "./DiagnosticLayout.css";

interface DiagnosticLayoutProps {
  children: ReactNode;
  className?: string;
  labelledBy: string;
}

export default function DiagnosticLayout({
  children,
  className = "",
  labelledBy,
}: DiagnosticLayoutProps) {
  return (
    <main className="diagnostic-shell">
      <div
        className="diagnostic-shell__decoration diagnostic-shell__decoration--top"
        aria-hidden="true"
      />
      <div
        className="diagnostic-shell__decoration diagnostic-shell__decoration--bottom"
        aria-hidden="true"
      />

      <section
        className={`diagnostic-shell__panel ${className}`.trim()}
        aria-labelledby={labelledBy}
      >
        {children}
      </section>
    </main>
  );
}
