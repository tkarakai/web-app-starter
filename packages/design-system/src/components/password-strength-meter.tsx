"use client";

import * as React from "react";

import {
  validatePassword,
  formatCrackTime,
  getMinPasswordLength,
  type PasswordRole,
} from "../lib/password-validation";

export type PasswordStrengthTranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

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

interface PasswordStrengthMeterProps {
  password: string;
  email: string;
  role: PasswordRole;
  t: PasswordStrengthTranslateFn;
}

function PasswordStrengthMeter({
  password,
  email,
  role,
  t,
}: PasswordStrengthMeterProps): React.ReactNode {
  const result = password
    ? validatePassword(password, email, role)
    : null;

  if (!result) return null;

  const minLength = getMinPasswordLength(role);
  const tooShort = password.length < minLength;

  // When password is too short, cap the visual score at 2 (orange)
  const effectiveScore = tooShort
    ? Math.min(result.score, 2)
    : result.score;
  const barColor = SCORE_COLORS[effectiveScore];
  const barWidth = ((effectiveScore + 1) / 5) * 100;
  const label = t(SCORE_LABEL_KEYS[effectiveScore]);

  // Build feedback parts
  const feedbackParts: string[] = [];
  if (tooShort) {
    feedbackParts.push(t("minLength", { count: minLength }));
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

export {
  PasswordStrengthMeter,
  type PasswordStrengthMeterProps,
};
