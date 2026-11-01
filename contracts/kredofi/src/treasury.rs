//! KredoFi treasury (SPEC 4 Owner, 4a; rule 10).
//!
//! The treasury is KredoFi's half of interest. The owner can (1) withdraw it, always to the
//! owner account, with a rollback if the transfer fails, or (2) move it into the reserve,
//! one-way. Neither touches pool cash, outstanding principal or the reserve's own funds:
//! both are capped by `pool.treasury`, and nothing moves money out of the reserve.

use crate::*;

#[near]
impl Contract {
    /// Owner: send `amount` of the treasury to the owner account. 1 yoctoNEAR.
    #[payable]
    pub fn withdraw_treasury(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let owner = self.config.owner.clone();
        require!(env::predecessor_account_id() == owner, "Only the owner can withdraw the treasury");
        let amount = amount.0;
        require!(amount > 0, "Amount must be positive");
        require!(amount <= self.pool.treasury, "Amount is above the treasury balance");

        // State first (rule 7).
        self.pool.treasury = math::sub(self.pool.treasury, amount);

        ext_ft::ext(self.config.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(owner.clone(), U128(amount), Some("KredoFi treasury".into()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_treasury_transfer(owner, U128(amount)),
            )
    }

    /// Rollback callback for `withdraw_treasury`. Returns true if the owner was paid.
    #[private]
    pub fn on_treasury_transfer(&mut self, to: AccountId, amount: U128) -> bool {
        if near_sdk::is_promise_success() {
            events::emit(
                "treasury_withdrawn",
                json!({ "to": to, "amount": amount, "treasury": U128(self.pool.treasury) }),
            );
            true
        } else {
            self.pool.treasury = math::add(self.pool.treasury, amount.0);
            env::log_str(&format!("Treasury transfer to {to} failed; restored {}", amount.0));
            false
        }
    }

    /// Owner: move `amount` from the treasury into the first-loss reserve. One-way; no
    /// method moves reserve funds back. 1 yoctoNEAR.
    #[payable]
    pub fn treasury_to_reserve(&mut self, amount: U128) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.config.owner,
            "Only the owner can move the treasury"
        );
        let amount = amount.0;
        require!(amount > 0, "Amount must be positive");
        require!(amount <= self.pool.treasury, "Amount is above the treasury balance");
        self.pool.treasury = math::sub(self.pool.treasury, amount);
        self.pool.reserve = math::add(self.pool.reserve, amount);
        events::emit(
            "treasury_to_reserve",
            json!({
                "amount": U128(amount),
                "treasury": U128(self.pool.treasury),
                "reserve": U128(self.pool.reserve),
                "by": env::predecessor_account_id(),
            }),
        );
    }
}
