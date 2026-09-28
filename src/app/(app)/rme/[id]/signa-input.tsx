"use client";

import { Input } from "@/components/ui/field";
import { PRESET_SIGNA } from "@/lib/validations/doctor";
import { cn } from "@/lib/utils";

/**
 * Aturan Pakai (signa) — WAJIB untuk setiap obat maupun racikan
 * (CLAUDE.md §4). Ini teks yang nanti dicetak paling besar di etiket obat
 * dan dibaca pasien di rumah, jadi kolomnya tidak boleh kosong.
 *
 * Preset mempercepat pengetikan tetapi tidak menggantikan teks bebas —
 * dosis anak dan aturan khusus selalu perlu diketik manual.
 */
export function SignaInput({
  value,
  onChange,
  error,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  id?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink-muted">
        Aturan Pakai
        <span className="ml-0.5 text-danger" aria-label="wajib diisi">*</span>
      </label>

      <div className="flex flex-wrap gap-1">
        {PRESET_SIGNA.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-micro transition-colors",
              value === p
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {p}
          </button>
        ))}
      </div>

      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="mis. 3 x sehari 1 tablet sesudah makan"
        aria-invalid={Boolean(error)}
        maxLength={255}
      />

      {error ? (
        <p className="text-meta text-danger">{error}</p>
      ) : (
        <p className="text-meta text-ink-faint">
          Teks ini dicetak paling besar di etiket obat.
        </p>
      )}
    </div>
  );
}
