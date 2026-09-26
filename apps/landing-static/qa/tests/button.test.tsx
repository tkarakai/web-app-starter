import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button } from "@web-app-starter/design-system";

describe("Button (landing-static)", () => {
  it("renders with text", () => {
    render(<Button>Get Started</Button>);
    expect(screen.getByRole("button", { name: "Get Started" })).toBeInTheDocument();
  });
});
