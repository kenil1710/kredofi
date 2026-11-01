//! Mock USDC: a 6-decimal NEP-141 token for local tests and testnet only.
//! Never deploy to mainnet; mainnet uses real USDC.
//!
//! Only the owner can mint. Everything else is the standard NEP-141 / NEP-145 / NEP-148
//! implementation from `near-contract-standards`.

use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, log, near,
    require,
};

pub const DECIMALS: u8 = 6;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    token: FungibleToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        let mut token = FungibleToken::new(StorageKey::Token);
        token.internal_register_account(&owner);
        Self { owner, token }
    }

    /// Owner-only mint. The receiver must already be registered (`storage_deposit`).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can mint"
        );
        require!(amount.0 > 0, "Amount must be positive");
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id,
            amount,
            memo: Some("mock-usdc mint"),
        }
        .emit();
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            log!("Account @{} burned {}", sender_id, burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Unregistering with a non-zero balance requires `force: true` (standard NEP-145 rule).
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Mock USDC (KredoFi test token)".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor);
        b
    }

    #[test]
    fn metadata_has_six_decimals() {
        testing_env!(ctx(accounts(0)).build());
        let c = Contract::new(accounts(0));
        assert_eq!(c.ft_metadata().decimals, 6);
        assert_eq!(c.ft_metadata().symbol, "USDC");
    }

    #[test]
    fn owner_mints_to_registered_account() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Contract::new(accounts(0));
        c.mint(accounts(0), U128(100_000_000)); // $100
        assert_eq!(c.ft_balance_of(accounts(0)).0, 100_000_000);
        assert_eq!(c.ft_total_supply().0, 100_000_000);
    }

    #[test]
    #[should_panic(expected = "Only the owner can mint")]
    fn non_owner_cannot_mint() {
        testing_env!(ctx(accounts(0)).build());
        let mut c = Contract::new(accounts(0));
        testing_env!(ctx(accounts(1)).build());
        c.mint(accounts(1), U128(1));
    }
}
