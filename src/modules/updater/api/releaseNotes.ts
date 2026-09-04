const DOWNLOAD_LINE = /^[^\S\r\n]*(?:👉[^\S\r\n]*)?\*\*Download\*\*[^\n]*\r?\n?/;
const VERSION_HEADING = /^##[^\S\r\n][^\n]*\r?\n?/;
const BLANK_LINES = /^(?:[^\S\r\n]*\r?\n)+/;

/** A release body without the download line and version heading `release.yml` composes. */
export function stripReleasePreamble(body: string | undefined): string {
  if (!body || body.trim() === "") return "";

  const afterDownload = body.replace(DOWNLOAD_LINE, "");
  if (afterDownload === body) return body;

  const afterBlank = afterDownload.replace(BLANK_LINES, "");
  const afterHeading = afterBlank.replace(VERSION_HEADING, "");
  if (afterHeading === afterBlank) return afterBlank;

  return afterHeading.replace(BLANK_LINES, "");
}
