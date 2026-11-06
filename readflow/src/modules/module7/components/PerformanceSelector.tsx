export interface PerformanceOption { id: string; name: string }

/** IDs remain the values; duplicate display names receive an unambiguous suffix. */
export default function PerformanceSelector({ id, label, value, options, onChange, placeholder, disabled = false, describedBy }: {
  id: string; label: string; value: string; options: PerformanceOption[];
  onChange: (value: string) => void; placeholder?: string; disabled?: boolean; describedBy?: string;
}) {
  return <label className="m7-performance-selector" htmlFor={id}>
    <span>{label}</span>
    <select id={id} value={value} disabled={disabled || !options.length} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(option => <option key={option.id} value={option.id}>
        {option.name}{options.some(other => other.id !== option.id && other.name === option.name) ? ` (${option.id})` : ''}
      </option>)}
    </select>
  </label>;
}
