//! The meta schema: what type the game expects every bin property to hold.
//!
//! A bin writes one type tag per value, and the game compares it against its
//! own registrar by exact byte equality - no coercion, no widening. A tag that
//! does not match is thrown away, the member keeps its constructor default, and
//! the load reports success, so a mistyped property is silent data loss.
//!
//! **A revision is keyed on a build, so a lookup needs one.** A field is
//! `String` before a build and `File` after it, and neither is wrong in itself.

use std::collections::HashMap;
use std::io::Read as _;
use std::sync::{Arc, Mutex, PoisonError};

use ltk_hash::BinHash;
use ltk_meta::property::Kind;
use serde::Deserialize;

use crate::problems::GameBuild;

#[cfg(test)]
mod tests;

/// The database as the LTK Meta Wiki publishes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Published {
    /// The database layout, which this build knows one of.
    format_version: u32,
    hash_source: HashSource,
    /// The newest build any revision names.
    latest: u32,
    classes: HashMap<String, PublishedClass>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashSource {
    /// When the upstream hash tables behind this database were read.
    fetched_at: String,
}

#[derive(Debug, Deserialize)]
struct PublishedClass {
    name: Option<String>,
    #[serde(default)]
    properties: HashMap<String, PublishedProperty>,
}

#[derive(Debug, Deserialize)]
struct PublishedProperty {
    name: Option<String>,
    #[serde(default)]
    revisions: Vec<PublishedRevision>,
}

#[derive(Debug, Deserialize)]
struct PublishedRevision {
    /// The first build this revision describes.
    from: u32,
    /// The last build it describes, absent while it is the current one.
    to: Option<u32>,
    /// Field type, key type, value type and class hash, in that order. What
    /// [`Shape`] reads.
    #[serde(default)]
    r#type: Vec<String>,
}

/// The database this build ships, so a check works offline and before a sync.
///
/// Gzipped because the JSON is 3.7 MB.
const SNAPSHOT: &[u8] = include_bytes!("meta_schema/schema-snapshot.json.gz");

/// The layout this build reads.
///
/// A database published at any other layout is refused rather than guessed at,
/// because a silently misread schema reports mismatches that are not there.
const FORMAT_VERSION: u32 = 1;

/// The published database, parsed into what a lookup asks of it.
#[derive(Debug)]
pub struct MetaSchema {
    generation: String,
    latest: u32,
    classes: HashMap<BinHash, ClassSchema>,
}

#[derive(Debug)]
struct ClassSchema {
    name: Option<String>,
    properties: HashMap<BinHash, PropertySchema>,
}

#[derive(Debug)]
struct PropertySchema {
    name: Option<String>,
    /// In the order the publisher wrote them, which is oldest first.
    revisions: Vec<Revision>,
}

/// One property's type over one span of builds.
#[derive(Debug, Clone, Copy)]
struct Revision {
    from: u32,
    to: Option<u32>,
    /// `None` for a type name this build does not map, which is a revision the
    /// lookup declines to answer rather than one it answers wrongly.
    shape: Option<Shape>,
}

impl Revision {
    /// Whether this revision is the one describing `build`.
    ///
    /// `to` is inclusive: the publisher writes the last build a revision held
    /// for, not the first build after it.
    fn covers(&self, build: u32) -> bool {
        build >= self.from && self.to.is_none_or(|last| build <= last)
    }
}

/// What the database writes in a slot the type leaves empty.
const EMPTY_SLOT: &str = "0x0";

/// The type of one property, as the database writes it.
///
/// Flat, the way the file is: `[kind, key, value, class]`, with `EMPTY_SLOT`
/// where the type has nothing to say. The class is not read, because a
/// `Pointer` names a base class and holds any class derived from it, so the
/// class a bin declares is no evidence of a mismatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    /// The type itself, such as `Option` or `File`.
    pub kind: Kind,
    /// A `Map`'s key type.
    pub key: Option<Kind>,
    /// What an `Option`, a list or a `Map` holds.
    pub value: Option<Kind>,
}

impl Shape {
    /// The type naming nothing but a kind, as a leaf writes it.
    #[must_use]
    pub const fn bare(kind: Kind) -> Self {
        Self {
            kind,
            key: None,
            value: None,
        }
    }

