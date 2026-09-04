import { m } from "@/i18n";

describe("the Paraglide plugin under vitest", () => {
  it("compiles the catalog so a message returns its English", () => {
    expect(m.common_cancel_action()).toBe("Cancel");
  });
});
