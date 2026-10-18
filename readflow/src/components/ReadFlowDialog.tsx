import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

type DialogKind = "confirmation" | "success" | "error" | "warning";
let dialogOpen = false;

function Dialog({ message, kind, finish }: { message: string; kind: DialogKind; finish: (value: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby="readflow-dialog-title" aria-describedby="readflow-dialog-message"
    onCancel={event => { event.preventDefault(); finish(false); }}
    className="w-[min(92vw,28rem)] rounded-3xl border-0 bg-white p-6 text-[#173f3b] shadow-xl backdrop:bg-[#173f3b]/60">
    <h2 id="readflow-dialog-title" className="text-xl font-extrabold">{kind === "confirmation" ? "Please confirm" : kind === "error" ? "Something went wrong" : kind === "success" ? "Success" : "Please check"}</h2>
    <p id="readflow-dialog-message" className="my-5 whitespace-pre-wrap break-words">{message}</p>
    <div className="flex justify-end gap-3">
      {kind === "confirmation" && <button autoFocus className="rounded-xl bg-[#dce8e7] px-5 py-3 font-bold" onClick={() => finish(false)}>Cancel</button>}
      <button autoFocus={kind !== "confirmation"} className="rounded-xl bg-[#f7cf4a] px-5 py-3 font-bold" onClick={() => finish(true)}>{kind === "confirmation" ? "Confirm" : "OK"}</button>
    </div>
  </dialog>;
}

export function showReadFlowDialog(message: string, kind: DialogKind = "error"): Promise<boolean> {
  if (dialogOpen) return Promise.resolve(false);
  dialogOpen = true;
  const previousFocus = document.activeElement;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return new Promise(resolve => {
    let finished = false;
    root.render(<Dialog message={message} kind={kind} finish={value => {
      if (finished) return;
      finished = true;
      root.unmount();
      host.remove();
      dialogOpen = false;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(value);
    }} />);
  });
}

export const confirmReadFlow = (message: string) => showReadFlowDialog(message, "confirmation");
