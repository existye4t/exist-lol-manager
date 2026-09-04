import { describe, expect, it } from "vitest";

import { stripReleasePreamble } from "../releaseNotes";

const DOWNLOAD =
  "👉 **Download** [`LTK.Manager_1.15.3_x64_en-US.msi`](https://github.com/LeagueToolkit/ltk-manager/releases/download/v1.15.3/LTK.Manager_1.15.3_x64_en-US.msi)";
const HEADING =
  "## [1.15.3](https://github.com/LeagueToolkit/ltk-manager/releases/tag/v1.15.3) - 2026-08-30";
const BODY = "### Fixed\n\n- A repair no longer rewrites an unrelated WAD.\n";

describe("stripReleasePreamble", () => {
  it("drops the download line and the version heading a composed body opens with", () => {
    expect(stripReleasePreamble(`${DOWNLOAD}\n\n${HEADING}\n\n${BODY}`)).toBe(BODY);
  });

  it("keeps a composed body's own markdown byte for byte", () => {
    const written = "### Added\n\n- Two  spaces, a trailing tab\t\n\n## Not the version heading\n";

    expect(stripReleasePreamble(`${DOWNLOAD}\n\n${HEADING}\n\n${written}`)).toBe(written);
  });

  it("leaves a hand-written body alone", () => {
    expect(stripReleasePreamble(BODY)).toBe(BODY);
  });

  it("leaves a heading no download line precedes", () => {
    const body = `${HEADING}\n\n${BODY}`;

    expect(stripReleasePreamble(body)).toBe(body);
  });

  it("drops only the download line where no heading follows it", () => {
    expect(stripReleasePreamble(`${DOWNLOAD}\n\n${BODY}`)).toBe(BODY);
  });

  it("reads a body GitHub hands over with carriage returns", () => {
    const composed = `${DOWNLOAD}\r\n\r\n${HEADING}\r\n\r\n### Fixed\r\n`;

    expect(stripReleasePreamble(composed)).toBe("### Fixed\r\n");
  });

  it("has nothing to show for a blank or missing body", () => {
    expect(stripReleasePreamble(undefined)).toBe("");
    expect(stripReleasePreamble("")).toBe("");
    expect(stripReleasePreamble("\n  \n")).toBe("");
  });
});
