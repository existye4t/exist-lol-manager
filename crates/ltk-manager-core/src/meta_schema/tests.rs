//! What the schema answers, and what it declines to answer.

use super::*;

/// The build `FloatTextIconData.mIconFileName` was a `String` at.
const BEFORE_RETYPE: GameBuild = GameBuild::new(16, 16, 8_049_184);

/// The build it became a `File` at, which is 16.17.
const AFTER_RETYPE: GameBuild = GameBuild::new(16, 17, 8_104_348);

const FLOAT_TEXT_ICON_DATA: BinHash = BinHash(0x16d8_8f43);
const M_ICON_FILE_NAME: BinHash = BinHash(0x1053_7b0c);
const M_OFFSET: BinHash = BinHash(0x26db_cd4b);
/// An `Option` on both sides of the retype, so the kind alone cannot tell them apart.
const ICON_CIRCLE: BinHash = BinHash(0xe672_84f4);
const UNCENSORED_ICON_CIRCLES: BinHash = BinHash(0x8ce0_4c3d);
/// A `List` the schema fixes at seven items.
const M_VALUES: BinHash = BinHash(0x0a1b_2c3d);
/// An `Option` holding a type this build cannot map.
const M_HOLDS_SOMETHING_NEW: BinHash = BinHash(0x0bad_f00d);

/// The published shape, cut to the one class the case turns on.
fn published() -> String {
    String::from(
        r#"{
          "formatVersion": 1,
          "hashSource": { "fetchedAt": "2026-08-24T03:56:00Z" },
          "latest": 8104348,
          "classes": {
            "0x16d88f43": {
              "name": "FloatTextIconData",
              "properties": {
                "0x10537b0c": {
                  "name": "mIconFileName",
                  "revisions": [
                    { "from": 5229820, "to": 8049184, "type": ["String", "0x0", "0x0", "0x0"] },
                    { "from": 8104348, "type": ["File", "0x0", "0x0", "0x0"] }
                  ]
                },
                "0x26dbcd4b": {
                  "name": "mOffset",
                  "revisions": [
                    { "from": 5229820, "type": ["Vec2", "0x0", "0x0", "0x0"] }
                  ]
                },
                "0xdeadbeef": {
                  "name": "mUnnameable",
                  "revisions": [
                    { "from": 5229820, "type": ["SomethingNew", "0x0", "0x0", "0x0"] }
                  ]
                },
                "0xe67284f4": {
                  "name": "iconCircle",
                  "revisions": [
                    { "from": 5229820, "to": 8049184, "type": ["Option", "0x0", "String", "0x0"] },
                    { "from": 8104348, "type": ["Option", "0x0", "File", "0x0"] }
                  ]
                },
                "0x8ce04c3d": {
                  "name": "uncensoredIconCircles",
                  "revisions": [
                    { "from": 5229820, "type": ["Map", "Hash", "File", "0x0"] }
                  ]
                },
                "0x0a1b2c3d": {
                  "name": "mValues",
                  "revisions": [
                    { "from": 5229820, "type": ["List", "0x7", "F32", "0x0"] }
                  ]
                },
                "0x0badf00d": {
                  "name": "mHoldsSomethingNew",
                  "revisions": [
                    { "from": 5229820, "type": ["Option", "0x0", "SomethingNew", "0x0"] }
                  ]
                }
              }
            }
          }
        }"#,
    )
}

fn schema() -> MetaSchema {
    MetaSchema::parse(published().as_bytes()).expect("the fixture is the published shape")
}

/// Story: this is the case the whole rule exists for. A mod writes the field as
/// a `String`, the game on 16.17 registers it as a `File`, and the game throws
/// the value away without a word.
#[test]
fn a_retyped_property_answers_per_build() {
    let schema = schema();

    let before = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, BEFORE_RETYPE)
        .expect("the database covers 16.16");
    let after = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, AFTER_RETYPE)
        .expect("the database covers 16.17");

    assert_eq!(before.shape, Some(Shape::bare(Kind::String)));
    assert_eq!(after.shape, Some(Shape::bare(Kind::WadChunkLink)));
    assert_eq!(after.class_name, Some("FloatTextIconData"));
    assert_eq!(after.field_name, Some("mIconFileName"));
}

