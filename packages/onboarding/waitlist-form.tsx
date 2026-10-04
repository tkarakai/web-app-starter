"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { WaitlistForm, type WaitlistFormProps } from "@web-app-starter/auth-ui";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@web-app-starter/design-system";

const SUPERPOWERS = [
  "coffee-to-code",
  "pixel-perfect",
  "bug-whisperer",
  "spreadsheet-wizard",
  "inbox-zero",
  "parallel-parking",
  "remembering-names",
  "never-burning-toast",
  "explaining-tech",
  "finding-restaurants",
  "staying-calm",
  "other",
] as const;

const EXCITEMENT_LEVELS = [
  "take-my-money",
  "cant-wait",
  "cautiously-optimistic",
  "just-browsing",
  "friend-made-me",
] as const;

/** Reference-app questions; the platform accepts app-owned JSON metadata. */
const ROLES = ["founder", "engineering", "product", "design", "agency", "other"] as const;

function MultiSelectDropdown({
  id,
  label,
  placeholder,
  options,
  selected,
  onToggle,
  translationPrefix,
  t,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  translationPrefix: string;
  t: (key: string, values?: Record<string, string | number | Date>) => string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className="w-full justify-between font-normal"
            type="button"
          >
            <span className="truncate">
              {selected.length > 0
                ? t("selectedCount", { count: selected.length })
                : placeholder}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[var(--radix-dropdown-menu-trigger-width)]"
          align="start"
        >
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option}
              checked={selected.includes(option)}
              onCheckedChange={() => onToggle(option)}
              onSelect={(e) => e.preventDefault()}
            >
              {t(`${translationPrefix}.${option}`)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** App-owned sample questions; remove or replace them without changing the platform. */
export function AppWaitlistForm({ convexSiteUrl }: Pick<WaitlistFormProps, "convexSiteUrl">) {
  const t = useTranslations("landing.waitlist");
  const [superpowers, setSuperpowers] = React.useState<string[]>([]);
  const [excitement, setExcitement] = React.useState<string[]>([]);
  const [role, setRole] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [useCase, setUseCase] = React.useState("");
  const toggleSelection = (
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string
  ) => {
    setter(
      list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value]
    );
  };

  return (
    <WaitlistForm
      convexSiteUrl={convexSiteUrl}
      meta={{
        superpowers, excitement, ...(role && { role }),
        ...(company.trim() && { company: company.trim() }),
        ...(useCase.trim() && { useCase: useCase.trim() }),
      }}
    >
      <MultiSelectDropdown
        id="waitlist-superpowers"
        label={t("superpowersLabel")}
        placeholder={t("superpowersPlaceholder")}
        options={SUPERPOWERS}
        selected={superpowers}
        onToggle={(v) => toggleSelection(superpowers, setSuperpowers, v)}
        translationPrefix="superpowers"
        t={t}
      />
      <MultiSelectDropdown
        id="waitlist-excitement"
        label={t("excitementLabel")}
        placeholder={t("excitementPlaceholder")}
        options={EXCITEMENT_LEVELS}
        selected={excitement}
        onToggle={(v) => toggleSelection(excitement, setExcitement, v)}
        translationPrefix="excitement"
        t={t}
      />
      <div className="space-y-2">
        <Label htmlFor="waitlist-role">{t("roleLabel")}</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger id="waitlist-role">
            <SelectValue placeholder={t("rolePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`roles.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="waitlist-company">{t("companyLabel")}</Label>
        <Input
          id="waitlist-company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder={t("companyPlaceholder")}
          maxLength={120}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="waitlist-use-case">{t("useCaseLabel")}</Label>
        <Input
          id="waitlist-use-case"
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          placeholder={t("useCasePlaceholder")}
          maxLength={500}
        />
      </div>
    </WaitlistForm>
  );
}
