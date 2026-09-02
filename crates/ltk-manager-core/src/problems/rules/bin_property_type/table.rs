//! The migration table, and the rows it holds.
//!
//! One JSONL file for each game build, in `problems/tables/`. A table is a
//! claim about one game build: it is right or wrong forever for that build, and
//! it never drifts the way a live feed does. That is why it ships in the build
//! rather than being fetched - and why a wrong hash, which is not recoverable
//! from the file it was written into, is a thing to review before it ships.
//!
//! Both `class` and `field` are a name or a hash. A name hashes to the other
//! form with `FNV1a32(lowercase)`, which is what the format itself does, so the
//! loader hashes every name once and the table becomes one lookup.

use std::collections::HashMap;
use std::sync::LazyLock;

use ltk_hash::{BinHash, Hash as _};
use ltk_meta::PropertyValueEnum;
use ltk_meta::property::Kind;
use ltk_meta::property::values::Container;
use serde::Deserialize;

use super::kinds;
use crate::problems::GameBuild;

/// The first table, and the one the deadline names.
const TABLE_16_17: &str = include_str!("../../tables/binfile_migration_16.17.8087655.jsonl");

/// The build `TABLE_16_17` is a claim about, which its filename also carries.
const BUILD_16_17: GameBuild = GameBuild::new(16, 17, 8_087_655);

/// How a value crosses from the old type to the new one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Conversion {
    /// Each `String` becomes `XXH64(lowercase)` under `File`.
    ///
    /// The string is in the file, so the fix is one hash and one tag. This is
    /// 385 of the 395 rows, and the whole of the problem.
    HashValue,
    /// A `Hash` becomes the `File` of the same path.
    ///
    /// A `Hash` is already `FNV1a32` of a path and there is no arithmetic from
    /// that to `XXH64` of the same path, so the manager has to name the hash
    /// first. Where no table names it there is no fix.
    Rehash,
    /// A `Map` key goes the way [`Rehash`](Self::Rehash) does.
    HashKey,
    /// A type tag or an embedded class hash changes, and no value moves.
    None,
    /// Nothing this build knows turns the value into the type it should be.
    Unknown,
}

impl Conversion {
    /// How a value of `from` becomes one of `to`, where anything does.
    ///
    /// Derived from the pair rather than written per property, since the schema
    /// names a type and not a recipe. A pair with no road between them is
    /// [`Unknown`](Self::Unknown), which reports and offers no repair.
    #[must_use]
    pub fn between(from: Kind, to: Kind) -> Self {
        match (from, to) {
            (Kind::String, Kind::WadChunkLink) => Self::HashValue,
            (Kind::Hash, Kind::WadChunkLink) => Self::Rehash,
            _ => Self::Unknown,
        }
    }
}

/// A declared type, as one row of the table writes it.
///
/// Flat rather than recursive, because the file is: a container names its item
/// type as a bare word and carries the class beside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeSpec {
    /// The type itself, such as `Map` or `String`.
    pub kind: Kind,
    /// A `Map`'s key type.
    pub key: Option<Kind>,
    /// A container's item type.
    pub value: Option<Kind>,
    /// An `Embed` or `Pointer`'s class, or the class of a container's items.
    pub class: Option<BinHash>,
    /// The item count a schema fixes a `List` at.
    pub size: Option<u32>,
}

impl TypeSpec {
    /// The type naming nothing but a kind, which is all the schema gives.
    #[must_use]
    pub const fn bare(kind: Kind) -> Self {
        Self {
            kind,
            key: None,
            value: None,
            class: None,
            size: None,
        }
    }

    /// The type `value` is written as, which is the `from` side of a
    /// schema-derived row.
    #[must_use]
    pub fn of(value: &PropertyValueEnum) -> Self {
        let mut spec = Self::bare(value.kind());
        match value {
            PropertyValueEnum::Container(items) => spec.value = Some(items.item_kind()),
            PropertyValueEnum::UnorderedContainer(items) => spec.value = Some(items.0.item_kind()),
            PropertyValueEnum::Optional(optional) => spec.value = Some(optional.item_kind()),
            PropertyValueEnum::Map(map) => {
                spec.key = Some(map.key_kind());
                spec.value = Some(map.value_kind());
            }
            _ => {}
        }
        spec
    }

