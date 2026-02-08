"use client";

import { useEffect, useState } from "react";
import { DemoSection } from "@/components/demo-section";

// ── Color definitions ──────────────────────────────────────────────
// Static OKLCH values from tokens/index.css (browsers compute to RGB,
// so we keep the source definitions here for display).

interface ColorToken {
  name: string;
  light: string;
  dark: string;
}

const brandColors: ColorToken[] = [
  { name: "primary", light: "oklch(0.6 0.1 185)", dark: "oklch(0.7 0.12 183)" },
  { name: "primary-foreground", light: "oklch(0.98 0.01 181)", dark: "oklch(0.28 0.04 193)" },
];

const surfaceColors: ColorToken[] = [
  { name: "background", light: "oklch(1 0 0)", dark: "oklch(0.147 0.004 49.25)" },
  { name: "foreground", light: "oklch(0.147 0.004 49.25)", dark: "oklch(0.985 0.001 106.423)" },
  { name: "card", light: "oklch(1 0 0)", dark: "oklch(0.216 0.006 56.043)" },
  { name: "card-foreground", light: "oklch(0.147 0.004 49.25)", dark: "oklch(0.985 0.001 106.423)" },
  { name: "popover", light: "oklch(1 0 0)", dark: "oklch(0.216 0.006 56.043)" },
  { name: "popover-foreground", light: "oklch(0.147 0.004 49.25)", dark: "oklch(0.985 0.001 106.423)" },
];

const stateColors: ColorToken[] = [
  { name: "secondary", light: "oklch(0.967 0.001 286.375)", dark: "oklch(0.274 0.006 286.033)" },
  { name: "secondary-foreground", light: "oklch(0.21 0.006 285.885)", dark: "oklch(0.985 0 0)" },
  { name: "accent", light: "oklch(0.93 0.005 106.424)", dark: "oklch(0.3 0.01 34.298)" },
  { name: "accent-foreground", light: "oklch(0.216 0.006 56.043)", dark: "oklch(0.985 0.001 106.423)" },
  { name: "muted", light: "oklch(0.96 0.002 106.424)", dark: "oklch(0.268 0.007 34.298)" },
  { name: "muted-foreground", light: "oklch(0.553 0.013 58.071)", dark: "oklch(0.709 0.01 56.259)" },
  { name: "destructive", light: "oklch(0.577 0.245 27.325)", dark: "oklch(0.704 0.191 22.216)" },
  { name: "destructive-foreground", light: "oklch(0.985 0 0)", dark: "oklch(0.985 0 0)" },
];

const utilityColors: ColorToken[] = [
  { name: "border", light: "oklch(0.923 0.003 48.717)", dark: "oklch(1 0 0 / 10%)" },
  { name: "input", light: "oklch(0.923 0.003 48.717)", dark: "oklch(1 0 0 / 15%)" },
  { name: "ring", light: "oklch(0.709 0.01 56.259)", dark: "oklch(0.553 0.013 58.071)" },
];

const chartColors: ColorToken[] = [
  { name: "chart-1", light: "oklch(0.85 0.13 181)", dark: "oklch(0.85 0.13 181)" },
  { name: "chart-2", light: "oklch(0.78 0.13 182)", dark: "oklch(0.78 0.13 182)" },
  { name: "chart-3", light: "oklch(0.7 0.12 183)", dark: "oklch(0.7 0.12 183)" },
  { name: "chart-4", light: "oklch(0.6 0.1 185)", dark: "oklch(0.6 0.1 185)" },
  { name: "chart-5", light: "oklch(0.51 0.09 186)", dark: "oklch(0.51 0.09 186)" },
];

const sidebarColors: ColorToken[] = [
  { name: "sidebar", light: "oklch(0.985 0.001 106.423)", dark: "oklch(0.216 0.006 56.043)" },
  { name: "sidebar-foreground", light: "oklch(0.147 0.004 49.25)", dark: "oklch(0.985 0.001 106.423)" },
  { name: "sidebar-primary", light: "oklch(0.6 0.1 185)", dark: "oklch(0.78 0.13 182)" },
  { name: "sidebar-primary-foreground", light: "oklch(0.98 0.01 181)", dark: "oklch(0.28 0.04 193)" },
  { name: "sidebar-accent", light: "oklch(0.93 0.005 106.424)", dark: "oklch(0.3 0.01 34.298)" },
  { name: "sidebar-accent-foreground", light: "oklch(0.216 0.006 56.043)", dark: "oklch(0.985 0.001 106.423)" },
  { name: "sidebar-border", light: "oklch(0.923 0.003 48.717)", dark: "oklch(1 0 0 / 10%)" },
  { name: "sidebar-ring", light: "oklch(0.709 0.01 56.259)", dark: "oklch(0.553 0.013 58.071)" },
];

// All variable names for the useCssVariables hook
const allVarNames = [
  ...brandColors,
  ...surfaceColors,
  ...stateColors,
  ...utilityColors,
  ...chartColors,
  ...sidebarColors,
].map((c) => `--${c.name}`);