    /// Read the slots a revision writes, or `None` where the dumper could not
    /// name one of them.
    ///
    /// A list writes its fixed size in the key slot, which is a count and not
    /// a kind, so the key is read for a `Map` alone.
    fn written(slots: &[String]) -> Option<Self> {
        let slot = |index: usize| {
            slots
                .get(index)
                .map(String::as_str)
                .filter(|written| *written != EMPTY_SLOT)
        };
        let kind = kind_named(slot(0)?)?;
        let key = match (kind, slot(1)) {
            (Kind::Map, Some(written)) => Some(kind_named(written)?),
            _ => None,
        };
        let value = match slot(2) {
            Some(written) => Some(kind_named(written)?),
            None => None,
        };
        Some(Self { kind, key, value })
    }
}

/// What one property is, at one build.
///
/// Borrowed rather than cloned: a walk asks this of every property of every
/// object of every bin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expected<'a> {
    /// The type the game's registrar holds, absent where the database names a
    /// type this build cannot map.
    pub shape: Option<Shape>,
    /// The class as the database names it.
    pub class_name: Option<&'a str>,
    /// The property as the database names it.
    pub field_name: Option<&'a str>,
}

/// Why a database could not be read.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum MetaSchemaError {
    /// The bytes are not the JSON this reads.
    #[error("meta schema database: {0}")]
    Parse(#[from] serde_json::Error),
    /// The database is published at a layout this build does not know.
    #[error(
        "meta schema database is format version {found}, and this build reads {FORMAT_VERSION}"
    )]
    Format { found: u32 },
}

impl MetaSchema {
    /// The database this build ships, decompressed and parsed.
    ///
    /// # Panics
    ///
    /// Panics when the shipped snapshot is not a database this build reads,
    /// which is a broken build rather than a condition a caller can handle.
    #[must_use]
    pub fn shipped() -> Self {
        let mut json = Vec::new();
        flate2::read::GzDecoder::new(SNAPSHOT)
            .read_to_end(&mut json)
            .expect("the shipped meta schema snapshot decompresses");
        Self::parse(&json).expect("the shipped meta schema snapshot parses")
    }

    /// Parse a published database.
    ///
    /// # Errors
    ///
    /// Fails when the bytes are not the published JSON, and when they are a
    /// layout this build does not read - see [`MetaSchemaError`].
    pub fn parse(json: &[u8]) -> Result<Self, MetaSchemaError> {
        let published: Published = serde_json::from_slice(json)?;
        if published.format_version != FORMAT_VERSION {
            return Err(MetaSchemaError::Format {
                found: published.format_version,
            });
        }

        let classes = published
            .classes
            .into_iter()
            .filter_map(|(hash, class)| {
                let hash = parse_hash(&hash)?;
                let properties = class
                    .properties
                    .into_iter()
                    .filter_map(|(field, property)| {
                        Some((parse_hash(&field)?, PropertySchema::from(property)))
                    })
                    .collect();
                Some((
                    hash,
                    ClassSchema {
                        name: class.name,
                        properties,
                    },
                ))
            })
            .collect();

        Ok(Self {
            generation: published.hash_source.fetched_at,
            latest: published.latest,
            classes,
        })
    }

    /// What the game expects `field` of `class` to hold at `build`.
    ///
    /// `None` for a class, property or build it does not describe - silence
    /// rather than a mismatch, since a schema that says nothing is not evidence.
    #[must_use]
    pub fn expected(
        &self,
        class: BinHash,
        field: BinHash,
        build: GameBuild,
    ) -> Option<Expected<'_>> {
        let class_schema = self.classes.get(&class)?;
        let property = class_schema.properties.get(&field)?;
        let revision = property
            .revisions
            .iter()
            .find(|revision| revision.covers(build.content()))?;

        Some(Expected {
            shape: revision.shape,
            class_name: class_schema.name.as_deref(),
            field_name: property.name.as_deref(),
        })
    }

    /// Whether this database describes `build` at all.
    ///
    /// A build past its newest revision is one it cannot speak about.
    #[must_use]
    pub fn describes(&self, build: GameBuild) -> bool {
        build.content() <= self.latest
    }

    /// The newest build any revision names.
    #[must_use]
    pub const fn latest(&self) -> u32 {
        self.latest
    }

    /// The publisher's own stamp, which is what makes one check comparable
    /// with another.
    #[must_use]
    pub fn generation(&self) -> &str {
        &self.generation
    }

    /// How many classes it describes.
    #[must_use]
    pub fn class_count(&self) -> usize {
        self.classes.len()
    }
}

