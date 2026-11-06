const labels = ['Class Performance', 'Student Performance'];

export default function PerformanceTabs({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <div role="tablist" aria-label="Classroom and student performance" className="m7-tabs">
    {labels.map((label, index) => <button type="button" key={label} id={`performance-tab-${index}`} role="tab"
      aria-selected={value === index} aria-controls={`performance-panel-${index}`} tabIndex={value === index ? 0 : -1}
      onClick={() => onChange(index)} onKeyDown={event => {
        let next: number;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 1;
        else return;
        event.preventDefault(); onChange(next);
        document.getElementById(`performance-tab-${next}`)?.focus();
      }}>{label}</button>)}
  </div>;
}
