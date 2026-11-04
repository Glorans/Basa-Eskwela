import { bankSizeOptionLabel } from "../utils/passageBankSize.ts";

// Per-passage bank size. Renders nothing until the database reports more than one size,
// so staging without the 6/9/12 migration keeps the six-question editor unchanged.
export default function BankSizeSelect({ sizes, value, disabled, onChange }: {
  sizes: readonly number[];
  value: number;
  disabled: boolean;
  onChange: (size: number) => void;
}) {
  if (sizes.length < 2) return null;
  return <label className="m3-field m3-bank-size">
    <span>Number of questions</span>
    <select value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
      {sizes.map((size) => <option key={size} value={size}>{bankSizeOptionLabel(size)}</option>)}
    </select>
  </label>;
}
