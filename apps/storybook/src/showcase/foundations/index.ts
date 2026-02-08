import type { ComponentType } from "react";

import BorderRadiusShowcase from "./border-radius";
import ColorsShowcase from "./colors";
import IconsShowcase from "./icons";
import ShadowsShowcase from "./shadows";
import SpacingShowcase from "./spacing";
import TypographyShowcase from "./typography";

export const foundationShowcaseMap: Record<string, ComponentType> = {
  "border-radius": BorderRadiusShowcase,
  colors: ColorsShowcase,
  icons: IconsShowcase,
  shadows: ShadowsShowcase,
  spacing: SpacingShowcase,
  typography: TypographyShowcase,
};