    /// Whether `value` is declared as this type.
    ///
    /// Detection reads the value's own kind rather than a version, so a table
    /// whose `from` no longer matches contributes nothing and costs one lookup.
    #[must_use]
    pub fn matches(&self, value: &PropertyValueEnum) -> bool {
        if value.kind() != self.kind {
            return false;
        }
        match value {
            PropertyValueEnum::Container(items) => self.matches_items(items),
            PropertyValueEnum::UnorderedContainer(items) => self.matches_items(&items.0),
            PropertyValueEnum::Optional(optional) => {
                self.value.is_none_or(|item| optional.item_kind() == item)
            }
            PropertyValueEnum::Map(map) => {
                self.key.is_none_or(|key| map.key_kind() == key)
                    && self.value.is_none_or(|value| map.value_kind() == value)
            }
            PropertyValueEnum::Struct(object) => self.matches_class(object.class_hash),
            PropertyValueEnum::Embedded(object) => self.matches_class(object.0.class_hash),
            _ => true,
        }
    }

    /// Whether a container holds the item type, and the class, this names.
    ///
    /// An empty container matches, because a container holding nothing holds
    /// nothing of the wrong class.
    fn matches_items(&self, container: &Container) -> bool {
        if self.value.is_some_and(|item| container.item_kind() != item) {
            return false;
        }
        let Some(class) = self.class else {
            return true;
        };
        if !matches!(container.item_kind(), Kind::Struct | Kind::Embedded) {
            return false;
        }
        container.items().iter().all(|item| match item {
            PropertyValueEnum::Embedded(it) => it.0.class_hash == class,
            PropertyValueEnum::Struct(it) => it.class_hash == class,
            _ => false,
        })
    }

    fn matches_class(&self, class: BinHash) -> bool {
        self.class.is_none_or(|named| named == class)
    }

    /// The type as a row draws it, such as `List2<String>` or `Map<Hash, String>`.
    #[must_use]
    pub fn label(&self) -> String {
        let kind = word(self.kind);
        match (self.key, self.value) {
            (Some(key), Some(value)) => format!("{kind}<{}, {}>", word(key), word(value)),
            (None, Some(value)) => format!("{kind}<{}>", word(value)),
            _ => kind,
        }
    }
}

/// The table's word for a kind, or `ltk_meta`'s where the table has none.
///
/// [`TypeSpec`]'s fields are public, so a kind no row ever writes can reach
/// here. Naming it in the other vocabulary beats drawing a placeholder.
fn word(kind: Kind) -> String {
    kinds::name(kind).map_or_else(|| format!("{kind:?}"), str::to_owned)
}

/// One row of the table: a class, a field, the old type, and the new one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Migration {
    pub class: BinHash,
    pub field: BinHash,
    /// The class as the row wrote it, where the row wrote a name.
    pub class_name: Option<String>,
    /// The field as the row wrote it, where the row wrote a name.
    pub field_name: Option<String>,
    /// The type the property had. What the rule matches against.
    pub from: TypeSpec,
    /// The type it has now. What the fix writes.
    pub to: TypeSpec,
    pub conversion: Conversion,
}

/// The migrations of one game build, keyed the way a bin addresses them.
#[derive(Debug)]
pub struct MigrationTable {
    build: GameBuild,
    rows: HashMap<(BinHash, BinHash), Migration>,
}

impl MigrationTable {
    /// Read one table's JSONL.
    ///
    /// A row this cannot read is skipped and logged, because a row it cannot
    /// read is a row it must not act on. A type name the mapping does not hold
    /// goes the same way.
    #[must_use]
    pub fn parse(build: GameBuild, jsonl: &str) -> Self {
        let mut rows = HashMap::new();
        for (index, line) in jsonl.lines().enumerate() {
            let number = index + 1;
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let row: Row = match serde_json::from_str(line) {
                Ok(row) => row,
                Err(error) => {
                    tracing::warn!("Migration table {build}, line {number}: {error}");
                    continue;
                }
            };
            let Some(migration) = row.migration() else {
                tracing::warn!(
                    "Migration table {build}, line {number}: a type or a hash it cannot read"
                );
                continue;
            };

            let key = (migration.class, migration.field);
            if let Some(shadowed) = rows.insert(key, migration) {
                tracing::warn!(
                    "Migration table {build}, line {number}: a second row for {:#010x}:{:#010x}, dropping {shadowed:?}",
                    key.0,
                    key.1
                );
            }
        }
        Self { build, rows }
    }

