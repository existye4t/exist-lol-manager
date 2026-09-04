//! The repository's published releases, as the changelog pages through them.
//!
//! The webview reaches `'self'` and `ipc:` only, so `api.github.com` is read
//! here and each page is handed over IPC. The feed is asked unauthenticated,
//! which GitHub allows sixty times an hour per address.

use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, ACCEPT, LINK};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;
use url::Url;

/// Where the releases the changelog reads are published.
const FEED_URL: &str = "https://api.github.com/repos/LeagueToolkit/ltk-manager/releases";

/// How many releases one page of the changelog holds.
const PER_PAGE: u32 = 10;

/// Sent with every request, since GitHub refuses one that names no client.
const USER_AGENT: &str = concat!("ltk-manager/", env!("CARGO_PKG_VERSION"));

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// The header GitHub reports the address's remaining quota in.
const REMAINING: &str = "x-ratelimit-remaining";

/// One published release, as the changelog reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNote {
    /// The tag without its leading `v`.
    pub version: String,
    pub tag: String,
    pub body: String,
    /// RFC 3339, as GitHub publishes it.
    pub published_at: Option<String>,
    pub prerelease: bool,
    /// The release's page on GitHub.
    pub url: String,
}

/// A page of the release feed, and where the next one starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePage {
    pub releases: Vec<ReleaseNote>,
    /// `None` once the feed has no page after this one.
    pub next_page: Option<u32>,
}

/// Which way a read of the release feed failed, as the remedy it has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseFeedErrorKind {
    /// GitHub was never reached. Waiting for a connection is the remedy.
    Offline,
    /// The address has spent its unauthenticated quota. Waiting is the remedy.
    RateLimited,
    /// The request went out and what came back is not a page of the feed.
    Http,
}

/// Why a page of the release feed could not be read.
#[derive(Debug, thiserror::Error)]
pub enum ReleaseFeedError {
    /// The request never reached GitHub.
    #[error("reaching the release feed: {0}")]
    Offline(#[source] reqwest::Error),

    /// GitHub turned the request away for exhausting the quota.
    #[error("the release feed's request quota is spent")]
    RateLimited,

    /// The request or the body it answered with failed.
    #[error("reading the release feed: {0}")]
    Http(#[source] reqwest::Error),

    /// GitHub answered, with a status no page can be read from.
    #[error("the release feed answered with status {0}")]
    Status(u16),

    /// The body arrived and is not the JSON a feed page is written in.
    #[error("the release feed's answer is not a feed page: {0}")]
    Malformed(#[source] serde_json::Error),

    /// The blocking thread carrying the request did not finish.
    #[error("the release feed request did not finish: {0}")]
    Interrupted(String),
}

impl ReleaseFeedError {
    /// Which remedy this failure has.
    pub fn kind(&self) -> ReleaseFeedErrorKind {
        match self {
            Self::Offline(_) => ReleaseFeedErrorKind::Offline,
            Self::RateLimited => ReleaseFeedErrorKind::RateLimited,
            Self::Http(_) | Self::Status(_) | Self::Malformed(_) | Self::Interrupted(_) => {
                ReleaseFeedErrorKind::Http
            }
        }
    }
}

/// Read page `page` of the release feed, one-based as GitHub numbers it.
///
/// Blocking, so it belongs on a thread that does not draw the window.
///
/// # Errors
///
/// Fails when GitHub cannot be reached, when the address has spent its
/// unauthenticated quota, or when the answer is not a page of the feed.
pub fn fetch_page(page: u32) -> Result<ReleasePage, ReleaseFeedError> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(ReleaseFeedError::Http)?;

    let response = client
        .get(format!("{FEED_URL}?per_page={PER_PAGE}&page={page}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(transport_failure)?;

    let status = response.status();
    if !status.is_success() {
        return Err(if is_rate_limited(status, response.headers()) {
            ReleaseFeedError::RateLimited
        } else {
            ReleaseFeedError::Status(status.as_u16())
        });
    }

    let link = response
        .headers()
        .get(LINK)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response.text().map_err(ReleaseFeedError::Http)?;
    let feed = serde_json::from_str(&body).map_err(ReleaseFeedError::Malformed)?;

    Ok(feed_page(&feed, link.as_deref()))
}

/// A send's failure, as the variant carrying the remedy it leaves.
fn transport_failure(error: reqwest::Error) -> ReleaseFeedError {
    if error.is_connect() || error.is_timeout() {
        ReleaseFeedError::Offline(error)
    } else {
        ReleaseFeedError::Http(error)
    }
}

/// Whether a refusal is the quota running out rather than the request.
fn is_rate_limited(status: StatusCode, headers: &HeaderMap) -> bool {
    (status == StatusCode::FORBIDDEN || status == StatusCode::TOO_MANY_REQUESTS)
        && headers
            .get(REMAINING)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|remaining| remaining.trim() == "0")
}

/// The page `body` holds, and the one its `link` header says follows it.
fn feed_page(body: &Value, link: Option<&str>) -> ReleasePage {
    let releases = body
        .as_array()
        .map(|entries| entries.iter().filter_map(release_note).collect())
        .unwrap_or_default();

    ReleasePage {
        releases,
        next_page: next_page(link),
    }
}

/// The release `entry` describes, when it is one the changelog lists.
///
/// A tag that is not a version is not a release the changelog has a place
/// for, which is what drops the pinned `updater` tag the updater reads.
fn release_note(entry: &Value) -> Option<ReleaseNote> {
    if entry["draft"].as_bool().unwrap_or(false) {
        return None;
    }

    let tag = entry["tag_name"].as_str()?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    semver::Version::parse(version).ok()?;

    Some(ReleaseNote {
        version: version.to_owned(),
        tag: tag.to_owned(),
        body: entry["body"].as_str().unwrap_or_default().to_owned(),
        published_at: entry["published_at"].as_str().map(str::to_owned),
        prerelease: entry["prerelease"].as_bool().unwrap_or(false),
        url: entry["html_url"].as_str().unwrap_or_default().to_owned(),
    })
}

/// The page a `Link` header points at as `rel="next"`.
///
/// The header is the cursor rather than the entry count, because the version
/// filter can leave a page shorter than the one GitHub served.
fn next_page(link: Option<&str>) -> Option<u32> {
    link?.split(',').find_map(|entry| {
        let mut parts = entry.split(';').map(str::trim);
        let target = parts.next()?;
        parts.any(is_next).then(|| page_query(target)).flatten()
    })
}

/// Whether a `Link` parameter is the relation naming the following page.
fn is_next(param: &str) -> bool {
    param
        .strip_prefix("rel=")
        .is_some_and(|relation| relation.trim_matches('"') == "next")
}

/// The `page` a `<...>` link target asks for.
fn page_query(target: &str) -> Option<u32> {
    let url = target.strip_prefix('<')?.strip_suffix('>')?;
    Url::parse(url)
        .ok()?
        .query_pairs()
        .find(|(key, _)| key == "page")
        .and_then(|(_, value)| value.parse().ok())
}

#[cfg(test)]
mod tests;
