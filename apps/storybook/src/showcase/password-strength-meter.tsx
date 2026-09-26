"use client";

import { translatePasswordStrength as t } from "@repo/i18n/password-strength";

import * as React from "react";
import { Label, PasswordInput } from "@repo/design-system";
import {
  PasswordStrengthMeter,
  getMinPasswordLength,
  REQUIRED_PASSWORD_SCORE,
  type PasswordStrengthResult,
} from "@repo/design-system/password-strength";
import { DemoSection } from "@/components/demo-section";

/** Mock results that simulate what the server-side query would return. */
const MOCK_RESULTS: { label: string; result: PasswordStrengthResult }[] = [
  {
    label: "Very Weak — \"password\"",
    result: {
      valid: false,
      score: 0,
      warningKey: "warnings.topTen",
      suggestionKeys: ["suggestions.anotherWord"],
      crackTimeSeconds: 0.001,
      tooShort: false,
      minLength: getMinPasswordLength("user"),
    },
  },
  {
    label: "Weak — \"MyP@ss123!ab\"",
    result: {
      valid: false,
      score: 1,
      warningKey: "warnings.similarToCommon",
      suggestionKeys: ["suggestions.anotherWord"],
      crackTimeSeconds: 120,
      tooShort: false,
      minLength: getMinPasswordLength("user"),
    },
  },
  {
    label: "Fair — \"sunflower-cake99\"",
    result: {
      valid: false,
      score: 2,
      warningKey: null,
      suggestionKeys: ["suggestions.anotherWord"],
      crackTimeSeconds: 86400,
      tooShort: false,
      minLength: getMinPasswordLength("user"),
    },
  },
  {
    label: "Good — \"correct-horse-battery\"",
    result: {
      valid: false,
      score: 3,
      warningKey: null,
      suggestionKeys: [],
      crackTimeSeconds: 31536000,
      tooShort: false,
      minLength: getMinPasswordLength("user"),
    },
  },
  {
    label: "Strong — \"correct-horse-battery-staple-xyz\"",
    result: {
      valid: true,
      score: 4,
      warningKey: null,
      suggestionKeys: [],
      crackTimeSeconds: 3153600000,
      tooShort: false,
      minLength: getMinPasswordLength("user"),
    },
  },
  {
    label: "Too Short (admin role, min 40)",
    result: {
      valid: false,
      score: 2,
      warningKey: null,
      suggestionKeys: [],
      crackTimeSeconds: 86400,
      tooShort: true,
      minLength: getMinPasswordLength("admin"),
    },
  },
];

function StaticDemo({ label, result }: { label: string; result: PasswordStrengthResult }) {
  return (
    <div className="max-w-md space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <PasswordStrengthMeter result={result} password="demo" t={t} />
      <div className="rounded-md border bg-muted/50 p-3 text-xs font-mono space-y-1">
        <p>valid: <span className={result.valid ? "text-green-600" : "text-destructive"}>{String(result.valid)}</span></p>
        <p>score: {result.score}/4</p>
        <p>crackTimeSeconds: {result.crackTimeSeconds.toLocaleString()}</p>
        {result.warningKey ? <p>warning: {result.warningKey}</p> : null}
        {result.suggestionKeys.length > 0 ? (
          <p>suggestions: {result.suggestionKeys.join(", ")}</p>
        ) : null}
      </div>
    </div>
  );
}

function InteractiveDemo() {
  const [password, setPassword] = React.useState("");
  const [selectedScore, setSelectedScore] = React.useState(0);

  const tooShort = password.length < getMinPasswordLength("user");

  // Simulate server result based on selected score
  const mockResult: PasswordStrengthResult | null = password
    ? {
        valid: !tooShort && selectedScore >= REQUIRED_PASSWORD_SCORE,
        score: tooShort ? Math.min(selectedScore, 2) : selectedScore,
        warningKey: selectedScore <= 1 ? "warnings.common" : null,
        suggestionKeys: selectedScore <= 2 ? ["suggestions.anotherWord"] : [],
        crackTimeSeconds: [0.001, 120, 86400, 31536000, 3153600000][selectedScore],
        tooShort,
        minLength: getMinPasswordLength("user"),
      }
    : null;

  return (
    <div className="max-w-md space-y-3">
      <div className="space-y-2">
        <Label htmlFor="demo-password">Password</Label>
        <PasswordInput
          id="demo-password"
          placeholder="Type something to see the meter…"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordStrengthMeter result={mockResult} password={password} t={t} />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="demo-score" className="text-sm whitespace-nowrap">Simulated score:</Label>
        <select
          id="demo-score"
          className="rounded border bg-background px-2 py-1 text-sm"
          value={selectedScore}
          onChange={(e) => setSelectedScore(Number(e.target.value))}
        >
          <option value={0}>0 — Very Weak</option>
          <option value={1}>1 — Weak</option>
          <option value={2}>2 — Fair</option>
          <option value={3}>3 — Good</option>
          <option value={4}>4 — Strong</option>
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        In production, the score comes from the server-side zxcvbn evaluation via Convex query.
        This demo uses a mock score selector.
      </p>
    </div>
  );
}

export default function PasswordStrengthMeterShowcase() {
  return (
    <>
      <DemoSection title="Strength Levels">
        <div className="space-y-6">
          {MOCK_RESULTS.map((item) => (
            <StaticDemo key={item.label} label={item.label} result={item.result} />
          ))}
        </div>
      </DemoSection>

      <DemoSection title="Interactive Demo (Mocked)">
        <InteractiveDemo />
      </DemoSection>
    </>
  );
}
