"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { authClient } from "@web-app-starter/auth/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  toast,
} from "@web-app-starter/design-system";

import { organizationErrorKey, useOrganizations } from "../lib/organization";
import { CreateOrganizationDialog } from "./create-organization-dialog";

interface OrganizationSwitcherProps {
  /** The product mark shown at the start of the button (it is all that shows when collapsed). */
  logo: React.ReactNode;
  productName: string;
  /** Called before a switch, e.g. to clear a selection that belongs to the old organization. */
  onSwitch?: () => void;
}

/**
 * The sidebar header: product name and the active organization. It opens a menu to switch
 * between the user's organizations or create one. Switching updates the session; every
 * organization-scoped query then refreshes by itself.
 */
export function OrganizationSwitcher({ logo, productName, onSwitch }: OrganizationSwitcherProps) {
  const t = useTranslations("organization");
  const data = useOrganizations();
  const [createOpen, setCreateOpen] = React.useState(false);

  const active = data?.organizations.find((organization) => organization.id === data.activeOrganizationId);
  const label = (
    <>
      {logo}
      <span className="grid flex-1 text-start leading-tight">
        <span className="truncate font-semibold">{productName}</span>
        {data && (
          <span className="truncate text-xs text-muted-foreground" data-testid="active-organization">
            {active?.name ?? t("switcher.none")}
          </span>
        )}
      </span>
    </>
  );

  if (!data) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip={active ? `${productName} · ${active.name}` : productName}>
            {label}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const switchTo = async (organizationId: string) => {
    if (organizationId === data.activeOrganizationId) return;
    onSwitch?.();
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error) toast.error(t(`errors.${organizationErrorKey(result.error)}`));
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                aria-label={t("switcher.label")}
                tooltip={active ? `${productName} · ${active.name}` : productName}
                className="data-[state=open]:bg-sidebar-accent"
              >
                {label}
                <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="w-64">
              {data.organizations.length > 0 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {t("switcher.heading")}
              </DropdownMenuLabel>}
              {data.organizations.map((organization) => (
                <DropdownMenuItem key={organization.id} onSelect={() => void switchTo(organization.id)}>
                  <Building2 className="me-2 size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === data.activeOrganizationId && <Check className="ms-2 size-4" />}
                </DropdownMenuItem>
              ))}
              {data.organizations.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                <Plus className="me-2 size-4" />
                {t("switcher.create")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onSwitch} />
    </>
  );
}
