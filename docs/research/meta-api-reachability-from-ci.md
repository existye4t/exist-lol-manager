# The meta schema refresh cannot reach its publisher from CI

Research note, and the record of what was decided from it. Sections 1 to 6 are evidence gathered
on 2026-09-01. Section 7 is the decision and sections 8 to 10 what follows from it.

The question came from cutting v1.15.2. `release-prepare.yml` failed twice at the same step, on a
network call whose result was already known to change nothing, and the release had to be assembled
by hand.

Two findings decide the rest:

- **Bot Fight Mode is refusing the runner, and it is the one Cloudflare bot product that cannot be
  excepted.** A skip rule on a shared header and an IP allowlist are both ruled out by that, on
  Cloudflare's own documentation.
- **The API serves a file that is already committed to a public repository, byte for byte.** So
  the fix is to read it from where CI can always reach it, and no Cloudflare change is needed at
  all.

## Sources

- The two failed runs, `33525132823` and `33525424394`, and their step logs
- Cloudflare Security Events for `leaguetoolkit.dev`, read from the dashboard
- `scripts/generate-meta-schema.mjs` - the script that makes the call
- `.github/workflows/release-prepare.yml` - its only automated caller
- `crates/ltk-manager-core/src/meta_schema.rs` and `meta_schema/cache.rs` - the runtime path
- `crates/ltk-manager-core/src/mods/health/sweep.rs` - where the app syncs the schema
- `docs/DEVELOPMENT.md` - the recorded reason the release refreshes the snapshot
- Response headers and payloads read directly from both hosts on 2026-09-01
- [Get started with Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)
- [Available skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/)
- [Security features interoperability](https://developers.cloudflare.com/waf/feature-interoperability/)

## 1. What failed

Both dispatches of `release-prepare.yml` failed in `Bump versions and create PR` with one line:

```
https://meta-api.leaguetoolkit.dev/v1 could not be read: answered 403 Forbidden
##[error]Process completed with exit code 1.
```

Four things the runs establish:

- The failure is not intermittent. Two dispatches, minutes apart, failed identically.
- It is not the change that added `docs/releases/`. The `Draft release notes` step ran before it
  and produced its commit list correctly.
- Nothing was left behind. The step fails ahead of `git checkout -b` and `git push`, so no
  `release/v1.15.2` branch and no pull request existed afterwards.
- It is not User-Agent filtering. The same URL answers `200` from a residential connection both
  with a browser User-Agent and with none.

The snapshot was already current when the release was cut - `--check` locally reported it at
`2026-08-24T03:56:00Z`, reaching build `8104348`. **The release was blocked by a request that had
nothing to fetch.**

v1.15.2 was cut by hand instead, in pull request #378, reproducing the workflow's own commands.

## 2. What the embedded snapshot is actually for

The schema reaches a user two ways, and they are not equal partners.

**The sync is the delivery.** `MetaSchemaCache` holds a copy beside the hashtables, and
`fill_meta_schema` in `mods/health/sweep.rs` refreshes it over a conditional `ETag` request before
a library sweep runs. `meta_schema::shared` reads that cache whenever one can be discovered. A
newer schema therefore reaches users on their next sweep, without waiting for anyone to cut a
release.

**The embedded snapshot is the floor.** `MetaSchema::shipped` reads
`meta_schema/schema-snapshot.json.gz` through `include_bytes!`, and `shared` falls back to it only
when no cache can be discovered - a machine that has never synced, or one that is offline. The
runtime already treats a failed sync exactly this way, and says so in its own doc comment:

> A failure is logged and stepped over, leaving every check on the shipped snapshot.

So `docs/DEVELOPMENT.md` is right that a stale snapshot costs the `bin/property-type` check its
reach, and it costs it **only for a machine that has not synced.** That is a real cost and a
narrow one. It is not worth blocking a release over, and this note's recommendation is shaped by
that: the release-time refresh is a convenience that keeps the floor high, not the mechanism that
gets the schema to anybody.

Worth noting the asymmetry the outage exposed. The client tolerates an unreachable publisher and
carries on. The generation script failed the whole release over the same condition. Section 10 is
about that, and it matters much less now that section 7 removes the reachability problem.

`release-prepare.yml` is the only automated caller. The script's `--check` mode is not used as a
gate anywhere.

## 3. What the endpoint is

A Cloudflare Worker serving static files. Both paths the script uses are public, cached at the
edge, and need no credential:

| Path     | Size   | Cache-Control                                        | CF-Cache-Status |
| -------- | ------ | ---------------------------------------------------- | --------------- |
| `/v1`    | ~500 B | `public, max-age=3600, stale-while-revalidate=86400` | `HIT`           |
| `/v1/db` | 3.7 MB | `public, max-age=3600, stale-while-revalidate=86400` | `HIT`           |

A `HIT` means the edge answered without the Worker running. The refusal a runner gets is applied
at the edge as well, ahead of the Worker, so **a check written inside the Worker cannot lift the
block.**

## 4. Bot Fight Mode is what fired

Security Events for `leaguetoolkit.dev` carry two events at the failure times, identical apart
from the timestamp:

| Field               | Value                     |
| ------------------- | ------------------------- |
| `source`            | `botFight`                |
| `ruleId`            | `bot_fight_mode`          |
| `action`            | `managed_challenge`       |
| `clientRequestPath` | `/v1`                     |
| `datetime`          | 15:21:59 and 15:24:59 UTC |

The action is a managed challenge, which a browser solves and an HTTP client in a script cannot.
What the script sees is the `403`.

Both events are on `/v1` and none on `/v1/db`, which matches the script: it read `/v1` first to
decide whether a download was needed, and never got past it.

Real users are unaffected. The challenge is aimed at datacenter addresses, and the app's own sync
runs from a residential connection.

## 5. Bot Fight Mode cannot be excepted

Bot Fight Mode is the free-plan product. It does not run on the Ruleset Engine, so the WAF's
`Skip` action does not reach it:

> You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules.

The same page gives the reason:

> Bot Fight Mode does not run on the Ruleset Engine - it operates in a separate evaluation
> pipeline where _Skip_, _Bypass_, and _Allow_ actions have no effect.

The skip options page is explicit about which of the two bot products can be skipped:

> Currently, you cannot skip Bot Fight Mode, only Super Bot Fight Mode.

Super Bot Fight Mode is the Pro-and-above product. It runs on the Ruleset Engine, it is skippable
through the `http_request_sbfm` phase, and the `cf.bot_management` fields belong to it rather than
to Bot Fight Mode. That `bot_fight_mode` is the rule which fired therefore also says, on its own,
that the zone is not on a plan carrying Super Bot Fight Mode.

## 6. What that rules out

**A shared header plus a Skip custom rule.** This was the recommendation in the first draft of
this note, and it cannot work. The rule evaluates after Bot Fight Mode has already challenged the
request, and a `Skip` action has no effect on it in any case.

**A third-party IP-allowlisting action**, of which `xiaotianxt/bypass-cloudflare-for-github-action`
is the usual suggestion. `Allow` actions have no effect on Bot Fight Mode either, and IP Access
Rules are being deprecated, so the mechanism is both unlikely to work here and on its way out. It
would also want an account-scoped `CF_API_TOKEN` able to edit filter lists and zone WAF rules,
available to every release run.

Neither should be re-proposed without reading section 5 first. Both are the obvious answer, and
both are wrong for the same reason.

## 7. Decision: read the publisher's committed database directly

`https://meta-api.leaguetoolkit.dev/v1/db` and
`https://raw.githubusercontent.com/LeagueToolkit/lol-meta-wiki/main/db/meta.db.json` are the same
file. Fetched separately on 2026-09-01, both were 3,775,263 bytes at SHA-256
`04748e3ddd82ae900bb3e871a76049132efb5d78e49f40e561bb63e3f24f276a`.

So `generate-meta-schema.mjs` reads the file from `raw.githubusercontent.com`, and the `/v1` call
is dropped. What that buys:

- **The blocked endpoint leaves the build path.** `/v1` is the only thing Bot Fight Mode
  challenged, and nothing reads it any more.
- **No Cloudflare change, no secret, no plan upgrade, no third-party action.**
- **One request instead of two.** Everything `/v1` supplied - `dataset.fetchedAt` and
  `dataset.latestBuild` - is already inside the database as `hashSource.fetchedAt` and `latest`,
  which `readDatabase` reads and validates today.
- **Less code.** With one source, `/v1` and `/v1/db` can no longer disagree, so the warning that
  reconciled them is deleted.
- `raw.githubusercontent.com` serves it gzipped, 574 KB on the wire, with an `ETag` and
  `Cache-Control: max-age=300`.

The runtime is untouched. `DB_URL` in `meta_schema/cache.rs` still points at the API, which is
correct - users are not challenged, and the API is the interface built for them.

## 8. What the decision costs

**A repository layout is not a contract.** `db/meta.db.json` on `main` is an internal detail of
`lol-meta-wiki`, and the `/v1` API is the interface it publishes. If that repository moves the file
or renames its default branch, releases here break and nothing warns first. This is accepted
because both repositories are LeagueToolkit's, and it is the coupling to revisit if the meta wiki
ever gains consumers outside the organisation, or if a real API server that CI can reach replaces
the Worker.

The middle option, if that coupling ever bites before then, is a release asset. `update-db.yml`
already commits `db/meta.db.json` and holds `contents: write`, so uploading it to a fixed tag on
each change would publish the same bytes at a URL that exists for consumers. That is the pattern
this repository already uses for its own `updater` release.

**The download is now unconditional.** The script fetches 574 KB before deciding it has nothing to
write, where it used to read a 500-byte manifest first. For something that runs when a release is
cut, this does not matter.

## 9. The work

```
.
|-- scripts/generate-meta-schema.mjs
|   |-- read db/meta.db.json from raw.githubusercontent.com
|   |-- compare on the payload's own hashSource.fetchedAt and latest
|   |-- drop the /v1 call and the two-source warning
|-- CLAUDE.md and docs/DEVELOPMENT.md
    |-- both say the script reaches the LTK Meta Wiki API, which stops being true
```

The proof that the port is faithful is that `--force` regenerates the committed snapshot
byte-for-byte: the payloads are identical and the gzip is local, so any diff at all means
something is wrong.

## 10. Not doing: warn on unreachable, fail on stale

The script exits non-zero both when the publisher cannot be reached and when the snapshot is
behind. Splitting those - warn on the first, keep the second fatal - was this note's headline
recommendation while the dependency was Cloudflare's edge, because a third party could block a
release for reasons unrelated to it.

Section 7 removes that premise. The dependency becomes `raw.githubusercontent.com`, reached from a
job already running on GitHub, so the split would now guard against GitHub being down while GitHub
runs the build. Section 2 also puts the stakes low: an unreachable publisher costs the floor its
freshness and costs a synced user nothing.

Left unbuilt deliberately. It is the right change if a `raw` outage ever does block a release, and
the client's own policy in section 2 is the model to copy.

## 11. Still unconfirmed

- **The zone's plan.** Section 5 infers Free from the rule id. It decides nothing now that section
  7 avoids Cloudflare, and it would decide everything if the API ever has to be reachable from CI
  again.
- **Whether anything else is affected.** This is the only automated caller in this repository.
  Whether other LeagueToolkit CI reads the same API has not been checked.
