//! Which audio files this mod's own bins ask for, and under what names.
//!
//! A bank is asked for by name. A skin's audio properties hold a list of bank
//! units, and each unit carries the paths of the files it needs - the media
//! bank, the events bank and any media package. That list is where a request
//! for a bank comes from, so it is what a removal has to answer to.
//!
//! **It is also the only plaintext copy of a bank's own name.** An unpacked
//! chunk is named by the hash of its path, and a name is what `audio/bank-id`
//! has to hash to derive an id, so the path a unit names is what resolves that
//! hash back. A bank no unit names is one the game never loads.
//!
//! The class rather than the class that holds it, because six classes hold bank
//! units and they all ask the same way.

use std::collections::HashMap;

use ltk_hash::{BinHash, Hash as _, WadHash};
use ltk_meta::property::Kind;
use ltk_meta::walk::{Leaf, Node, TreeNode as _, TreeValue, Visit, Visitor};

use crate::problems::{ProjectFiles, budget, walk};

/// `BankUnit`, the class naming the files one unit of a skin's audio needs.
const BANK_UNIT: BinHash = BinHash(0xa441_6515);

/// `bankPath` on that class, which is the list of those files.
const BANK_PATH: BinHash = BinHash(0x2a21_ad00);

/// Every file this mod's bank units name, by the hash a WAD addresses it by.
#[derive(Debug, Default)]
pub struct BankUnits {
    /// The path each unit named, keyed by the hash of that path.
    asked: HashMap<WadHash, String>,
    /// Whether every bin was read.
    complete: bool,
}

impl BankUnits {
    /// Read every bank unit of every bin of `project`.
    ///
    /// The second parse of every bin a run makes, so it is worth doing only
    /// once something has been found worth asking about.
    #[must_use]
    pub fn of(project: &ProjectFiles) -> Self {
        let handles: Vec<_> = project.bins().collect();
        let read = project.budget().map(
            &handles,
            budget::files_at_once(),
            |handle| handle.size_bytes().saturating_mul(budget::BIN_EXPANSION),
            |handle| match handle.bin().and_then(|bin| asked_in(&bin)) {
                Ok(paths) => Some(paths),
                Err(e) => {
                    tracing::debug!(
                        "{} names no bank units it can be read for: {e}",
                        handle.path()
                    );
                    None
                }
            },
        );

        let mut units = Self {
            asked: HashMap::new(),
            complete: true,
        };
        for found in read {
            match found.flatten() {
                Some(paths) => units.asked.extend(paths),
                None => units.complete = false,
            }
        }
        units
    }

    /// Whether anything in the mod asks for the file at `chunk`.
    ///
    /// A bin that would not parse, or a read the budget called off, might hold
    /// a request nothing here records - so an incomplete read answers yes to
    /// everything. The cost of a wrong yes is a repair not offered, and the
    /// cost of a wrong no is a file deleted out from under something asking.
    #[must_use]
    pub fn asks_for(&self, chunk: WadHash) -> bool {
        !self.complete || self.asked.contains_key(&chunk)
    }

    /// The path a bank unit named the file at `chunk` by.
    ///
    /// This is the only place a bank's own name survives an unpack, which
    /// names the chunk by its hash. `None` where no unit names it, which is a
    /// bank the game never asks for and so never loads.
    #[must_use]
    pub fn path_of(&self, chunk: WadHash) -> Option<&str> {
        self.asked.get(&chunk).map(String::as_str)
    }
}

/// Every path the bank units of one bin name, each with the hash of it.
fn asked_in(bin: &ltk_meta::BinFile) -> Result<Vec<(WadHash, String)>, String> {
    let mut asked = Asked::default();
    walk::bin(bin, &mut asked).map_err(|e| e.to_string())?;
    Ok(asked.0)
}

/// The paths every `BankUnit` node names, wherever the node sits.
#[derive(Debug, Default)]
struct Asked(Vec<(WadHash, String)>);

impl<'a, V: TreeValue<'a>> Visitor<'a, V> for Asked {
    type Error = ltk_meta::Error;

    fn enter_node(&mut self, node: &Node<'_, 'a, V>) -> Result<Visit, ltk_meta::Error> {
        if node.class_hash() != BANK_UNIT {
            return Ok(Visit::Continue);
        }
        let Some(paths) = node.inner().property(BANK_PATH)? else {
            return Ok(Visit::Continue);
        };
        if !matches!(paths.kind(), Kind::Container | Kind::UnorderedContainer) {
            return Ok(Visit::Continue);
        }
        for item in paths.children()? {
            let (_, held) = item?;
            if let Some(Leaf::String(path)) = held.leaf()? {
                self.0.push((WadHash::hash_str(path), path.to_owned()));
            }
        }
        Ok(Visit::Continue)
    }
}
