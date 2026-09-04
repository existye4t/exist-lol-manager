//! Unit tests for the address a trail renders to.

use super::*;
use indexmap::IndexMap;
use ltk_hash::WadHash;
use ltk_meta::path::PropertyPath;
use ltk_meta::property::values;
use ltk_meta::property::{Kind, NoMeta};
use ltk_meta::walk::{Node, Visit};
use ltk_meta::{Bin, BinObject, BinOverride, PropertyPatch};

const ENTRY: BinHash = BinHash(0x0100_0001);
const OUTER: BinHash = BinHash(0xc1a5_0001);
const INNER: BinHash = BinHash(0xc1a5_0002);

const LIST: BinHash = BinHash(0x0000_0010);
const SLOT: BinHash = BinHash(0x0000_0020);
const BY_TEXT: BinHash = BinHash(0x0000_0030);
const LEAF: BinHash = BinHash(0x0000_0040);
const BY_HASH: BinHash = BinHash(0x0000_0050);
const BY_INDEX: BinHash = BinHash(0x0000_0060);
const BY_FLAG: BinHash = BinHash(0x0000_0070);
const BY_BYTE: BinHash = BinHash(0x0000_0080);
const BY_SIGNED: BinHash = BinHash(0x0000_0090);
const BY_FLOAT: BinHash = BinHash(0x0000_00a0);
const BY_FILE: BinHash = BinHash(0x0000_00b0);

const WEAPON: BinHash = BinHash(0x0000_abcd);

/// An `INNER` node holding one leaf, the shape every step of the fixture ends on.
fn inner() -> values::Struct {
    values::Struct {
        class_hash: INNER,
        properties: IndexMap::from([(LEAF, values::U32::new(1).into())]),
        meta: NoMeta,
    }
}

/// A leaf as the walk hands it out, for a key pushed by hand.
fn leaf(value: impl Into<PropertyValueEnum>) -> PropertyValueEnum {
    value.into()
}

fn keyed(key: impl Into<PropertyValueEnum>, key_kind: Kind) -> values::Map {
    let mut map = values::Map::empty(key_kind, Kind::Struct).expect("kinds a map can hold");
    map.push(key.into(), inner().into()).unwrap();
    map
}

/// One object reaching a node through every step kind: an index, a present
/// optional, and a map keyed by every kind a key renders differently.
fn object() -> BinObject {
    let list = values::Container::new(Kind::Struct, vec![inner().into(), inner().into()])
        .expect("structs are a kind a container holds");
    let slot = values::Optional::new(Kind::Struct, Some(inner().into()))
        .expect("a struct is a kind an optional holds");

    BinObject::<NoMeta>::builder(ENTRY, OUTER)
        .property(LIST, list)
        .property(SLOT, slot)
        .property(
            BY_TEXT,
            keyed(values::String::new("weapon \"q\"".to_owned()), Kind::String),
        )
        .property(BY_HASH, keyed(values::Hash::new(WEAPON), Kind::Hash))
        .property(BY_INDEX, keyed(values::U32::new(7), Kind::U32))
        .property(BY_FLAG, keyed(values::Bool::new(true), Kind::Bool))
        .property(BY_BYTE, keyed(values::U8::new(9), Kind::U8))
        .property(BY_SIGNED, keyed(values::I32::new(-3), Kind::I32))
        .property(BY_FLOAT, keyed(values::F32::new(1.5), Kind::F32))
        .property(
            BY_FILE,
            keyed(
                values::WadChunkLink::new(WadHash(0x00c9_fd8f_1a2b_3c4d)),
                Kind::WadChunkLink,
            ),
        )
        .build()
}

fn fixture() -> Bin {
    Bin::new([object()], std::iter::empty::<&str>())
}

/// The fixture object inside a `PTCH`, beside one patch record on it.
fn patch_fixture() -> BinOverride {
    let mut patch = BinOverride::new();
    patch.objects.insert(ENTRY, object());
    patch.patches.push(PropertyPatch::new(
        ENTRY,
        PropertyPath::new("mLeaf").unwrap(),
        values::U32::new(2),
    ));
    patch
}

fn read_back(write: impl FnOnce(&mut std::io::Cursor<Vec<u8>>)) -> BinFile {
    let mut out = std::io::Cursor::new(Vec::new());
    write(&mut out);
    BinFile::from_reader(&mut std::io::Cursor::new(out.into_inner())).unwrap()
}

/// Every property's address in the hash form, beside what the trail itself
/// writes for the same position.
#[derive(Default)]
struct Rendered(Vec<(String, String)>);

impl<'a, V: TreeValue<'a>> Visitor<'a, V> for Rendered {
    type Error = ltk_meta::Error;

    fn enter_property(
        &mut self,
        field: BinHash,
        _value: V,
        node: &Node<'_, 'a, V>,
    ) -> Result<Visit, ltk_meta::Error> {
        let trail = node.trail();
        let toolkit = if trail.is_empty() {
            format!("{field:08x}")
        } else {
            format!("{trail}.{field:08x}")
        };
        let ours = Address::of(trail, field, node.class_hash(), &()).into_hashes();
        self.0.push((ours, toolkit));
        Ok(Visit::Continue)
    }
}