// ── Hook: read CSS variables reactively ────────────────────────────

function useCssVariables(varNames: string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    function read() {
      const style = window.getComputedStyle(document.documentElement);
      const result: Record<string, string> = {};
      for (const name of varNames) {
        result[name] = style.getPropertyValue(name).trim();
      }
      setValues(result);
    }

    // Read after a frame to ensure CSS is applied
    window.requestAnimationFrame(read);

    // Re-read when theme changes (class attribute mutation on <html>)
    const observer = new window.MutationObserver(() => {
      window.requestAnimationFrame(read);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return values;
}

// ── Detect current theme ───────────────────────────────────────────

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    function check() {
      setIsDark(document.documentElement.classList.contains("dark"));
    }
    check();

    const observer = new window.MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

// ── Swatch components ──────────────────────────────────────────────

function ColorSwatch({
  token,
  computed,
  isDark,
}: {
  token: ColorToken;
  computed: string;
  isDark: boolean;
}) {
  const definition = isDark ? token.dark : token.light;

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-12 w-12 shrink-0 rounded-md border border-border/40 shadow-sm"
        style={{ backgroundColor: `var(--${token.name})` }}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">--{token.name}</p>
        <p className="text-xs text-muted-foreground truncate font-mono">
          {definition}
        </p>
        {computed && computed !== definition && (
          <p className="text-xs text-muted-foreground/60 truncate font-mono">
            {computed}
          </p>
        )}
      </div>
    </div>
  );
}

function ColorPair({
  bg,
  fg,
  isDark,
}: {
  bg: ColorToken;
  fg: ColorToken;
  isDark: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="flex items-center justify-center h-16 rounded-md border border-border/40 px-4 shadow-sm"
        style={{
          backgroundColor: `var(--${bg.name})`,
          color: `var(--${fg.name})`,
        }}
      >
        <span className="text-sm font-medium">Aa</span>
      </div>
      <div>
        <p className="text-xs font-medium text-foreground">
          --{bg.name}
        </p>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {isDark ? bg.dark : bg.light}
        </p>
        <p className="text-xs font-medium text-foreground mt-1">
          --{fg.name}
        </p>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {isDark ? fg.dark : fg.light}
        </p>
      </div>
    </div>
  );
}

function ColorSwatchGrid({
  tokens,
  computed,
  isDark,
}: {
  tokens: ColorToken[];
  computed: Record<string, string>;
  isDark: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tokens.map((token) => (
        <ColorSwatch
          key={token.name}
          token={token}
          computed={computed[`--${token.name}`] ?? ""}
          isDark={isDark}
        />
      ))}
    </div>
  );
}

// ── Main showcase ──────────────────────────────────────────────────

export default function ColorsShowcase() {
  const computed = useCssVariables(allVarNames);
  const isDark = useIsDark();

  return (
    <>
      <DemoSection
        title="Brand"
        description="The primary brand color used for buttons, links, and active indicators."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <ColorPair bg={brandColors[0]!} fg={brandColors[1]!} isDark={isDark} />
        </div>
      </DemoSection>

      <DemoSection
        title="Surfaces"
        description="Background and text color pairs for pages, cards, and popovers."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <ColorPair bg={surfaceColors[0]!} fg={surfaceColors[1]!} isDark={isDark} />
          <ColorPair bg={surfaceColors[2]!} fg={surfaceColors[3]!} isDark={isDark} />
          <ColorPair bg={surfaceColors[4]!} fg={surfaceColors[5]!} isDark={isDark} />
        </div>
      </DemoSection>

      <DemoSection
        title="States"
        description="Colors for secondary actions, hover accents, muted content, and destructive operations."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <ColorPair bg={stateColors[0]!} fg={stateColors[1]!} isDark={isDark} />
          <ColorPair bg={stateColors[2]!} fg={stateColors[3]!} isDark={isDark} />
          <ColorPair bg={stateColors[4]!} fg={stateColors[5]!} isDark={isDark} />
          <ColorPair bg={stateColors[6]!} fg={stateColors[7]!} isDark={isDark} />
        </div>
      </DemoSection>

      <DemoSection
        title="Utility"
        description="Border, input, and focus ring colors."
      >
        <ColorSwatchGrid tokens={utilityColors} computed={computed} isDark={isDark} />
      </DemoSection>

      <DemoSection
        title="Chart"
        description="A five-step teal gradient for data visualizations."
      >
        <div className="flex gap-1 mb-4">
          {chartColors.map((token) => (
            <div
              key={token.name}
              className="h-10 flex-1 first:rounded-l-md last:rounded-r-md"
              style={{ backgroundColor: `var(--${token.name})` }}
            />
          ))}
        </div>
        <ColorSwatchGrid tokens={chartColors} computed={computed} isDark={isDark} />
      </DemoSection>

      <DemoSection
        title="Sidebar"
        description="Dedicated tokens for sidebar navigation, allowing the sidebar to diverge from the main palette."
      >
        <ColorSwatchGrid tokens={sidebarColors} computed={computed} isDark={isDark} />
      </DemoSection>
    </>
  );
}
