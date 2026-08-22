"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** Common countries first, India defaulted per spec — not an exhaustive
 * ITU list, just enough to cover realistic demo/business use without
 * making the dropdown unwieldy. */
const COUNTRY_CODES = [
  { code: "+91", label: "India", flag: "🇮🇳", digits: 10 },
  { code: "+1", label: "US/Canada", flag: "🇺🇸", digits: 10 },
  { code: "+44", label: "UK", flag: "🇬🇧", digits: 10 },
  { code: "+971", label: "UAE", flag: "🇦🇪", digits: 9 },
  { code: "+61", label: "Australia", flag: "🇦🇺", digits: 9 },
  { code: "+65", label: "Singapore", flag: "🇸🇬", digits: 8 },
  { code: "+49", label: "Germany", flag: "🇩🇪", digits: 10 },
  { code: "+33", label: "France", flag: "🇫🇷", digits: 9 },
  { code: "+81", label: "Japan", flag: "🇯🇵", digits: 10 },
  { code: "+86", label: "China", flag: "🇨🇳", digits: 11 },
];

/**
 * Country-code dropdown (default +91/India) + digits-only local-number
 * field, combined into an E.164 string (`onChange`) as the caller types.
 * Used anywhere a phone number is collected (Patients, Bulk Calls) so the
 * format/validation behavior stays identical across both.
 */
export function PhoneInput({
  value,
  onChange,
  className,
}: {
  /** Full E.164 value, e.g. "+919876543210" — empty string when incomplete. */
  value: string;
  onChange: (e164: string) => void;
  className?: string;
}) {
  const [countryCode, setCountryCode] = useState("+91");
  const [localNumber, setLocalNumber] = useState(() => value.replace(/^\+\d+/, ""));

  const country = COUNTRY_CODES.find((c) => c.code === countryCode) ?? COUNTRY_CODES[0];

  function emit(nextCode: string, nextLocal: string) {
    const digitsOnly = nextLocal.replace(/\D/g, "");
    onChange(digitsOnly ? `${nextCode}${digitsOnly}` : "");
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <div className="relative flex-none">
        <select
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value);
            emit(e.target.value, localNumber);
          }}
          className="appearance-none bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg pl-2.5 pr-6 py-2 text-[13px] font-semibold text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.code}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-muted)]" />
      </div>
      <input
        type="tel"
        inputMode="numeric"
        value={localNumber}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, country.digits);
          setLocalNumber(digits);
          emit(countryCode, digits);
        }}
        placeholder={"5".repeat(country.digits)}
        maxLength={country.digits}
        className="flex-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-[13px] font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-violet)]/50"
      />
    </div>
  );
}
