import type { ReactNode } from "react";

interface M3PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export default function M3PageHeader({ eyebrow, title, description, actions }: M3PageHeaderProps) {
  return (
    <header className="m3-page-header">
      <div>
        <p className="m3-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="m3-page-description">{description}</p>
      </div>
      {actions && <div className="m3-page-actions">{actions}</div>}
    </header>
  );
}
