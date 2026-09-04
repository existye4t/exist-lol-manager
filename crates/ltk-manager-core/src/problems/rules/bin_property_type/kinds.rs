//! The table's type names, and the kinds `ltk_meta` calls them.
//!
//! The two vocabularies are the meta dumper's and the reader's, and the mapping
//! between them is a table rather than a guess. It lives beside the reader that
//! needs it.
//!
//! | The table | `ltk_meta::Kind`     | Tag    |
//! | --------- | -------------------- | ------ |
//! | `String`  | `String`             | `16`   |
//! | `Hash`    | `Hash`               | `17`   |
//! | `File`    | `WadChunkLink`       | `18`   |
//! | `List`    | `Container`          | `0x80` |
//! | `List2`   | `UnorderedContainer` | `0x81` |
//! | `Pointer` | `Struct`             | `0x82` |
//! | `Embed`   | `Embedded`           | `0x83` |
//! | `Option`  | `Optional`           | `0x85` |
//! | `Map`     | `Map`                | `0x86` |
//! | `Flag`    | `BitBool`            | `0x87` |
//!
//! A `Map` key is a primitive and a retype moves one, so `Bool`, `I32`, `U32`
//! and `U8` reach here too, each under the name `ltk_meta` already writes for
//! it.

use ltk_meta::property::Kind;

/// Every name the table writes, beside the kind it means.
///
/// One list rather than two matches, so the two directions cannot disagree.
/// Both columns are distinct, which is what makes them exact inverses.
const NAMES: &[(&str, Kind)] = &[
    ("String", Kind::String),
    ("Hash", Kind::Hash),
    ("File", Kind::WadChunkLink),
    ("List", Kind::Container),
    ("List2", Kind::UnorderedContainer),
    ("Pointer", Kind::Struct),
    ("Embed", Kind::Embedded),
    ("Option", Kind::Optional),
    ("Map", Kind::Map),
    ("Flag", Kind::BitBool),
    ("Bool", Kind::Bool),
    ("I32", Kind::I32),
    ("U32", Kind::U32),
    ("U8", Kind::U8),
];

/// The kind a table's type name means.
///
/// Returns `None` for a name this mapping does not hold, which is a row the
/// rule skips and logs.
#[must_use]
pub fn kind(name: &str) -> Option<Kind> {
    NAMES
        .iter()
        .find(|(written, _)| *written == name)
        .map(|&(_, kind)| kind)
}

/// The name a table writes for a kind.
#[must_use]
pub fn name(kind: Kind) -> Option<&'static str> {
    NAMES
        .iter()
        .find(|(_, meant)| *meant == kind)
        .map(|&(written, _)| written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_name_the_table_writes_round_trips() {
        for &(written, meant) in NAMES {
            assert_eq!(kind(written), Some(meant), "{written} did not read back");
            assert_eq!(name(meant), Some(written), "{meant:?} did not write back");
        }
    }

    #[test]
    fn every_tag_the_document_tabulates_maps_the_way_it_says() {
        assert_eq!(kind("String"), Some(Kind::String));
        assert_eq!(kind("Hash"), Some(Kind::Hash));
        assert_eq!(kind("File"), Some(Kind::WadChunkLink));
        assert_eq!(kind("List"), Some(Kind::Container));
        assert_eq!(kind("List2"), Some(Kind::UnorderedContainer));
        assert_eq!(kind("Pointer"), Some(Kind::Struct));
        assert_eq!(kind("Embed"), Some(Kind::Embedded));
        assert_eq!(kind("Option"), Some(Kind::Optional));
        assert_eq!(kind("Map"), Some(Kind::Map));
        assert_eq!(kind("Flag"), Some(Kind::BitBool));
    }

    #[test]
    fn the_primitives_the_table_names_carry_their_own_names() {
        assert_eq!(kind("Bool"), Some(Kind::Bool));
        assert_eq!(kind("I32"), Some(Kind::I32));
        assert_eq!(kind("U32"), Some(Kind::U32));
        assert_eq!(kind("U8"), Some(Kind::U8));
    }

    /// `File` is the table's word and `WadChunkLink` is `ltk_meta`'s, so the
    /// reader's own name is not a name this mapping answers to.
    #[test]
    fn a_name_the_mapping_does_not_hold_is_none() {
        assert_eq!(kind("WadChunkLink"), None);
        assert_eq!(kind("string"), None);
        assert_eq!(kind("Vector3"), None);
        assert_eq!(kind(""), None);
    }

    #[test]
    fn a_kind_the_table_never_writes_has_no_name() {
        assert_eq!(name(Kind::None), None);
        assert_eq!(name(Kind::Vector3), None);
        assert_eq!(name(Kind::ObjectLink), None);
    }
}