/// The hash form is the toolkit's own rendering, so an address recorded here
/// is the address the toolkit's `ValuePath` writes for the same position.
#[test]
fn the_hash_form_is_the_trail_the_toolkit_writes() {
    let mut rendered = Rendered::default();
    fixture().walk(&mut rendered).unwrap();

    assert_eq!(
        rendered.0.len(),
        21,
        "ten properties on the object, eleven leaves"
    );
    for (ours, toolkit) in &rendered.0 {
        assert_eq!(ours, toolkit);
    }

    let addresses: Vec<&str> = rendered.0.iter().map(|(ours, _)| ours.as_str()).collect();
    assert!(addresses.contains(&"00000010[1].00000040"), "{addresses:?}");
    assert!(addresses.contains(&"00000020[0].00000040"), "{addresses:?}");
    assert!(
        addresses.contains(&r#"00000030{"weapon \"q\""}.00000040"#),
        "{addresses:?}"
    );
    assert!(
        addresses.contains(&"00000050{0000abcd}.00000040"),
        "{addresses:?}"
    );
    assert!(addresses.contains(&"00000060{7}.00000040"), "{addresses:?}");
    assert!(
        addresses.contains(&"00000070{true}.00000040"),
        "{addresses:?}"
    );
    assert!(addresses.contains(&"00000080{9}.00000040"), "{addresses:?}");
    assert!(
        addresses.contains(&"00000090{-3}.00000040"),
        "{addresses:?}"
    );
    assert!(
        addresses.contains(&"000000a0{1.5}.00000040"),
        "{addresses:?}"
    );
    assert!(
        addresses.contains(&"000000b0{00c9fd8f1a2b3c4d}.00000040"),
        "{addresses:?}"
    );
}

/// Names a field on one class and one hash key, as a class-keyed table does.
struct Named;

impl FieldNames for Named {
    fn field(&self, field: BinHash, class: Option<BinHash>) -> Option<Cow<'_, str>> {
        match (field, class) {
            (BY_HASH, Some(OUTER)) => Some(Cow::Borrowed("byHash")),
            (LEAF, Some(INNER)) => Some(Cow::Borrowed("mLeaf")),
            _ => None,
        }
    }

    fn hash(&self, hash: BinHash) -> Option<Cow<'_, str>> {
        (hash == WEAPON).then_some(Cow::Borrowed("Weapon"))
    }
}

#[test]
fn a_name_reads_in_the_label_and_leaves_the_hash_form_alone() {
    let mut address = Address::default();
    address.push_field(BY_HASH, OUTER, &Named);
    address.push_key(&leaf(values::Hash::new(WEAPON)), &Named);
    address.push_field(LEAF, INNER, &Named);

    assert_eq!(address.hashes(), "00000050{0000abcd}.00000040");
    assert_eq!(address.named(), r#"byHash{"Weapon"}.mLeaf"#);
    assert_eq!(
        address.label().as_deref(),
        Some(r#"byHash{"Weapon"}.mLeaf"#)
    );
}

#[test]
fn a_field_named_on_another_class_stays_a_number() {
    let mut address = Address::default();
    address.push_field(LEAF, OUTER, &Named);

    assert_eq!(address.named(), "00000040");
    assert_eq!(address.label(), None);
}

#[test]
fn nothing_named_leaves_no_label() {
    let mut address = Address::default();
    address.push_field(LIST, OUTER, &());
    address.push_index(3);
    address.push_key(&leaf(values::U8::new(9)), &());

    assert_eq!(address.hashes(), "00000010[3]{9}");
    assert_eq!(address.named(), address.hashes());
    assert_eq!(address.label(), None);
}

/// The repair holds the map it walks mutably and keeps a copy of each key.
/// The copy renders exactly as the walk's borrowed key does.
#[test]
fn a_copied_key_renders_as_the_walks_own() {
    let mut rendered = Rendered::default();
    fixture().walk(&mut rendered).unwrap();

    let mut by_hand = Address::default();
    by_hand.push_field(BY_TEXT, OUTER, &());
    by_hand.push_key(&leaf(values::String::new("weapon \"q\"".to_owned())), &());
    by_hand.push_field(LEAF, INNER, &());

    assert!(
        rendered.0.iter().any(|(ours, _)| ours == by_hand.hashes()),
        "{by_hand:?}"
    );
}

#[test]
fn a_bin_of_either_kind_walks_its_objects() {
    let prop = read_back(|out| fixture().to_writer(out).unwrap());
    let patch = read_back(|out| patch_fixture().to_writer(out).unwrap());
    assert!(matches!(patch, BinFile::Override(_)));

    let mut from_prop = Rendered::default();
    bin(&prop, &mut from_prop).unwrap();
    let mut from_patch = Rendered::default();
    bin(&patch, &mut from_patch).unwrap();

    assert_eq!(from_prop.0.len(), 21);
    assert_eq!(from_patch.0, from_prop.0, "a patch record is not walked");
}
