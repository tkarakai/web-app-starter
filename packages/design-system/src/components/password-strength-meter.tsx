"use client";

import * as React from "react";

import { formatCrackTime } from "../lib/password-validation";

export type PasswordStrengthTranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** Shape of the server-side password strength evaluation result. */
export interface PasswordStrengthResult {
  valid: boolean;
  score: number;
  warningKey: string | null;
  suggestionKeys: string[];
  crackTimeSeconds: number;
  tooShort: boolean;
  minLength: number;
}

const SCORE_COLORS = [
  "bg-destructive", // 0 — very weak
  "bg-destructive", // 1 — weak
  "bg-orange-500", // 2 — fair
  "bg-yellow-500", // 3 — good
  "bg-green-600", // 4 — strong
] as const;

const SCORE_LABEL_KEYS = [
  "labels.veryWeak",
  "labels.weak",
  "labels.fair",
  "labels.good",
  "labels.strong",
] as const;

export interface PasswordStrengthMeterProps {
  /** Result from the server-side passwordStrength.evaluate query. */
  result: PasswordStrengthResult | null | undefined;
  t: PasswordStrengthTranslateFn;
}

function PasswordStrengthMeter({
  result,
  t,
}: PasswordStrengthMeterProps): React.ReactNode {
  if (!result) return null;

  const barColor = SCORE_COLORS[result.score];
  const barWidth = ((result.score + 1) / 5) * 100;
  const label = t(SCORE_LABEL_KEYS[result.score]);

  // Build feedback parts
  const feedbackParts: string[] = [];
  if (result.tooShort) {
    feedbackParts.push(t("minLength", { count: result.minLength }));
  }
  if (result.warningKey) {
    feedbackParts.push(t(result.warningKey));
  }
  for (const key of result.suggestionKeys) {
    feedbackParts.push(t(key));
  }
  const feedback = feedbackParts.join(" ");

  const crackTime = result.crackTimeSeconds > 0
    ? formatCrackTime(result.crackTimeSeconds, t)
    : null;

  return (
    <div className="space-y-1.5">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out ${barColor}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="text-xs font-medium text-muted-foreground min-w-[4rem] text-right">
          {label}
        </span>
      </div>

      {/* Crack time */}
      {crackTime ? (
        <p className="text-xs text-muted-foreground">
          {t("crackTimeLabel", { time: crackTime })}
        </p>
      ) : null}

      {/* Feedback */}
      {feedback ? (
        <p className="text-xs text-muted-foreground">{feedback}</p>
      ) : null}
    </div>
  );
}

export { PasswordStrengthMeter };
