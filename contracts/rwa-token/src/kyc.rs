use soroban_sdk::{Address, Env};

use crate::storage_types::{DataKey, INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};

pub fn read_kyc_registry(env: &Env) -> Address {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage().instance().get(&DataKey::KycRegistry).unwrap()
}

pub fn write_kyc_registry(env: &Env, registry: &Address) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    env.storage()
        .instance()
        .set(&DataKey::KycRegistry, registry);
}

/// Cross-contract call to the KYC registry to verify a holder is approved.
pub fn require_kyc(env: &Env, addr: &Address) {
    let registry = read_kyc_registry(env);
    let client = KycRegistryClient::new(env, &registry);
    if !client.is_approved(addr) {
        panic!("KYC not approved");
    }
}

mod kyc_registry_interface {
    use soroban_sdk::{contractclient, Address};

    #[contractclient(name = "KycRegistryClient")]
    #[allow(dead_code)]
    pub trait KycRegistryInterface {
        fn is_approved(env: soroban_sdk::Env, addr: Address) -> bool;
    }
}
use kyc_registry_interface::KycRegistryClient;
