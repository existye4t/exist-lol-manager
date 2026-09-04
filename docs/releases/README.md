# Release notes

One file per version, `<version>.md`, and it becomes the body of that GitHub
release. `release.yml` puts the download link and the version heading around it,
so a file here starts at its first `###`.

## Who it is for

Whoever installs the build. That is the whole rule, and it is what separates
these from `git log`.

A commit subject is written in the codebase's own vocabulary, which the root
`CLAUDE.md` requires and which is the wrong register here. "keep an optional the
fix cannot convert" names a change for someone who works on the parser and tells
a user nothing. Neither does a dependency bump, and a user-facing fix often
arrives as exactly that.

So write what changed for someone using the app, in the words the app itself
uses:

```
Bad   bump league-mod crate pins
Good  Importing a Fantome mod no longer fails when its thumbnail is not a PNG
```

Claim only what you have checked. A fix that arrives through a dependency is
still a claim about this build, so read what actually changed upstream before
writing a sentence about it.

## How a file gets here

Dispatching `release-prepare.yml` drafts one from the commit list and commits it
to the release PR, unless a file for that version already exists - so notes
written ahead of the release stand. **Rewriting the draft in that PR is the
point.** It is the last review before the notes reach users.

Write nothing and `release.yml` publishes the raw commit list and logs a
warning. That is a fallback, not the intended path.

## Sections

`###` headings. `Added`, `Fixed` and `Changed` carry the release. `Under the
hood` is for work with no user-visible effect that is still worth naming, such
as a dependency migration.

A `Known Issues` section beats silence where a fix is partial. Say what still
bites and what a user can safely ignore, so the release answers the question
before it reaches the issue tracker.
