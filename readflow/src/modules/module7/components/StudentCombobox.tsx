import { useEffect, useMemo, useRef, useState } from 'react';

type Option = { id: string; name: string };
/** A selection is committed only by clicking an option or pressing Enter. Names are never identifiers. */
export default function StudentCombobox({ id, value, options, onChange, disabled = false, describedBy }: {
  id: string; value: string; options: Option[]; onChange: (id: string) => void; disabled?: boolean; describedBy?: string;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1), [limit, setLimit] = useState(50);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);
  const indexed = useMemo(() => options.map(option => ({ ...option, search: option.name.toLocaleLowerCase() })), [options]);
  const matches = useMemo(() => indexed.filter(option => option.search.includes((query ?? '').trim().toLocaleLowerCase())), [indexed, query]);
  const nameCounts = useMemo(() => { const counts = new Map<string, number>(); options.forEach(option => counts.set(option.name, (counts.get(option.name) ?? 0) + 1)); return counts; }, [options]);
  const selected = options.find(option => option.id === value);
  const expanded = open && !disabled;
  const activeIndex = active >= 0 && active < matches.length ? active : -1;
  useEffect(() => { setQuery(null); setOpen(false); setActive(-1); setLimit(50); }, [value, options, disabled]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const choose = (option: Option) => { onChange(option.id); setQuery(null); setOpen(false); setActive(-1); };
  const move = (index: number) => { setOpen(true); setActive(index); setLimit(current => Math.max(current, index + 1)); };
  return <div className="asp-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery(null); setActive(-1); } }}>
    <label htmlFor={id}>Search or Select Student</label>
    <div className="asp-combobox-field">
      <input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={`${id}-options`} aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${matches[activeIndex].id}` : undefined}
        aria-describedby={describedBy} disabled={disabled} placeholder="Type a student's name or choose from the list..."
        value={query ?? selected?.name ?? ''} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); setLimit(50); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); move(matches.length ? Math.min(activeIndex + 1, matches.length - 1) : -1); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); move(matches.length ? activeIndex <= 0 ? matches.length - 1 : activeIndex - 1 : -1); }
          else if (expanded && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); move(event.key === 'Home' ? (matches.length ? 0 : -1) : matches.length - 1); }
          else if (expanded && event.key === 'Enter') { event.preventDefault(); if (activeIndex >= 0) choose(matches[activeIndex]); }
          else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(null); setActive(-1); }
          else if (event.key === 'Tab') { setOpen(false); setQuery(null); }
        }} />
      {(value || query) && <button type="button" aria-label="Clear student selection" disabled={disabled} onClick={() => { onChange(''); setQuery(null); setOpen(false); setActive(-1); input.current?.focus(); }}>Clear</button>}
    </div>
    <div className="asp-combobox-menu" hidden={!expanded}>
      <ul ref={list} id={`${id}-options`} role="listbox" aria-label="Eligible students">
        {matches.slice(0, limit).map((option, index) => <li key={option.id} id={`${id}-option-${option.id}`} role="option" aria-selected={activeIndex === index}
          aria-posinset={index + 1} aria-setsize={matches.length} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <span>{option.name}</span>{(nameCounts.get(option.name) ?? 0) > 1 && <small>ID: {option.id}</small>}
          {value === option.id && <small>Selected</small>}
        </li>)}
      </ul>
      {!matches.length && <p role="status">No matching students found</p>}
      {matches.length > limit && <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setLimit(current => current + 50); input.current?.focus(); }}>Show more students ({matches.length - limit} remaining)</button>}
      <p className="asp-meta">{matches.length} eligible {matches.length === 1 ? 'student' : 'students'} · Use arrow keys and Enter to select</p>
    </div>
  </div>;
}
