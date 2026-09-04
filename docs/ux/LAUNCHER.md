# Launcher

How the manager starts League through the Riot Client, and what it says when it cannot. The
launch flow itself is settings-driven and specified under "Launching" in [SETTINGS.md](SETTINGS.md).
This file holds the copy decisions for a launch that fails.

## Launch failures

Each launch failure has a different remedy, so each `LauncherError` kind gets its own title and
description in `messages/en/launcher.json`, and the frontend's `describeLaunchError` is the only
place that chooses between them.

**Nothing offers to start a second Riot Client when the running one is unreachable.** Riot's
process singleton is an exclusive lock on the lockfile, and a second client that cannot hand off
its argv within five seconds kills the first, mid-champion-select in the worst case. Opening the
client by hand is the only safe recovery, so the copy says to bring it up manually.

**A refusal tells the player to clear the condition, never to try again.** The backend already
retries a refusal for half a minute before it reports one, so a refusal reaching the frontend is a
standing condition rather than a client that was still waking up. The Terms of Service refusal
has copy of its own. Any other refusal keeps Riot's own message, drawn as data, because Riot's
prose for a condition this build has not seen is better than anything generic.

**A cancelled launch is silent.** It arrives as a `LauncherError` like any other, but nothing
failed, and a toast saying the launch broke behind a Cancel button the user just pressed is worse
than saying nothing.

**A launch that fails before the launcher is reached keeps the launch's framing.** A file system
or settings error on the way to a launch is shown under "Couldn't launch League", with the error's
own summary beneath it.
