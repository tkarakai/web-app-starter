import type { ComponentType } from "react";

import AlertShowcase from "./alert";
import AlertDialogShowcase from "./alert-dialog";
import AvatarShowcase from "./avatar";
import BadgeShowcase from "./badge";
import BreadcrumbShowcase from "./breadcrumb";
import ButtonShowcase from "./button";
import CardShowcase from "./card";
import CheckboxShowcase from "./checkbox";
import DialogShowcase from "./dialog";
import EnvironmentBannerShowcase from "./environment-banner";
import OfflineBannerShowcase from "./offline-banner";
import DropdownMenuShowcase from "./dropdown-menu";
import InputShowcase from "./input";
import PopoverShowcase from "./popover";
import ProgressShowcase from "./progress";
import RadioGroupShowcase from "./radio-group";
import SelectShowcase from "./select";
import SeparatorShowcase from "./separator";
import SheetShowcase from "./sheet";
import SidebarShowcase from "./sidebar";
import SkeletonShowcase from "./skeleton";
import SwitchShowcase from "./switch";
import TableShowcase from "./table";
import TabsShowcase from "./tabs";
import TextareaShowcase from "./textarea";
import ToggleShowcase from "./toggle";
import TooltipShowcase from "./tooltip";

export const showcaseMap: Record<string, ComponentType> = {
  alert: AlertShowcase,
  "alert-dialog": AlertDialogShowcase,
  avatar: AvatarShowcase,
  badge: BadgeShowcase,
  breadcrumb: BreadcrumbShowcase,
  button: ButtonShowcase,
  card: CardShowcase,
  checkbox: CheckboxShowcase,
  dialog: DialogShowcase,
  "environment-banner": EnvironmentBannerShowcase,
  "offline-banner": OfflineBannerShowcase,
  "dropdown-menu": DropdownMenuShowcase,
  input: InputShowcase,
  popover: PopoverShowcase,
  progress: ProgressShowcase,
  "radio-group": RadioGroupShowcase,
  select: SelectShowcase,
  separator: SeparatorShowcase,
  sheet: SheetShowcase,
  sidebar: SidebarShowcase,
  skeleton: SkeletonShowcase,
  switch: SwitchShowcase,
  table: TableShowcase,
  tabs: TabsShowcase,
  textarea: TextareaShowcase,
  toggle: ToggleShowcase,
  tooltip: TooltipShowcase,
};
