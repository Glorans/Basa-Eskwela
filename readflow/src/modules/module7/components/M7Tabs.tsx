/** Accessible tablist (arrow keys, Home, End) for the redesigned M7 pages. Panels use `${idPrefix}-panel-${index}`. */
export default function M7Tabs({ idPrefix, label, tabs, value, onChange }: { idPrefix: string; label: string; tabs: string[]; value: number; onChange: (index: number) => void }) {
  return <div role="tablist" aria-label={label} className="m7r-tabs">
    {tabs.map((tab, index) => <button key={tab} type="button" role="tab" id={`${idPrefix}-tab-${index}`} aria-selected={value === index}
      aria-controls={`${idPrefix}-panel-${index}`} tabIndex={value === index ? 0 : -1} onClick={() => onChange(index)}
      onKeyDown={event => {
        const last = tabs.length - 1;
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + last) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
        if (next < 0) return;
        event.preventDefault(); onChange(next); document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
      }}>{tab}</button>)}
  </div>;
}
