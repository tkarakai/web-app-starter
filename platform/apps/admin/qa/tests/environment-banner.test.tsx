import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EnvironmentBanner } from "@web-app-starter/design-system";

for (const environment of ["development", "staging"] as const) {
  describe(`${environment} environment banner`, () => {
    it("shows the starter version alongside app and commit metadata, including when expanded", () => {
      render(
        <EnvironmentBanner
          environment={environment}
          platformVersion="3.1.0"
          appName="web"
          gitBranch="main"
          gitSha="abcdef123456"
          position="static"
        />,
      );
      const trigger = screen.getByRole("button");
      expect(trigger).toHaveTextContent("starter v3.1.0");
      expect(trigger).toHaveTextContent("web");
      expect(trigger).toHaveTextContent("main");
      expect(trigger).toHaveTextContent("abcdef1");
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("starter")).toBeVisible();
      expect(screen.getByText("v3.1.0")).toBeVisible();
    });
  });
}

it("keeps direct consumers without version metadata compatible", () => {
  render(<EnvironmentBanner environment="development" position="static" />);
  expect(screen.getByRole("button")).toHaveTextContent(/^DEV$/);
});

it("hides production even when a starter version is provided", () => {
  const { container } = render(
    <EnvironmentBanner environment="production" platformVersion="3.1.0" />,
  );
  expect(container).toBeEmptyDOMElement();
});
