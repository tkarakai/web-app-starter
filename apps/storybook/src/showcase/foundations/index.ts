import type { ComponentType } from "react";

import BorderRadiusShowcase from "./border-radius";
import ColorsShowcase from "./colors";
import ShadowsShowcase from "./shadows";
import SpacingShowcase from "./spacing";
import TypographyShowcase from "./typography";

export const foundationShowcaseMap: Record<string, ComponentType> = {
  "border-radius": BorderRadiusShowcase,
  colors: ColorsShowcase,
  shadows: ShadowsShowcase,
  spacing: SpacingShowcase,
  typography: TypographyShowcase,
};
