#![no_std]

//! Property Token — fractional ownership of real estate.
//! Each token = 1 share out of total_shares. Dividends distributed in XLM/USDC.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String,
};

#[contracttype]
pub enum DataKey {
    Admin,
    KycRegistry,
    ComplianceEngine,
    PropertyMeta,
    Balance(Address),
    TotalShares,
    DividendPool,
    ClaimedDividend(Address),
    DividendPerShare,
}

#[contracttype]
#[derive(Clone)]
pub struct PropertyMeta {
    pub property_id: String,
    pub legal_name: String,
    pub jurisdiction: String,
    pub address: String,
    pub total_valuation_usd: i128,
    pub total_shares: i128,
    pub property_type: String,    // "residential" | "commercial" | "land"
    pub ipfs_title_hash: String,  // off-chain title document anchor
    pub kyc_tier_required: u32,   // minimum KYC tier for shareholders
}

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP: u32 = 365 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - DAY_IN_LEDGERS;

#[contract]
pub struct PropertyToken;

#[contractimpl]
impl PropertyToken {
    pub fn initialize(
        env: Env,
        admin: Address,
        kyc_registry: Address,
        compliance_engine: Address,
        meta: PropertyMeta,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::KycRegistry, &kyc_registry);
        env.storage().instance().set(&DataKey::ComplianceEngine, &compliance_engine);
        env.storage().instance().set(&DataKey::TotalShares, &meta.total_shares);
        env.storage().instance().set(&DataKey::DividendPool, &0i128);
        env.storage().instance().set(&DataKey::DividendPerShare, &0i128);
        env.storage().instance().set(&DataKey::PropertyMeta, &meta);
    }

    // ── Metadata ─────────────────────────────────────────────────────────────

    pub fn get_meta(env: Env) -> PropertyMeta {
        env.storage().instance().get(&DataKey::PropertyMeta).unwrap()
    }

    pub fn name(env: Env) -> String { String::from_str(&env, "Veritoken Property") }
    pub fn symbol(env: Env) -> String { String::from_str(&env, "VTPROP") }
    pub fn decimals(_env: Env) -> u32 { 0 }

    // ── Share management ─────────────────────────────────────────────────────

    pub fn mint(env: Env, to: Address, shares: i128) {
        Self::require_admin(&env);
        Self::require_kyc(&env, &to);
        let bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), bal + shares);
        env.events().publish((symbol_short!("mint"), to), shares);
    }

    pub fn transfer(env: Env, from: Address, to: Address, shares: i128) {
        from.require_auth();
        Self::require_kyc(&env, &from);
        Self::require_kyc(&env, &to);
        Self::check_compliance(&env, &from, &to, shares);
        // Settle pending dividends before balance changes
        Self::settle_pending(&env, from.clone());
        Self::settle_pending(&env, to.clone());
        let from_bal = Self::read_balance(&env, from.clone());
        if from_bal < shares { panic!("insufficient shares"); }
        Self::write_balance(&env, from.clone(), from_bal - shares);
        let to_bal = Self::read_balance(&env, to.clone());
        Self::write_balance(&env, to.clone(), to_bal + shares);
        env.events()
            .publish((symbol_short!("transfer"), from, to), shares);
    }

    // ── Dividends ────────────────────────────────────────────────────────────

    /// Deposit dividend amount (in stroops) to be distributed pro-rata.
    pub fn deposit_dividend(env: Env, amount: i128) {
        Self::require_admin(&env);
        let total: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        if total == 0 { panic!("no shares issued"); }
        let dps: i128 = env.storage().instance().get(&DataKey::DividendPerShare).unwrap_or(0);
        let new_dps = dps + amount / total;
        env.storage().instance().set(&DataKey::DividendPerShare, &new_dps);
        let pool: i128 = env.storage().instance().get(&DataKey::DividendPool).unwrap_or(0);
        env.storage().instance().set(&DataKey::DividendPool, &(pool + amount));
        env.events().publish((symbol_short!("div_dep"),), amount);
    }

    pub fn claim_dividend(env: Env, holder: Address) -> i128 {
        holder.require_auth();
        let bal = Self::read_balance(&env, holder.clone());
        let dps: i128 = env.storage().instance().get(&DataKey::DividendPerShare).unwrap_or(0);
        let claimed_key = DataKey::ClaimedDividend(holder.clone());
        let claimed: i128 = env.storage().instance().get(&claimed_key).unwrap_or(0);
        let pending = bal * dps - claimed;
        if pending <= 0 { return 0; }
        env.storage().instance().set(&claimed_key, &(claimed + pending));
        env.events()
            .publish((symbol_short!("div_claim"), holder), pending);
        pending
    }

    pub fn pending_dividend(env: Env, holder: Address) -> i128 {
        let bal = Self::read_balance(&env, holder.clone());
        let dps: i128 = env.storage().instance().get(&DataKey::DividendPerShare).unwrap_or(0);
        let claimed_key = DataKey::ClaimedDividend(holder);
        let claimed: i128 = env.storage().instance().get(&claimed_key).unwrap_or(0);
        bal * dps - claimed
    }

    pub fn balance(env: Env, id: Address) -> i128 { Self::read_balance(&env, id) }
    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
    }

    // ── Internals ────────────────────────────────────────────────────────────

    fn settle_pending(env: &Env, holder: Address) {
        let bal = Self::read_balance(env, holder.clone());
        let dps: i128 = env.storage().instance().get(&DataKey::DividendPerShare).unwrap_or(0);
        let key = DataKey::ClaimedDividend(holder.clone());
        let claimed: i128 = env.storage().instance().get(&key).unwrap_or(0);
        let new_claimed = bal * dps;
        if new_claimed > claimed {
            env.storage().instance().set(&key, &new_claimed);
        }
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn require_kyc(env: &Env, addr: &Address) {
        let registry: Address = env.storage().instance().get(&DataKey::KycRegistry).unwrap();
        let client = KycRegistryClient::new(env, &registry);
        if !client.is_approved(addr) { panic!("KYC not approved"); }
    }

    fn check_compliance(env: &Env, from: &Address, to: &Address, amount: i128) {
        let engine: Address = env.storage().instance().get(&DataKey::ComplianceEngine).unwrap();
        let client = ComplianceEngineClient::new(env, &engine);
        if !client.can_transfer(from, to, &amount) {
            panic!("transfer blocked by compliance engine");
        }
    }

    fn read_balance(env: &Env, addr: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(addr)).unwrap_or(0)
    }

    fn write_balance(env: &Env, addr: Address, amount: i128) {
        let key = DataKey::Balance(addr);
        env.storage().persistent().set(&key, &amount);
        env.storage().persistent().extend_ttl(&key, THRESHOLD, BUMP);
    }
}

mod kyc_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "KycRegistryClient")]
    pub trait KycRegistry {
        fn is_approved(env: soroban_sdk::Env, addr: Address) -> bool;
    }
}

mod compliance_iface {
    use soroban_sdk::{contractclient, Address};
    #[contractclient(name = "ComplianceEngineClient")]
    pub trait ComplianceEngine {
        fn can_transfer(env: soroban_sdk::Env, from: Address, to: Address, amount: i128) -> bool;
    }
}

use kyc_iface::KycRegistryClient;
use compliance_iface::ComplianceEngineClient;