/// Story: `iconCircle` is an `Option` before and after Riot retyped what it
/// holds, so the kind alone calls both sides equal. What a complex type holds
/// is part of the answer, or the retype is invisible.
#[test]
fn a_complex_type_answers_with_its_subtypes() {
    let schema = schema();

    let before = schema
        .expected(FLOAT_TEXT_ICON_DATA, ICON_CIRCLE, BEFORE_RETYPE)
        .unwrap();
    let after = schema
        .expected(FLOAT_TEXT_ICON_DATA, ICON_CIRCLE, AFTER_RETYPE)
        .unwrap();
    let map = schema
        .expected(FLOAT_TEXT_ICON_DATA, UNCENSORED_ICON_CIRCLES, AFTER_RETYPE)
        .unwrap();

    assert_eq!(
        before.shape,
        Some(Shape {
            kind: Kind::Optional,
            key: None,
            value: Some(Kind::String),
        })
    );
    assert_eq!(
        after.shape,
        Some(Shape {
            kind: Kind::Optional,
            key: None,
            value: Some(Kind::WadChunkLink),
        })
    );
    assert_eq!(
        map.shape,
        Some(Shape {
            kind: Kind::Map,
            key: Some(Kind::Hash),
            value: Some(Kind::WadChunkLink),
        })
    );
}

/// A list writes its fixed size where a map writes its key kind, and a count
/// is not a type name to refuse the whole revision over.
#[test]
fn a_fixed_size_list_answers_its_item_kind_and_no_key() {
    let schema = schema();

    let found = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_VALUES, AFTER_RETYPE)
        .unwrap();

    assert_eq!(
        found.shape,
        Some(Shape {
            kind: Kind::Container,
            key: None,
            value: Some(Kind::F32),
        })
    );
}

/// A subtype this build cannot map is as unreadable as a kind it cannot, so
/// the revision declines to answer rather than answering for the wrapper alone.
#[test]
fn an_unmappable_subtype_answers_without_a_type() {
    let schema = schema();

    let found = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_HOLDS_SOMETHING_NEW, AFTER_RETYPE)
        .expect("the revision is found");

    assert_eq!(found.shape, None);
    assert_eq!(found.field_name, Some("mHoldsSomethingNew"));
}

/// A revision's `to` is the last build it held for, not the first build after
/// it, so the two revisions must not both claim the build on the boundary.
#[test]
fn the_end_of_a_revision_is_inclusive() {
    let schema = schema();

    let at_boundary = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, BEFORE_RETYPE)
        .unwrap();

    assert_eq!(
        at_boundary.shape,
        Some(Shape::bare(Kind::String)),
        "8049184 is the last build of the String revision, not the first of the File one"
    );
}

/// A property that never changed answers the same at every build.
#[test]
fn a_property_with_one_revision_answers_everywhere() {
    let schema = schema();

    for build in [BEFORE_RETYPE, AFTER_RETYPE] {
        let found = schema
            .expected(FLOAT_TEXT_ICON_DATA, M_OFFSET, build)
            .unwrap();
        assert_eq!(found.shape, Some(Shape::bare(Kind::Vector2)));
    }
}

/// Story: a schema that says nothing is not evidence of anything, so an unknown
/// class, an unknown property and a build before the first revision are all
/// silence rather than a mismatch.
#[test]
fn what_the_database_does_not_describe_is_silence() {
    let schema = schema();

    assert_eq!(
        schema.expected(BinHash(0x0000_0001), M_ICON_FILE_NAME, AFTER_RETYPE),
        None,
        "a class it does not hold"
    );
    assert_eq!(
        schema.expected(FLOAT_TEXT_ICON_DATA, BinHash(0x0000_0001), AFTER_RETYPE),
        None,
        "a property it does not hold"
    );
    assert_eq!(
        schema.expected(
            FLOAT_TEXT_ICON_DATA,
            M_ICON_FILE_NAME,
            GameBuild::new(13, 14, 5_000_000)
        ),
        None,
        "a build older than every revision"
    );
}

/// A type name this build cannot map is a revision that answers `None` rather
/// than one that answers wrongly. The revision is still found, so the property
/// is not mistaken for one the database does not describe.
#[test]
fn an_unmappable_type_name_answers_without_a_kind() {
    let schema = schema();

    let found = schema
        .expected(FLOAT_TEXT_ICON_DATA, BinHash(0xdead_beef), AFTER_RETYPE)
        .expect("the revision is found");

    assert_eq!(found.shape, None);
    assert_eq!(found.field_name, Some("mUnnameable"));
}

/// Story: a game newer than the database is one the database cannot speak
/// about, and checking against a stale schema would report a mod as broken for
/// a change the schema has not taken yet.
#[test]
fn a_build_past_the_database_is_one_it_does_not_describe() {
    let schema = schema();

    assert!(schema.describes(AFTER_RETYPE));
    assert!(schema.describes(BEFORE_RETYPE));
    assert!(!schema.describes(GameBuild::new(16, 18, 8_200_000)));
}

