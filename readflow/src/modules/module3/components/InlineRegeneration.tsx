import { useId } from 'react';

export default function InlineRegeneration({ disabled, isGenerating, onGenerate }: {
  disabled: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  const descriptionId = useId();
  return <div className="m3-inline-regeneration">
    <h3>Need another set?</h3>
    <p id={descriptionId}>Generating a new set will replace the current saved question bank.</p>
    <button type="button" className="m3-button m3-button--coral" disabled={disabled}
      aria-busy={isGenerating} aria-describedby={descriptionId} onClick={onGenerate}>
      {isGenerating ? 'Generating questions...' : 'Generate New Set'}
    </button>
  </div>;
}
