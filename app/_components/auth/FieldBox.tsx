"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function FieldBox({
  id,
  name,
  label,
  type = "text",
  required,
  minLength,
  autoComplete,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const showLabel = !focused && value.length === 0;

  return (
    <div className="flex h-12 items-center justify-between gap-4 rounded-lg border border-white/15 bg-white/5 px-4 text-[15px] leading-none">
      <input
        id={id}
        name={name}
        type={isPassword && showPassword ? "text" : type}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        aria-label={label}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1 truncate bg-transparent text-white outline-none placeholder:text-white/35"
      />
      <div className="flex shrink-0 items-center gap-3">
        {showLabel && <span className="text-white/50">{label}</span>}
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((s) => !s)}
            className="text-white/40 transition-colors hover:text-white/70"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        )}
      </div>
    </div>
  );
}
