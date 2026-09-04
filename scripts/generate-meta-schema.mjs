// Refreshes the embedded meta schema snapshot from the meta wiki's own
// repository, rather than from the API that serves the same file.
//
// The API sits behind Bot Fight Mode, which challenges a datacenter address and
// cannot be excepted, so a release runner is refused - see
// docs/research/meta-api-reachability-from-ci.md. The two are the same bytes,
// and lol-meta-wiki is public, so reading the file directly is what makes this
// work unattended. The runtime keeps reading the API: a user is not challenged,
// and the API is the interface published for them.
//
// The database carries its own generation and reach, so it is fetched first and
// compared afterwards. That costs a download the old two-request shape could
// skip, and buys one source that cannot disagree with itself.
//
// The runtime cache's If-None-Match path is deliberately not repeated here. Its
// tag comes back weak on the gzip GET and strong on HEAD, and a script holding
// no state has no tag to send anyway.
//
// `--check` runs the comparison, writes nothing, and exits non-zero when the
// snapshot is behind. `--force` writes whatever the comparison says.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const crateSrc = join(repoRoot, "crates", "ltk-manager-core", "src");
const snapshotPath = join(crateSrc, "meta_schema", "schema-snapshot.json.gz");
const embedPath = join(crateSrc, "meta_schema.rs");

const dbUrl = "https://raw.githubusercontent.com/LeagueToolkit/lol-meta-wiki/main/db/meta.db.json";

// A release job runs this unattended, so a stalled connection has to end the run
// rather than the runner's own limit.
const requestTimeoutMs = 60_000;

const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");

try {
  await refresh();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function refresh() {
  const shipped = readShipped();
  const body = await getText(dbUrl);
  const database = readDatabase(body);

  const current =
    shipped?.generation === database.generation && shipped?.latest === database.latest;

  if (checkOnly) {
    if (!current) {
      fail(
        `The snapshot is at ${describe(shipped)}, and the publisher is at ${describe(database)}. ` +
          "Run `pnpm generate:meta-schema` and commit the result.",
      );
    }
    console.log(`The snapshot is current at ${describe(shipped)}.`);
    return;
  }

  if (current && !force) {
    console.log(`The snapshot is current at ${describe(shipped)}, so nothing was written.`);
    return;
  }

  // Written as it was served rather than re-serialized, so a diff of the
  // decompressed blob is a diff of the publisher's own JSON.
  const compressed = gzipSync(Buffer.from(body), { level: 9 });
  const temporary = `${snapshotPath}.tmp`;
  writeFileSync(temporary, compressed);
  renameSync(temporary, snapshotPath);

  console.log(`Wrote ${compressed.length} bytes to ${snapshotPath}, at ${describe(database)}.`);
}

/* A snapshot that will not read is a reason to download, not to stop. */
function readShipped() {
  try {
    const json = JSON.parse(gunzipSync(readFileSync(snapshotPath)));
    return { generation: json.hashSource.fetchedAt, latest: json.latest };
  } catch {
    return null;
  }
}

/* Parsed and refused before it is written, because MetaSchema::shipped panics on
   a snapshot the build cannot read. */
function readDatabase(served) {
  const parsed = parseJson(served, dbUrl);
  const reads = readFormatVersion();
  if (parsed.formatVersion !== reads) {
    fail(`${dbUrl} is format version ${parsed.formatVersion}, and this build reads ${reads}.`);
  }
  if (typeof parsed.hashSource?.fetchedAt !== "string" || typeof parsed.latest !== "number") {
    fail(`${dbUrl} answered without hashSource.fetchedAt or latest.`);
  }
  return { generation: parsed.hashSource.fetchedAt, latest: parsed.latest };
}

/* Read out of the crate rather than repeated here, so a bump to the layout the
   build reads cannot leave this writing a snapshot that build refuses. */
function readFormatVersion() {
  const match = readFileSync(embedPath, "utf8").match(/const FORMAT_VERSION: u32 = (\d+);/);
  if (!match) fail(`${embedPath} declares no FORMAT_VERSION.`);
  return Number(match[1]);
}

function describe(snapshot) {
  return snapshot
    ? `${snapshot.generation}, reaching build ${snapshot.latest}`
    : "a generation that will not read";
}

/* The timeout covers the body as well as the headers, so the read is inside the
   handler too - a stall part-way through the download is a message, not a stack. */
async function getText(url) {
  try {
    const response = await mustSettle(
      fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) }),
    );
    if (!response.ok) {
      throw new Error(`answered ${response.status} ${response.statusText}`);
    }
    return await mustSettle(response.text());
  } catch (error) {
    fail(`${url} could not be read: ${error.message}`);
  }
}

/* The signal closes the socket but does not always end the wait: a timeout
   landing just as the response settles leaves fetch's promise pending for good
   on Node 22, which surfaces as an unsettled top-level await rather than as a
   message. Losing this race is that case and nothing else. */
function mustSettle(work) {
  let timer;
  const abandoned = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("the request never settled")),
      requestTimeoutMs + 1_000,
    );
  });
  return Promise.race([work, abandoned]).finally(() => clearTimeout(timer));
}

function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${url} did not answer with JSON: ${error.message}`);
  }
}

function fail(message) {
  throw new Error(message);
}
