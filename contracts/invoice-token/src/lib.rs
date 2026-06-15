#![no_std]

//! Invoice Token — tokenizes accounts-receivable invoices.
//! Each token unit represents 1 USD (7-decimal precision) of invoice face value.
//! Adds invoice-specific metadata: issuer, debtor, due date, face value, discount rate.

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

#[contracttype]
pub enum DataKey {
    Admin,
    KycRegistry,
    ComplianceEngine,
    InvoiceMeta,
    Balance(Address),
    TotalSupply,
    Settled,
}

#[contracttype]
#[derive(Clone)]
pub struct InvoiceMeta {
    pub invoice_id: String,
    pub issuer: String,
    pub debtor: String,
    pub face_value_usd: i128,   // in stroops (7 decimals)
    pub discount_rate_bps: u32, // basis points
    pub due_date: u64,          // Unix timestamp
    pub currency: String,
    pub ipfs_doc_hash: String, // off-chain document anchor
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 90 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

#[contract]
pub struct InvoiceToken;

#[contractimpl]
impl InvoiceToken {
    pub fn initialize(
        env: Env,
        admin: Address,
        kyc_registry: Address,
        compliance_engine: Address,
        meta: InvoiceMeta,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::KycRegistry, &kyc_registry);
        env.storage()
            .instance()
            .set(&DataKey::ComplianceEngine, &compliance_engine);
        env.storage().instance().set(&DataKey::InvoiceMeta, &meta);
        env.storage().instance().set(&DataKey::TotalSupply, &0i128);
        env.storage().instance().set(&DataKey::Settled, &false);
    }

    // ── Metadata ─────────────────────────────────────────────────────────────

    pub fn get_meta(env: Env) -> InvoiceMeta {
        env.storage().instance().get(&DataKey::InvoiceMeta).unwrap()
    }

    pub fn name(env: Env) -> String {
        String::from_str(&env, "Veritoken Invoice")
    }
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "VTINV")
    }
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /// Mint tokens to represent this invoice. Admin-only.
    /// face_value_usd in the meta determines the max supply.
    pub fn issue(env: Env, to: Address, amount: i128) {
        Self::require_admin(&env);
        Self::require_kyc(&env, &to);
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Settled)
            .unwrap_or(false)
        {
            panic!("invoice already settled");
        }
        let bal = Self::read_balance(&env, to.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(bal + amount));
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Balance(to.clone()), THRESHOLD, BUMP);
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));
        env.events().publish((symbol_short!("issued"), to), amount);
    }

    /// Mark invoice as settled and enable redemption burns.
    pub fn settle(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Settled, &true);
        env.events().publish((symbol_short!("settled"),), ());
    }

    /// Burn tokens upon settlement / redemption.
    pub fn redeem(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if !env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Settled)
            .unwrap_or(false)
        {
            panic!("invoice not yet settled");
        }
        let bal = Self::read_balance(&env, from.clone());
        if bal < amount {
            panic!("insufficient balance");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal - amount));
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));
        env.events()
            .publish((symbol_short!("redeemed"), from), amount);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::read_balance(&env, id)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn is_settled(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Settled)
            .unwrap_or(false)
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn require_kyc(env: &Env, addr: &Address) {
        let registry: Address = env.storage().instance().get(&DataKey::KycRegistry).unwrap();
        let client = KycRegistryClient::new(env, &registry);
        if !client.is_approved(addr) {
            panic!("KYC not approved");
        }
    }

    fn read_balance(env: &Env, addr: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(addr))
            .unwrap_or(0)
    }
}

mod kyc_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "KycRegistryClient")]
    #[allow(dead_code)]
    pub trait KycRegistry {
        fn is_approved(env: soroban_sdk::Env, addr: Address) -> bool;
    }
}
use kyc_iface::KycRegistryClient;
