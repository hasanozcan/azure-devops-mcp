import { describe, expect, it } from "vitest";

import { buildEnvContent } from "../src/setup.js";

describe("buildEnvContent", () => {
  it("quotes user values and keeps writes disabled", () => {
    const text = buildEnvContent({
      organization: "contoso",
      defaultProject: "Project One",
      authMode: "pat",
      pat: "secret#value"
    });

    expect(text).toContain('AZURE_DEVOPS_DEFAULT_PROJECT="Project One"');
    expect(text).toContain('AZURE_DEVOPS_PAT="secret#value"');
    expect(text).toContain("AZURE_DEVOPS_ENABLE_WRITE_TOOLS=false");
  });
});
