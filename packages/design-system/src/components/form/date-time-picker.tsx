"use client"

import * as React from "react"
import { CalendarDays, X } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "../actions/button"
import { Popover, PopoverContent, PopoverTrigger } from "../overlay/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import { Calendar } from "./calendar"

/* ─── Locale helpers ─── */

function usesAmPm(locale: string): boolean {
  const resolved = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
  }).resolvedOptions()
  return resolved.hour12 === true
}

function formatDisplay(
  value: number,
  locale: string,
  mode: "date" | "datetime",
  timeZone?: string,
): string {
  const date = new Date(value)
  if (mode === "date") {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(date)
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date)
}

/* ─── Time helpers ─── */

function roundToFive(n: number): number {
  return Math.round(n / 5) * 5
}

function extractTimeParts(
  date: Date,
  is12h: boolean,
): { hour: number; minute: number; period: "AM" | "PM" } {
  const h = date.getHours()
  const minute = roundToFive(date.getMinutes())
  if (!is12h) return { hour: h, minute, period: h < 12 ? "AM" : "PM" }
  const period: "AM" | "PM" = h < 12 ? "AM" : "PM"
  let hour = h % 12
  if (hour === 0) hour = 12
  return { hour, minute, period }
}

function toHour24(hour: number, period: "AM" | "PM", is12h: boolean): number {
  if (!is12h) return hour
  if (period === "AM") return hour === 12 ? 0 : hour
  return hour === 12 ? 12 : hour + 12
}

/* ─── Component ─── */

export type DateTimePickerProps = {
  /** UTC timestamp in milliseconds, or undefined for no selection */
  value: number | undefined
  /** Called with the new UTC timestamp, or undefined when cleared */
  onChange: (value: number | undefined) => void
  /** "datetime" shows calendar + time selects; "date" shows calendar only */
  mode?: "date" | "datetime"
  /** BCP 47 locale string (e.g. "en", "de", "ja"). Defaults to "en". */
  locale?: string
  /** IANA timezone for display formatting (e.g. "America/New_York") */
  timeZone?: string
  /** Placeholder text when no date is selected */
  placeholder?: string
  /** Show a clear button when a value is set. Defaults to true. */
  clearable?: boolean
  /** Aria label for the clear button */
  clearLabel?: string
  /** Additional className for the trigger button */
  className?: string
}

function DateTimePicker({
  value,
  onChange,
  mode = "datetime",
  locale = "en",
  timeZone,
  placeholder = "Pick a date",
  clearable = true,
  clearLabel = "Clear",
  className,
}: DateTimePickerProps) {
  const is12h = mode === "datetime" ? usesAmPm(locale) : false

  const selectedDate = value ? new Date(value) : undefined
  const timeParts = selectedDate
    ? extractTimeParts(selectedDate, is12h)
    : { hour: is12h ? 12 : 0, minute: 0, period: "AM" as const }

  const [hour, setHour] = React.useState(timeParts.hour)
  const [minute, setMinute] = React.useState(timeParts.minute)
  const [period, setPeriod] = React.useState<"AM" | "PM">(timeParts.period)

  // Sync local time state when value changes externally
  React.useEffect(() => {
    if (selectedDate) {
      const parts = extractTimeParts(selectedDate, is12h)
      setHour(parts.hour)
      setMinute(parts.minute)
      setPeriod(parts.period)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildTimestamp = (
    date: Date,
    h: number,
    m: number,
    p: "AM" | "PM",
  ) => {
    const d = new Date(date)
    if (mode === "date") {
      d.setHours(0, 0, 0, 0)
    } else {
      d.setHours(toHour24(h, p, is12h), m, 0, 0)
    }
    return d.getTime()
  }

  const handleDaySelect = (day: Date) => {
    onChange(buildTimestamp(day, hour, minute, period))
  }

  const handleHourChange = (val: string) => {
    const h = parseInt(val, 10)
    setHour(h)
    if (selectedDate) onChange(buildTimestamp(selectedDate, h, minute, period))
  }

  const handleMinuteChange = (val: string) => {
    const m = parseInt(val, 10)
    setMinute(m)
    if (selectedDate) onChange(buildTimestamp(selectedDate, hour, m, period))
  }

  const handlePeriodChange = (p: string) => {
    const newPeriod = p as "AM" | "PM"
    setPeriod(newPeriod)
    if (selectedDate)
      onChange(buildTimestamp(selectedDate, hour, minute, newPeriod))
  }

  const hours = is12h
    ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    : Array.from({ length: 24 }, (_, i) => i)

  const minutes = Array.from({ length: 12 }, (_, i) => i * 5)

  const displayText = value
    ? formatDisplay(value, locale, mode, timeZone)
    : placeholder

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "justify-start text-left font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span className="truncate">{displayText}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            selected={selectedDate}
            onSelect={handleDaySelect}
            locale={locale}
          />

          {mode === "datetime" && (
            <div className="border-t border-border px-3 py-3">
              <div className="flex items-center gap-1.5">
                <Select value={String(hour)} onValueChange={handleHourChange}>
                  <SelectTrigger className="h-8 w-[60px] tabular-nums">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hours.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {String(h).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm font-medium text-muted-foreground">
                  :
                </span>
                <Select
                  value={String(minute)}
                  onValueChange={handleMinuteChange}
                >
                  <SelectTrigger className="h-8 w-[60px] tabular-nums">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {minutes.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {String(m).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {is12h && (
                  <Select value={period} onValueChange={handlePeriodChange}>
                    <SelectTrigger className="h-8 w-[62px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">AM</SelectItem>
                      <SelectItem value="PM">PM</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {clearable && value !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0"
          onClick={() => onChange(undefined)}
          aria-label={clearLabel}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

DateTimePicker.displayName = "DateTimePicker"

export { DateTimePicker }
