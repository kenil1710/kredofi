//! Checked u128 math and share pricing (SPEC 3, security rule 8).
//! Every function panics on overflow or division by zero instead of wrapping.

use near_sdk::env;

pub fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| env::panic_str("Math overflow"))
}

pub fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| env::panic_str("Math underflow"))
}

/// floor(a * b / c) with a 256-bit intermediate (security review 2, L4: share counts can grow
/// large after heavy losses, so `a * b` may not fit in u128 even when the result does).
/// Panics only on division by zero or when the result itself exceeds u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    if c == 0 {
        env::panic_str("Division by zero");
    }
    if let Some(p) = a.checked_mul(b) {
        return p / c;
    }
    let (hi, lo) = mul_wide(a, b);
    if hi >= c {
        env::panic_str("Math overflow");
    }
    // Long division of the 256-bit (hi, lo) by c, one bit at a time; hi < c keeps the quotient in u128.
    let (mut rem, mut q) = (hi, 0u128);
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            q |= 1;
        }
    }
    q
}

/// Full 256-bit product of two u128 values as (high, low).
fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    const M: u128 = u64::MAX as u128;
    let (a1, a0, b1, b0) = (a >> 64, a & M, b >> 64, b & M);
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    let mid = (p00 >> 64) + (p01 & M) + (p10 & M);
    let lo = (p00 & M) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
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
        // Pool earned interest: 1000 shares now worth $1016 (SPEC 4a: $2 per $100 band A loan to lenders, 8 loans).
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
