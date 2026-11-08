import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MonetisationSlot } from "../../src/components/MonetisationSlot";
import {
  productConfig,
  type MonetisationConfig,
} from "../../src/config/product";

const originalMonetisation = productConfig.monetisation;
const mutableProductConfig = productConfig as unknown as {
  monetisation: MonetisationConfig;
};

const validSponsor: MonetisationConfig["sponsor"] = {
  name: "Local Sponsor",
  copy: "A locally rendered sponsorship message.",
  url: "https://sponsor.example/",
  logoAsset: "/sponsor.svg",
  disclosure: "Sponsored",
};

function setMonetisation(config: MonetisationConfig) {
  mutableProductConfig.monetisation = config;
}

afterEach(() => {
  mutableProductConfig.monetisation = originalMonetisation;
});

describe("phase-one product gates", () => {
  it("keeps monetisation, Pro and deferred features disabled while PDF follows the build", () => {
    expect(productConfig.monetisation.mode).toBe("off");
    expect(productConfig.pro.enabled).toBe(false);
    expect(productConfig.features).toEqual({
      pdfInput: __PDF_OCR_PUBLIC__,
      cameraCapture: false,
      persistentHistory: false,
    });
  });

  it("renders no monetisation slot while monetisation is off", () => {
    const { container } = render(
      createElement(MonetisationSlot, { placement: "guide" }),
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("route-specific monetisation gating", () => {
  it("never renders the guide slot for a non-guide placement", () => {
    setMonetisation({ ...originalMonetisation, mode: "sponsor", sponsor: validSponsor });

    const { container } = render(
      createElement(MonetisationSlot, {
        placement: "tool" as "guide",
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    {
      label: "contextual mode",
      config: { ...originalMonetisation, mode: "contextual", sponsor: validSponsor },
    },
    {
      label: "an incomplete sponsor",
      config: {
        ...originalMonetisation,
        mode: "sponsor",
        sponsor: { ...validSponsor, disclosure: "" },
      },
    },
  ] satisfies Array<{ label: string; config: MonetisationConfig }>)(
    "renders nothing for $label",
    ({ config }) => {
      setMonetisation(config);

      const { container } = render(
        createElement(MonetisationSlot, { placement: "guide" }),
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  it("renders a complete first-party sponsor only on a guide placement", () => {
    setMonetisation({ ...originalMonetisation, mode: "sponsor", sponsor: validSponsor });

    render(createElement(MonetisationSlot, { placement: "guide" }));

    expect(
      screen.getByRole("complementary", { name: "Sponsor" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: validSponsor.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(validSponsor.disclosure)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Visit sponsor" });
    expect(link).toHaveAttribute("href", validSponsor.url);
    expect(link).toHaveAttribute(
      "rel",
      "sponsored noopener noreferrer",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });
});