    /// The game build this table is a claim about.
    #[must_use]
    pub fn build(&self) -> GameBuild {
        self.build
    }

    /// How many rows the table holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// The migration of one property, if the table names it.
    #[must_use]
    pub fn migration(&self, class: BinHash, field: BinHash) -> Option<&Migration> {
        self.rows.get(&(class, field))
    }
}

/// One line of the JSONL, in the shape the file writes it.
#[derive(Debug, Deserialize)]
struct Row {
    class: String,
    field: String,
    from: RowType,
    to: RowType,
    conversion: RowConversion,
}

impl Row {
    /// The migration this row means, or `None` where it names something unreadable.
    fn migration(self) -> Option<Migration> {
        let (class, class_name) = token(&self.class)?;
        let (field, field_name) = token(&self.field)?;
        Some(Migration {
            class,
            field,
            class_name,
            field_name,
            from: self.from.spec()?,
            to: self.to.spec()?,
            conversion: self.conversion.into(),
        })
    }
}

/// A `from` or a `to` object, in the shape the file writes it.
#[derive(Debug, Deserialize)]
struct RowType {
    #[serde(rename = "type")]
    kind: String,
    key: Option<String>,
    value: Option<String>,
    class: Option<String>,
    size: Option<u32>,
}

impl RowType {
    /// The type this names, or `None` where the mapping holds no such name.
    fn spec(&self) -> Option<TypeSpec> {
        let key = match self.key.as_deref() {
            Some(written) => Some(kinds::kind(written)?),
            None => None,
        };
        let value = match self.value.as_deref() {
            Some(written) => Some(kinds::kind(written)?),
            None => None,
        };
        let class = match self.class.as_deref() {
            Some(written) => Some(token(written)?.0),
            None => None,
        };
        Some(TypeSpec {
            kind: kinds::kind(&self.kind)?,
            key,
            value,
            class,
            size: self.size,
        })
    }
}

/// The `conversion` column, in the spelling the file writes.
///
/// A mirror of [`Conversion`] rather than a derive on it, so the file's own
/// spelling stays out of this crate's public contract.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RowConversion {
    HashValue,
    Rehash,
    HashKey,
    None,
}

impl From<RowConversion> for Conversion {
    fn from(row: RowConversion) -> Self {
        match row {
            RowConversion::HashValue => Self::HashValue,
            RowConversion::Rehash => Self::Rehash,
            RowConversion::HashKey => Self::HashKey,
            RowConversion::None => Self::None,
        }
    }
}

/// Read a `class` or a `field`, which the file writes as a name or a hash.
///
/// The name comes back beside the hash where the row wrote one, because nothing
/// else in the manager can name a bin hash today. Hex digits are not padded, so
/// `0xe31300f` is seven of them and still a whole hash.
fn token(written: &str) -> Option<(BinHash, Option<String>)> {
    match written.strip_prefix("0x") {
        Some(digits) => BinHash::from_str_radix(digits, 16)
            .ok()
            .map(|hash| (hash, None)),
        None => Some((BinHash::hash_str(written), Some(written.to_owned()))),
    }
}

/// Built at first use, because a run that names no table pays nothing for one.
static TABLES: LazyLock<Vec<MigrationTable>> = LazyLock::new(|| {
    let mut tables = vec![MigrationTable::parse(BUILD_16_17, TABLE_16_17)];
    tables.sort_by_key(MigrationTable::build);
    tables
});

/// Every table the manager ships, in build order.
///
/// A run applies each in turn, so a mod authored two builds ago comes out at
/// the newest schema without anybody tracking what it was authored against.
#[must_use]
pub fn tables() -> &'static [MigrationTable] {
    &TABLES
}

#[cfg(test)]
mod tests {
    use ltk_meta::property::values;

    use super::*;

