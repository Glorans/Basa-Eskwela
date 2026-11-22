export const SYSTEM_PERFORMANCE_TABS = ['Overview', 'Performance Trends', 'Classroom Performance', 'Student Participation', 'Learning Support'] as const;

export default function SystemPerformanceTabs({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <div role="tablist" aria-label="System performance sections" className="sp-tabs">
    {SYSTEM_PERFORMANCE_TABS.map((label, index) => <button type="button" key={label} id={`system-tab-${index}`}
      role="tab" aria-selected={value === index} aria-controls={`system-panel-${index}`} tabIndex={value === index ? 0 : -1}
      onClick={() => onChange(index)} onKeyDown={event => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % SYSTEM_PERFORMANCE_TABS.length;
        else if (event.key === 'ArrowLeft') next = (index + SYSTEM_PERFORMANCE_TABS.length - 1) % SYSTEM_PERFORMANCE_TABS.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = SYSTEM_PERFORMANCE_TABS.length - 1;
        else return;
        event.preventDefault(); onChange(next); document.getElementById(`system-tab-${next}`)?.focus();
      }}>{label}</button>)}
  </div>;
}