#[test]
fn a_database_at_another_layout_is_refused() {
    let json = published().replace("\"formatVersion\": 1", "\"formatVersion\": 2");

    let error = MetaSchema::parse(json.as_bytes()).expect_err("a layout this build does not read");

    assert!(
        matches!(error, MetaSchemaError::Format { found: 2 }),
        "{error:?}"
    );
}

#[test]
fn bytes_that_are_not_the_database_are_refused() {
    let error = MetaSchema::parse(b"not json").expect_err("not the published shape");

    assert!(matches!(error, MetaSchemaError::Parse(_)), "{error:?}");
}

#[test]
fn the_generation_is_the_publishers_own_stamp() {
    assert_eq!(schema().generation(), "2026-08-24T03:56:00Z");
}

/// The two vocabularies are exact inverses, which is what keeps a finding's
/// words and the kind it matched on from disagreeing.
#[test]
fn every_type_name_round_trips() {
    for &(name, kind) in NAMES {
        assert_eq!(kind_named(name), Some(kind), "{name}");
        assert_eq!(name_of(kind), Some(name), "{kind:?}");
    }
}

/// The hash keys are unpadded hex under `0x`, which is what the publisher
/// writes and what a leading-zero class would otherwise be lost by.
#[test]
fn a_short_hash_key_parses() {
    assert_eq!(parse_hash("0x6516a"), Some(BinHash(0x0006_516a)));
    assert_eq!(parse_hash("0x16d88f43"), Some(BinHash(0x16d8_8f43)));
    assert_eq!(parse_hash("not a hash"), None);
}

/// Story: the shipped snapshot is the real published database, not a fixture,
/// and every check stands on it before any sync. If it stops parsing, or stops
/// answering the case the rule was built for, the rule is silently blind again.
#[test]
fn the_shipped_snapshot_answers_the_case_the_rule_exists_for() {
    let schema = MetaSchema::shipped();

    assert!(
        schema.class_count() > 5_000,
        "the published database describes thousands of classes, found {}",
        schema.class_count()
    );

    let after = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, AFTER_RETYPE)
        .expect("FloatTextIconData.mIconFileName is in the published database");
    assert_eq!(after.shape, Some(Shape::bare(Kind::WadChunkLink)));
    assert_eq!(after.class_name, Some("FloatTextIconData"));
    assert_eq!(after.field_name, Some("mIconFileName"));

    let before = schema
        .expected(FLOAT_TEXT_ICON_DATA, M_ICON_FILE_NAME, BEFORE_RETYPE)
        .expect("the same property before Riot retyped it");
    assert_eq!(
        before.shape,
        Some(Shape::bare(Kind::String)),
        "the mod's String is right for 16.16 and wrong for 16.17, which is the whole point"
    );
}

/// Every type name the published database actually writes has to map, or the
/// rule goes quiet on those properties without anyone noticing.
#[test]
fn the_shipped_snapshot_writes_no_type_name_this_build_cannot_map() {
    let schema = MetaSchema::shipped();

    let unmapped = schema
        .classes
        .values()
        .flat_map(|class| class.properties.values())
        .flat_map(|property| property.revisions.iter())
        .filter(|revision| revision.shape.is_none())
        .count();

    assert_eq!(
        unmapped, 0,
        "every revision in the published database names a type this build maps"
    );
}

/// Story: every rule of every mod in a sweep asks the same database, so it is
/// opened once and held. A sync installs a newer one, and the sweep that runs
/// behind that sync must not still be reading the copy the app started with.
#[test]
fn the_shared_schema_is_held_open_and_reopened_after_a_sync() {
    let first = shared(None);
    assert!(
        Arc::ptr_eq(&first, &shared(None)),
        "asked twice, opened once"
    );

    invalidate();

    assert!(
        !Arc::ptr_eq(&first, &shared(None)),
        "a sync installed a database, so the next ask opens it"
    );
}

/// A revision is keyed on a build, and which copy covers the install is decided
/// when it is opened - so an ask about another build cannot be served the
/// choice made for the first.
#[test]
fn the_shared_schema_reopens_for_another_build() {
    let installed = shared(Some(GameBuild::new(16, 17, 8_104_348)));

    assert!(
        !Arc::ptr_eq(&installed, &shared(Some(GameBuild::new(13, 15, 5_229_820)))),
        "a different install is a different choice of database"
    );
}
