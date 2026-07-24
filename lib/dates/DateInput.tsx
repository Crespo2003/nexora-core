'use client';

import type { InputHTMLAttributes } from 'react';
import { formatNexoraDate, formatNexoraDateTime } from './formatDate';

type CommonDateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value?: string | null;
  onValueChange?: (value: string) => void;
};

/** A browser-independent date input: always DD/MM/YYYY, never locale-dependent. */
export function DateInput({ value, onValueChange, placeholder = 'DD/MM/YYYY', inputMode = 'numeric', ...props }: CommonDateInputProps) {
  const displayValue = dateInputValue(value ?? '');
  return onValueChange
    ? <input {...props} type="text" inputMode={inputMode} placeholder={placeholder} value={displayValue} onChange={(event) => onValueChange(event.target.value)} />
    : <input {...props} type="text" inputMode={inputMode} placeholder={placeholder} defaultValue={displayValue} />;
}

/** A browser-independent date/time input with a DD/MM/YYYY date portion. */
export function DateTimeInput({ value, onValueChange, placeholder = 'DD/MM/YYYY HH:mm', inputMode = 'numeric', ...props }: CommonDateInputProps) {
  const displayValue = dateTimeInputValue(value ?? '');
  return onValueChange
    ? <input {...props} type="text" inputMode={inputMode} placeholder={placeholder} value={displayValue} onChange={(event) => onValueChange(event.target.value)} />
    : <input {...props} type="text" inputMode={inputMode} placeholder={placeholder} defaultValue={displayValue} />;
}

function dateInputValue(value: string): string {
  if (!value) return '';
  return formatNexoraDate(value, value);
}

function dateTimeInputValue(value: string): string {
  if (!value) return '';
  return formatNexoraDateTime(value, value);
}
