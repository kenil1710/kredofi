//! Checked u128 math and share pricing (SPEC 3, security rule 8).
//! Every function panics on overflow or division by zero instead of wrapping.

use near_sdk::env;

pub fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| env::panic_str("Math overflow"))
}

pub fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| env::panic_str("Math underflow"))
}

/// floor(a * b / c)
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    if c == 0 {
        env::panic_str("Division by zero");
    }
    a.checked_mul(b)
        .unwrap_or_else(|| env::panic_str("Math overflow"))
        / c
}

/// Shares minted for a deposit of `amount` into a pool worth `pool_value` with `total_shares`.
/// First deposit (or empty pool) mints 1 share per USDC base unit.
/// Rounds down, so rounding always favours existing lenders.
pub fn shares_for_deposit(amount: u128, pool_value: u128, total_shares: u128) -> u128 {
    if total_shares == 0 {
        return amount;
    }
    if pool_value == 0 {
        env::panic_str("Pool has shares but no value; deposits are closed");
    }
    mul_div(amount, total_shares, pool_value)
}

/// USDC paid out for burning `shares`. Rounds down (favours the lenders who stay).
pub fn value_of_shares(shares: u128, pool_value: u128, total_shares: u128) -> u128 {
    if total_shares == 0 {
        return 0;
    }
    mul_div(shares, pool_value, total_shares)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u128 = 1_000_000; // 6 decimals

    #[test]
    fn first_deposit_is_one_share_per_base_unit() {
        assert_eq!(shares_for_deposit(100 * USDC, 0, 0), 100 * USDC);
    }

    #[test]
    fn deposit_at_par() {
        assert_eq!(shares_for_deposit(50 * USDC, 100 * USDC, 100 * USDC), 50 * USDC);
    }

    #[test]
    fn deposit_after_price_rise_gets_fewer_shares() {
        // Pool earned interest: 1000 shares now worth $1016 (SPEC 4a: $1.60 per $100 loan to lenders x10).
        let shares = shares_for_deposit(1016 * USDC, 1016 * USDC, 1000 * USDC);
        assert_eq!(shares, 1000 * USDC);
        let shares = shares_for_deposit(100 * USDC, 1016 * USDC, 1000 * USDC);
        assert_eq!(shares, 98_425_196); // floor(100e6 * 1000 / 1016)
    }

    #[test]
    fn withdraw_value_after_price_rise_and_after_loss() {
        assert_eq!(value_of_shares(500 * USDC, 1016 * USDC, 1000 * USDC), 508 * USDC);
        // Uncovered default: pool value fell from 1000 to 950.
        assert_eq!(value_of_shares(500 * USDC, 950 * USDC, 1000 * USDC), 475 * USDC);
    }

    #[test]
    fn rounding_never_creates_value() {
        // Deposit then immediately withdraw at an awkward price never returns more than was put in.
        let (value, shares) = (1_000_000_007u128, 999_999_991u128);
        for amount in [1u128, 7, 999, 1_234_567, 100 * USDC] {
            let minted = shares_for_deposit(amount, value, shares);
            let back = value_of_shares(minted, value + amount, shares + minted);
            assert!(back <= amount, "amount {amount} came back as {back}");
        }
    }

    #[test]
    fn empty_pool_shares_are_worth_zero() {
        assert_eq!(value_of_shares(10, 0, 0), 0);
    }

    #[test]
    #[should_panic(expected = "deposits are closed")]
    fn deposit_into_zero_value_pool_with_shares_panics() {
        shares_for_deposit(100, 0, 100);
    }

    #[test]
    #[should_panic(expected = "Math overflow")]
    fn overflow_panics() {
        mul_div(u128::MAX, 2, 1);
    }

    #[test]
    #[should_panic(expected = "Math underflow")]
    fn underflow_panics() {
        sub(1, 2);
    }

    #[test]
    #[should_panic(expected = "Division by zero")]
    fn div_zero_panics() {
        mul_div(1, 1, 0);
    }
}
