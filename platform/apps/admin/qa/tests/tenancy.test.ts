import { expect, test } from "bun:test";
import { countdown, parseDollars } from "../../src/lib/tenancy";

test("prices are whole cents from dollars with at most two decimals", () => {
  expect(parseDollars("19")).toBe(1900);
  expect(parseDollars("19.5")).toBe(1950);
  expect(parseDollars(" 0.99 ")).toBe(99);
  expect(parseDollars("0")).toBe(0);
  for (const bad of ["", "-1", "1.999", "abc", "1,5"]) expect(parseDollars(bad)).toBeNull();
});

test("a scheduled deletion counts down in days, then hours", () => {
  const now = 1_000_000_000;
  expect(countdown(now + 9 * 86_400_000 + 5, now)).toBe("in 9 days");
  expect(countdown(now + 86_400_000, now)).toBe("in 1 day");
  expect(countdown(now + 5 * 3_600_000, now)).toBe("in 5 hours");
  expect(countdown(now + 60_000, now)).toBe("in 1 hour");
  expect(countdown(now, now)).toBe("due now");
});
