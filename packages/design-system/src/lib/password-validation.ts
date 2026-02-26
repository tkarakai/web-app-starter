import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

// Use key-path translations so zxcvbn returns translatable keys
// instead of hardcoded English strings.
const KEY_TRANSLATIONS: typeof zxcvbnEnPackage.translations = {
  warnings: {
    straightRow: "warnings.straightRow",
    keyPattern: "warnings.keyPattern",
    simpleRepeat: "warnings.simpleRepeat",
    extendedRepeat: "warnings.extendedRepeat",
    sequences: "warnings.sequences",
    recentYears: "warnings.recentYears",
    dates: "warnings.dates",
    topTen: "warnings.topTen",
    topHundred: "warnings.topHundred",
    common: "warnings.common",
    similarToCommon: "warnings.similarToCommon",
    wordByItself: "warnings.wordByItself",
    namesByThemselves: "warnings.namesByThemselves",
    commonNames: "warnings.commonNames",
    userInputs: "warnings.userInputs",
    pwned: "warnings.pwned",
  },
  suggestions: {
    l33t: "suggestions.l33t",
    reverseWords: "suggestions.reverseWords",
    allUppercase: "suggestions.allUppercase",
    capitalization: "suggestions.capitalization",
    dates: "suggestions.dates",
    recentYears: "suggestions.recentYears",
    associatedYears: "suggestions.associatedYears",
    sequences: "suggestions.sequences",
    repeated: "suggestions.repeated",
    longerKeyboardPattern: "suggestions.longerKeyboardPattern",
    anotherWord: "suggestions.anotherWord",
    useWords: "suggestions.useWords",
    noNeed: "suggestions.noNeed",
    pwned: "suggestions.pwned",
  },
  timeEstimation: {
    ltSecond: "timeEstimation.ltSecond",
    second: "timeEstimation.second",
    seconds: "timeEstimation.seconds",
    minute: "timeEstimation.minute",
    minutes: "timeEstimation.minutes",
    hour: "timeEstimation.hour",
    hours: "timeEstimation.hours",
    day: "timeEstimation.day",
    days: "timeEstimation.days",
    month: "timeEstimation.month",
    months: "timeEstimation.months",
    year: "timeEstimation.year",
    years: "timeEstimation.years",
    centuries: "timeEstimation.centuries",
  },
};

let optionsLoaded = false;

function ensureOptions(): void {
  if (optionsLoaded) return;
  zxcvbnOptions.setOptions({
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommonPackage.dictionary,
      ...zxcvbnEnPackage.dictionary,
    },
    translations: KEY_TRANSLATIONS,
  });
  optionsLoaded = true;
}

export type PasswordRole = "admin" | "user";

export interface PasswordValidationResult {
  valid: boolean;
  score: number;
  warningKey: string | null;
  suggestionKeys: string[];
  crackTimeSeconds: number;
}

const MIN_LENGTHS: Record<PasswordRole, number> = {
  admin: 40,
  user: 12,
};

const REQUIRED_SCORE = 4;

export function getMinPasswordLength(role: PasswordRole): number {
  return MIN_LENGTHS[role];
}

export function validatePassword(
  password: string,
  email: string,
  role: PasswordRole,
): PasswordValidationResult {
  ensureOptions();

  const minLength = MIN_LENGTHS[role];

  if (!password) {
    return {
      valid: false,
      score: 0,
      warningKey: null,
      suggestionKeys: [],
      crackTimeSeconds: 0,
    };
  }

  // Add email parts and app/role context as user inputs to penalize their use
  const userInputs = [email, role, "admin", "user"];
  const emailParts = email.split(/[@.+]/);
  userInputs.push(...emailParts.filter((p) => p.length > 2));

  const result = zxcvbn(password, userInputs);

  const tooShort = password.length < minLength;
  const scoreTooLow = result.score < REQUIRED_SCORE;

  return {
    valid: !tooShort && !scoreTooLow,
    score: result.score,
    warningKey: result.feedback.warning || null,
    suggestionKeys: result.feedback.suggestions,
    crackTimeSeconds:
      result.crackTimesSeconds.offlineSlowHashing1e4PerSecond as number,
  };
}

/**
 * Format a duration in seconds to a human-readable crack time string.
 * Uses the provided translation function for localized output.
 */
export function formatCrackTime(
  seconds: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (seconds < 1) return t("timeEstimation.ltSecond");

  const MINUTE = 60;
  const HOUR = 3_600;
  const DAY = 86_400;
  const MONTH = 2_592_000; // 30 days
  const YEAR = 31_536_000; // 365 days
  const CENTURY = 3_153_600_000;

  if (seconds >= CENTURY) return t("timeEstimation.centuries");

  let base: number;
  let unit: string;

  if (seconds < MINUTE) {
    base = Math.round(seconds);
    unit = base === 1 ? "second" : "seconds";
  } else if (seconds < HOUR) {
    base = Math.round(seconds / MINUTE);
    unit = base === 1 ? "minute" : "minutes";
  } else if (seconds < DAY) {
    base = Math.round(seconds / HOUR);
    unit = base === 1 ? "hour" : "hours";
  } else if (seconds < MONTH) {
    base = Math.round(seconds / DAY);
    unit = base === 1 ? "day" : "days";
  } else if (seconds < YEAR) {
    base = Math.round(seconds / MONTH);
    unit = base === 1 ? "month" : "months";
  } else {
    base = Math.round(seconds / YEAR);
    unit = base === 1 ? "year" : "years";
  }

  return t(`timeEstimation.${unit}`, { base });
}