impl From<PublishedProperty> for PropertySchema {
    fn from(property: PublishedProperty) -> Self {
        Self {
            name: property.name,
            revisions: property
                .revisions
                .into_iter()
                .map(|revision| Revision {
                    from: revision.from,
                    to: revision.to,
                    shape: Shape::written(&revision.r#type),
                })
                .collect(),
        }
    }
}

/// The hash a database key writes, which is unpadded hex under `0x`.
fn parse_hash(key: &str) -> Option<BinHash> {
    let digits = key.strip_prefix("0x").unwrap_or(key);
    u32::from_str_radix(digits, 16).ok().map(BinHash)
}

/// Every type name the database writes, beside the kind `ltk_meta` calls it.
///
/// One list rather than two matches, so the two vocabularies cannot disagree.
/// The publisher writes the meta dumper's names, which differ from the reader's
/// for the five complex types and agree everywhere else.
const NAMES: &[(&str, Kind)] = &[
    ("None", Kind::None),
    ("Bool", Kind::Bool),
    ("I8", Kind::I8),
    ("U8", Kind::U8),
    ("I16", Kind::I16),
    ("U16", Kind::U16),
    ("I32", Kind::I32),
    ("U32", Kind::U32),
    ("I64", Kind::I64),
    ("U64", Kind::U64),
    ("F32", Kind::F32),
    ("Vec2", Kind::Vector2),
    ("Vec3", Kind::Vector3),
    ("Vec4", Kind::Vector4),
    ("Mtx44", Kind::Matrix44),
    ("Color", Kind::Color),
    ("String", Kind::String),
    ("Hash", Kind::Hash),
    ("File", Kind::WadChunkLink),
    ("List", Kind::Container),
    ("List2", Kind::UnorderedContainer),
    ("Pointer", Kind::Struct),
    ("Embed", Kind::Embedded),
    ("Link", Kind::ObjectLink),
    ("Option", Kind::Optional),
    ("Map", Kind::Map),
    ("Flag", Kind::BitBool),
];

/// The kind a database type name means.
///
/// `None` for a name this build does not hold, which the publisher writes where
/// its own dumper could not name the type.
#[must_use]
pub fn kind_named(name: &str) -> Option<Kind> {
    NAMES
        .iter()
        .find(|(written, _)| *written == name)
        .map(|&(_, kind)| kind)
}

/// The name the database writes for a kind, for a finding a person reads.
#[must_use]
pub fn name_of(kind: Kind) -> Option<&'static str> {
    NAMES
        .iter()
        .find(|(_, held)| *held == kind)
        .map(|&(name, _)| name)
}

/// The one database this process reads, and the build it was chosen for.
static HELD: Mutex<Option<Held>> = Mutex::new(None);

/// The open database, beside the install it was opened against.
///
/// The build is kept because [`cache::MetaSchemaCache::load`] chooses by it, so
/// a copy held for one install is not an answer for another.
#[derive(Debug)]
struct Held {
    build: Option<GameBuild>,
    schema: Arc<MetaSchema>,
}

/// The schema every check in this process reads, opened on first use.
///
/// Held rather than parsed per bin: the database is 3.7 MB of JSON and a sweep
/// asks the same questions of it for every mod.
#[must_use]
pub fn shared(build: Option<GameBuild>) -> Arc<MetaSchema> {
    let mut held = HELD.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(open) = held.as_ref()
        && open.build == build
    {
        return Arc::clone(&open.schema);
    }

    let schema = Arc::new(match cache::MetaSchemaCache::discover() {
        Ok(cache) => cache.load(build),
        Err(e) => {
            tracing::debug!("No meta schema cache, reading the shipped database: {e}");
            MetaSchema::shipped()
        }
    });
    *held = Some(Held {
        build,
        schema: Arc::clone(&schema),
    });
    schema
}

/// Drop the open database, so the next check reads what a sync just installed.
pub fn invalidate() {
    *HELD.lock().unwrap_or_else(PoisonError::into_inner) = None;
}

/// The cached copy of the published database, and the sync that fills it.
pub mod cache;
