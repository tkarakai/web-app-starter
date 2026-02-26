"use client";

import * as React from "react";
import {
  Input,
  Label,
  PasswordInput,
  PasswordStrengthMeter,
  validatePassword,
  getMinPasswordLength,
  type PasswordRole,
} from "@repo/design-system";
import { DemoSection } from "@/components/demo-section";

/** Simple pass-through translate function for storybook (no i18n). */
const LABELS: Record<string, string> = {
  "labels.veryWeak": "Very Weak",
  "labels.weak": "Weak",
  "labels.fair": "Fair",
  "labels.good": "Good",
  "labels.strong": "Strong",
  crackTimeLabel: "Estimated crack time: {time}",
  minLength: "Minimum {count} characters required.",
  strengthRequirement: "Password must be strong.",
  "warnings.straightRow": "Straight rows of keys on your keyboard are easy to guess.",
  "warnings.keyPattern": "Short keyboard patterns are easy to guess.",
  "warnings.simpleRepeat": "Repeated characters like \"aaa\" are easy to guess.",
  "warnings.extendedRepeat": "Repeated character patterns like \"abcabcabc\" are easy to guess.",
  "warnings.sequences": "Common character sequences like \"abc\" are easy to guess.",
  "warnings.recentYears": "Recent years are easy to guess.",
  "warnings.dates": "Dates are often easy to guess.",
  "warnings.topTen": "This is a heavily used password.",
  "warnings.topHundred": "This is a frequently used password.",
  "warnings.common": "This is a commonly used password.",
  "warnings.similarToCommon": "This is similar to a commonly used password.",
  "warnings.wordByItself": "Single words are easy to guess.",
  "warnings.namesByThemselves": "Single names or surnames are easy to guess.",
  "warnings.commonNames": "Common names and surnames are easy to guess.",
  "warnings.userInputs": "There should be no personal or page-related data.",
  "warnings.pwned": "This password has been exposed in a data breach.",
  "suggestions.l33t": "Avoid predictable letter substitutions like \"@\" for \"a\".",
  "suggestions.reverseWords": "Avoid reversed spellings of common words.",
  "suggestions.allUppercase": "Capitalize some but not all letters.",
  "suggestions.capitalization": "Capitalize more than the first letter.",
  "suggestions.dates": "Avoid dates and years associated with you.",
  "suggestions.recentYears": "Avoid recent years.",
  "suggestions.associatedYears": "Avoid years associated with you.",
  "suggestions.sequences": "Avoid common character sequences.",
  "suggestions.repeated": "Avoid repeated words and characters.",
  "suggestions.longerKeyboardPattern": "Use longer keyboard patterns and change typing direction multiple times.",
  "suggestions.anotherWord": "Add more words that are less common.",
  "suggestions.useWords": "Use multiple words, but avoid common phrases.",
  "suggestions.noNeed": "You can create strong passwords without using symbols, numbers, or uppercase letters.",
  "suggestions.pwned": "If you use this password elsewhere, you should change it.",
  "timeEstimation.ltSecond": "less than a second",
  "timeEstimation.second": "{base} second",
  "timeEstimation.seconds": "{base} seconds",
  "timeEstimation.minute": "{base} minute",
  "timeEstimation.minutes": "{base} minutes",
  "timeEstimation.hour": "{base} hour",
  "timeEstimation.hours": "{base} hours",
  "timeEstimation.day": "{base} day",
  "timeEstimation.days": "{base} days",
  "timeEstimation.month": "{base} month",
  "timeEstimation.months": "{base} months",
  "timeEstimation.year": "{base} year",
  "timeEstimation.years": "{base} years",
  "timeEstimation.centuries": "centuries",
};

function t(key: string, params?: Record<string, string | number>): string {
  let text = LABELS[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

function InteractiveDemo({ role, defaultEmail }: { role: PasswordRole; defaultEmail: string }) {
  const [password, setPassword] = React.useState("");
  const [email, setEmail] = React.useState(defaultEmail);
  const minLength = getMinPasswordLength(role);
  const result = password ? validatePassword(password, email, role) : null;

  return (
    <div className="max-w-md space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`demo-email-${role}`}>Email (passwords containing it score lower)</Label>
        <Input
          id={`demo-email-${role}`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`demo-password-${role}`}>
          Password (min {minLength} chars, role: {role})
        </Label>
        <PasswordInput
          id={`demo-password-${role}`}
          placeholder="Type a password to see strength feedback…"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordStrengthMeter password={password} email={email} role={role} t={t} />
      </div>
      {result ? (
        <div className="rounded-md border bg-muted/50 p-3 text-xs font-mono space-y-1">
          <p>valid: <span className={result.valid ? "text-green-600" : "text-destructive"}>{String(result.valid)}</span></p>
          <p>score: {result.score}/4</p>
          <p>crackTimeSeconds: {result.crackTimeSeconds.toLocaleString()}</p>
          {result.warningKey ? <p>warning: {result.warningKey}</p> : null}
          {result.suggestionKeys.length > 0 ? (
            <p>suggestions: {result.suggestionKeys.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function PasswordStrengthMeterShowcase() {
  return (
    <>
      <DemoSection title="User Role (min 12 chars)">
        <InteractiveDemo role="user" defaultEmail="user@example.com" />
      </DemoSection>

      <DemoSection title="Admin Role (min 40 chars)">
        <InteractiveDemo role="admin" defaultEmail="admin@example.com" />
      </DemoSection>

      <DemoSection title="Strength Levels">
        <p className="text-sm text-muted-foreground mb-4">
          Try these passwords to see different strength levels: &quot;password&quot; (very weak),
          &quot;MyP@ss123&quot; (weak/fair), &quot;correct-horse-battery&quot; (good),
          &quot;correct-horse-battery-staple-xyz&quot; (strong).
        </p>
        <InteractiveDemo role="user" defaultEmail="" />
      </DemoSection>
    </>
  );
}
