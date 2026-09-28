"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-md border border-rule px-3 py-1.5 text-sm print:hidden">
      Save as PDF
    </button>
  );
}
