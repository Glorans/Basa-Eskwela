interface M3StatusBadgeProps {
  value: string;
  label?: string;
}

export default function M3StatusBadge({ value, label }: M3StatusBadgeProps) {
  const tone = value.toLowerCase().replace(/[_\s]+/g, "-");
  const displayLabel = label ?? (value === "pending_ocr" ? "Pending OCR" : value.replace(/_/g, " "));

  return <span className={`m3-status-badge m3-status-badge--${tone}`}>{displayLabel}</span>;
}
