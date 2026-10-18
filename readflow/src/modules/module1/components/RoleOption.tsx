import { Check, type LucideIcon } from "lucide-react";

interface RoleOptionProps {
  description: string;
  icon: LucideIcon;
  id: string;
  isSelected: boolean;
  name: string;
  onSelect: (value: string) => void;
  title: string;
  value: string;
}

export default function RoleOption({
  description,
  icon: Icon,
  id,
  isSelected,
  name,
  onSelect,
  title,
  value,
}: RoleOptionProps) {
  return (
    <label
      className={`role-option${isSelected ? " role-option--selected" : ""}`}
      htmlFor={id}
    >
      <input
        checked={isSelected}
        className="role-option__input"
        id={id}
        name={name}
        onChange={() => onSelect(value)}
        type="radio"
        value={value}
      />

      <span className="role-option__icon" aria-hidden="true">
        <Icon size={28} strokeWidth={2.25} />
      </span>

      <span className="role-option__copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>

      <span className="role-option__indicator" aria-hidden="true">
        {isSelected && <Check size={16} strokeWidth={3} />}
      </span>
    </label>
  );
}