    fn shipped() -> &'static MigrationTable {
        &tables()[0]
    }

    /// A row of the shipped table, addressed the way the file writes it.
    fn row(class: &str, field: &str) -> &'static Migration {
        let (class_hash, _) = token(class).expect("a class token");
        let (field_hash, _) = token(field).expect("a field token");
        shipped()
            .migration(class_hash, field_hash)
            .unwrap_or_else(|| panic!("the shipped table names {class}:{field}"))
    }

    fn string(text: &str) -> PropertyValueEnum {
        PropertyValueEnum::String(values::String::new(text.to_owned()))
    }

    fn file(hash: u64) -> PropertyValueEnum {
        PropertyValueEnum::WadChunkLink(values::WadChunkLink::new(hash))
    }

    fn embedded(class: u32) -> PropertyValueEnum {
        PropertyValueEnum::Embedded(values::Embedded(values::Struct {
            class_hash: BinHash(class),
            ..Default::default()
        }))
    }

    fn container(item: Kind, items: Vec<PropertyValueEnum>) -> Container {
        let mut container = Container::empty(item).expect("a kind a container can hold");
        for value in items {
            container
                .push(value)
                .expect("an item of the container's kind");
        }
        container
    }

    #[test]
    fn the_shipped_table_holds_every_row() {
        assert_eq!(shipped().len(), 395);
        assert!(!shipped().is_empty());
    }

    #[test]
    fn the_manager_ships_the_one_table_the_deadline_names() {
        assert_eq!(tables().len(), 1);
        assert_eq!(shipped().build(), GameBuild::new(16, 17, 8_087_655));
        assert!(tables().windows(2).all(|w| w[0].build() <= w[1].build()));
    }

    #[test]
    fn the_four_conversions_come_out_at_the_counts_the_table_ships() {
        let count = |wanted| {
            shipped()
                .rows
                .values()
                .filter(|row| row.conversion == wanted)
                .count()
        };
        assert_eq!(count(Conversion::HashValue), 385);
        assert_eq!(count(Conversion::Rehash), 7);
        assert_eq!(count(Conversion::HashKey), 1);
        assert_eq!(count(Conversion::None), 2);
    }

    /// The two hashes the document tabulates, which are `FNV1a32(lowercase)` -
    /// the same hash the format itself keys a class and a field by.
    #[test]
    fn a_named_class_hashes_the_way_the_format_does() {
        assert_eq!(
            BinHash::hash_str("AnimationResourceData"),
            BinHash(0x9a4b_299d)
        );
        assert_eq!(
            BinHash::hash_str("mAnimationFilePath"),
            BinHash(0x0329_f1d7)
        );

        let migration = shipped()
            .migration(BinHash(0x9a4b_299d), BinHash(0x0329_f1d7))
            .expect("the animation row");
        assert_eq!(migration.conversion, Conversion::HashValue);
        assert_eq!(
            migration.class_name.as_deref(),
            Some("AnimationResourceData")
        );
        assert_eq!(migration.field_name.as_deref(), Some("mAnimationFilePath"));
    }

    /// The file writes hex unpadded, so `0xe31300f` is seven digits.
    #[test]
    fn a_hex_token_shorter_than_eight_digits_parses() {
        let migration = shipped()
            .migration(
                BinHash::hash_str("TFTLobbyViewController"),
                BinHash(0x0e31_300f),
            )
            .expect("the seven-digit row");
        assert_eq!(migration.conversion, Conversion::Rehash);
        assert_eq!(migration.from.kind, Kind::Hash);
        assert_eq!(migration.to.kind, Kind::WadChunkLink);
    }

    #[test]
    fn a_row_keeps_the_names_it_was_written_with_and_no_others() {
        let migration = shipped()
            .migration(
                BinHash::hash_str("TFTLobbyViewController"),
                BinHash(0x354d_2b95),
            )
            .expect("a named class with a hex field");
        assert_eq!(
            migration.class_name.as_deref(),
            Some("TFTLobbyViewController")
        );
        assert_eq!(migration.field_name, None);

        let hex_class = shipped()
            .migration(BinHash(0x13f5_0786), BinHash::hash_str("imagePath"))
            .expect("a hex class with a named field");
        assert_eq!(hex_class.class_name, None);
        assert_eq!(hex_class.field_name.as_deref(), Some("imagePath"));
    }

    /// The `binhashes` table is not wired up yet, so these are every hash the
    /// rule can name today.
    #[test]
    fn the_table_names_the_classes_and_fields_the_file_wrote_out() {
        let rows = shipped().rows.values();
        let (classes, fields) = rows.fold((0, 0), |(classes, fields), row| {
            (
                classes + usize::from(row.class_name.is_some()),
                fields + usize::from(row.field_name.is_some()),
            )
        });
        assert_eq!(classes, 216);
        assert_eq!(fields, 232);
    }

    #[test]
    fn a_property_the_table_does_not_name_has_no_migration() {
        assert!(
            shipped()
                .migration(
                    BinHash::hash_str("NoSuchClass"),
                    BinHash::hash_str("noSuchField")
                )
                .is_none()
        );
        assert!(
            shipped()
                .migration(
                    BinHash::hash_str("AnimationResourceData"),
                    BinHash::hash_str("noSuchField")
                )
                .is_none()
        );
    }

    /// The whole safety argument: a file at `from` is a problem, a file at `to`
    /// is fixed already, and a file at neither is one the rule leaves alone.
    #[test]
    fn a_leaf_matches_its_from_and_never_its_to() {
        let migration = row("AnimationResourceData", "mAnimationFilePath");
        let path = string("ASSETS/Characters/Smolder/HUD/Smolder_Circle.dds");
        let hashed = file(0xabe0_3fa5_cfa7_e5c0);

        assert!(migration.from.matches(&path));
        assert!(!migration.from.matches(&hashed));
        assert!(migration.to.matches(&hashed));
        assert!(!migration.to.matches(&path));

        let neither = PropertyValueEnum::Hash(values::Hash::new(1u32));
        assert!(!migration.from.matches(&neither));
        assert!(!migration.to.matches(&neither));
    }

    #[test]
    fn a_map_matches_on_its_key_and_its_value() {
        let migration = row("UiElementParticleSystemData", "TextureOverrides");
        assert_eq!(migration.conversion, Conversion::HashKey);

        let mut hashed =
            values::Map::empty(Kind::Hash, Kind::String).expect("kinds a map can hold");
        hashed
            .push(
                PropertyValueEnum::Hash(values::Hash::new(7u32)),
                string("a"),
            )
            .expect("a key and a value of the map's kinds");
        let hashed = PropertyValueEnum::Map(hashed);
        assert!(migration.from.matches(&hashed));
        assert!(!migration.to.matches(&hashed));

        let linked = PropertyValueEnum::Map(
            values::Map::empty(Kind::WadChunkLink, Kind::String).expect("kinds a map can hold"),
        );
        assert!(migration.to.matches(&linked));
        assert!(!migration.from.matches(&linked));

        let wrong_value = PropertyValueEnum::Map(
            values::Map::empty(Kind::Hash, Kind::I32).expect("kinds a map can hold"),
        );
        assert!(!migration.from.matches(&wrong_value));
    }

    /// An empty `Optional` still carries its variant, so the item kind reads
    /// either way and an unset property is matched as firmly as a set one.
    #[test]
    fn an_optional_matches_on_its_item_kind_whether_or_not_it_holds_one() {
        let migration = row("SkinCharacterDataProperties", "iconCircle");

        let empty = PropertyValueEnum::Optional(
            values::Optional::empty(Kind::String).expect("a kind an optional can hold"),
        );
        assert!(migration.from.matches(&empty));
        assert!(!migration.to.matches(&empty));

        let held = PropertyValueEnum::Optional(
            values::Optional::new(Kind::String, Some(string("ASSETS/x.dds"))).expect("a string"),
        );
        assert!(migration.from.matches(&held));

        let linked = PropertyValueEnum::Optional(
            values::Optional::empty(Kind::WadChunkLink).expect("a kind an optional can hold"),
        );
        assert!(migration.to.matches(&linked));
        assert!(!migration.from.matches(&linked));
    }

    #[test]
    fn a_container_matches_on_its_item_kind() {
        let migration = row("AugmentLevelTextureData", "0x8c2ded48");
        assert_eq!(migration.from.kind, Kind::UnorderedContainer);

        let paths = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::String,
            vec![string("ASSETS/a.dds"), string("ASSETS/b.dds")],
        )));
        assert!(migration.from.matches(&paths));
        assert!(!migration.to.matches(&paths));

        let links = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::WadChunkLink,
            vec![file(1)],
        )));
        assert!(migration.to.matches(&links));

        // An ordered container is a different tag, so it is neither shape.
        let ordered = PropertyValueEnum::Container(container(Kind::String, vec![string("a")]));
        assert!(!migration.from.matches(&ordered));
    }

    #[test]
    fn a_container_of_embeds_matches_on_the_class_its_items_declare() {
        let migration = row("0x73b4a2eb", "items");
        assert_eq!(migration.conversion, Conversion::None);

        let old = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::Embedded,
            vec![embedded(0x0a7c_a72c), embedded(0x0a7c_a72c)],
        )));
        assert!(migration.from.matches(&old));
        assert!(!migration.to.matches(&old));

        let renamed = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::Embedded,
            vec![embedded(0x3b8d_8b3f)],
        )));
        assert!(migration.to.matches(&renamed));

        let empty = PropertyValueEnum::UnorderedContainer(values::UnorderedContainer(container(
            Kind::Embedded,
            vec![],
        )));
        assert!(migration.from.matches(&empty));
        assert!(migration.to.matches(&empty));
    }

    #[test]
    fn an_embed_matches_on_the_class_it_declares() {
        let migration = row("0x3b09052f", "value");
        assert_eq!(migration.conversion, Conversion::None);

        assert!(migration.from.matches(&embedded(0x73b4_a2eb)));
        assert!(!migration.from.matches(&embedded(0x0a7c_a72c)));

        let pointer = PropertyValueEnum::Struct(values::Struct {
            class_hash: BinHash(0x73b4_a2eb),
            ..Default::default()
        });
        assert!(migration.to.matches(&pointer));
        assert!(!migration.from.matches(&pointer));
    }

    #[test]
    fn a_label_reads_in_the_tables_own_vocabulary() {
        let leaf = row("AnimationResourceData", "mAnimationFilePath");
        assert_eq!(leaf.from.label(), "String");
        assert_eq!(leaf.to.label(), "File");

        let list2 = row("AugmentLevelTextureData", "0x8c2ded48");
        assert_eq!(list2.from.label(), "List2<String>");
        assert_eq!(list2.to.label(), "List2<File>");

        let map = row("UiElementParticleSystemData", "TextureOverrides");
        assert_eq!(map.from.label(), "Map<Hash, String>");
        assert_eq!(map.to.label(), "Map<File, String>");

        let optional = row("SkinCharacterDataProperties", "iconCircle");
        assert_eq!(optional.from.label(), "Option<String>");

        let sized = row(
            "TftTrovesCelebrationViewControllerV2",
            "StandardItemStarLevelTexturePaths",
        );
        assert_eq!(sized.from.size, Some(3));
        assert_eq!(sized.from.label(), "List<String>");

        let embed = row("0x3b09052f", "value");
        assert_eq!(embed.from.label(), "Embed");
        assert_eq!(embed.to.label(), "Pointer");
    }

    /// A row it cannot read is a row it must not act on, so a bad line costs
    /// the rows around it nothing.
    #[test]
    fn a_line_it_cannot_read_is_skipped_rather_than_fatal() {
        let jsonl = r#"
{"class": "AnimationResourceData", "field": "mAnimationFilePath", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}

not json at all
{"class": "A", "field": "b", "from": {"type": "String"}}
{"class": "C", "field": "d", "from": {"type": "Nonesuch"}, "to": {"type": "File"}, "conversion": "hash_value"}
{"class": "E", "field": "f", "from": {"type": "Map", "key": "Vector3", "value": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}
{"class": "G", "field": "h", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "teleport"}
{"class": "0xzz", "field": "j", "from": {"type": "String"}, "to": {"type": "File"}, "conversion": "hash_value"}
"#;
        let table = MigrationTable::parse(GameBuild::new(1, 2, 3), jsonl);

        assert_eq!(table.len(), 1);
        assert_eq!(table.build(), GameBuild::new(1, 2, 3));
        assert!(
            table
                .migration(BinHash(0x9a4b_299d), BinHash(0x0329_f1d7))
                .is_some()
        );
    }

    #[test]
    fn a_table_of_nothing_holds_nothing() {
        let table = MigrationTable::parse(GameBuild::new(1, 2, 3), "\n\n   \n");
        assert!(table.is_empty());
        assert_eq!(table.len(), 0);
    }
}
