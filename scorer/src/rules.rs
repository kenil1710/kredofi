//! SPEC 6 scoring rules: open, deterministic, integer cents in, points out.
//! Plaid sign convention: negative amount = money in, positive = money out.

/// One posted transaction of the scored account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tx {
    /// `YYYY-MM-DD`
    pub date: String,
    pub amount_cents: i64,
    pub name: String,
}

/// Features over the last 6 full months (SPEC 5 step 4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Features {
    /// Money in per month, oldest first. Zero months included.
    pub monthly_income_cents: [i64; 6],
    pub spending_cents: i64,
    pub fee_events: u32,
    pub balance_cents: i64,
    pub tx_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Parts {
    pub income: u16,
    pub stability: u16,
    pub payment: u16,
    pub cash_flow: u16,
    pub buffer: u16,
}

impl Parts {
    pub fn total(&self) -> u16 {
        self.income + self.stability + self.payment + self.cash_flow + self.buffer
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Score {
    pub parts: Parts,
    pub score: u16,
    pub band: &'static str,
    /// USDC dollars, multiple of 50, at most 1000.
    pub income_cap_usd: u64,
}

const FEE_WORDS: [&str; 3] = ["OVERDRAFT", "NSF", "RETURNED"];

/// Collect features for the 6 window months (`YYYY-MM`, oldest first).
/// Transactions outside the window are ignored.
pub fn features(txs: &[Tx], window: &[String; 6], balance_cents: i64) -> Features {
    let mut monthly = [0i64; 6];
    let mut spending = 0i64;
    let mut fees = 0u32;
    let mut count = 0usize;
    for t in txs {
        let Some(i) = window.iter().position(|m| t.date.get(..7) == Some(m.as_str())) else {
            continue;
        };
        count += 1;
        if t.amount_cents < 0 {
            monthly[i] = monthly[i].saturating_add(-t.amount_cents);
        } else {
            spending = spending.saturating_add(t.amount_cents);
        }
        let name = t.name.to_uppercase();
        if FEE_WORDS.iter().any(|w| name.contains(w)) {
            fees += 1;
        }
    }
    Features {
        monthly_income_cents: monthly,
        spending_cents: spending,
        fee_events: fees,
        balance_cents,
        tx_count: count,
    }
}

/// SPEC 6 table.
pub fn score(f: &Features) -> Score {
    let total_income: i64 = f.monthly_income_cents.iter().sum();
    let avg_income = total_income as f64 / 6.0; // cents

    let income = if avg_income >= 300_000.0 {
        250
    } else if avg_income >= 200_000.0 {
        180
    } else if avg_income >= 100_000.0 {
        100
    } else {
        40
    };

    let months_with_income = f.monthly_income_cents.iter().filter(|m| **m > 0).count() as u16;
    let cv = if avg_income > 0.0 {
        let var = f
            .monthly_income_cents
            .iter()
            .map(|m| (*m as f64 - avg_income).powi(2))
            .sum::<f64>()
            / 6.0;
        var.sqrt() / avg_income
    } else {
        f64::INFINITY
    };
    let stability = 150 * months_with_income / 6
        + if cv <= 0.15 {
            100
        } else if cv <= 0.40 {
            50
        } else {
            0
        };

    let payment = 250u16.saturating_sub(60u16.saturating_mul(f.fee_events.min(5) as u16));

    let cash_flow = if total_income > 0 {
        let ratio = (total_income - f.spending_cents) as f64 / total_income as f64;
        if ratio >= 0.3 {
            150
        } else if ratio >= 0.1 {
            100
        } else if ratio >= 0.0 {
            50
        } else {
            0
        }
    } else {
        0
    };

    let avg_spending = f.spending_cents as f64 / 6.0;
    let buffer_months = if avg_spending > 0.0 {
        f.balance_cents as f64 / avg_spending
    } else if f.balance_cents > 0 {
        f64::INFINITY
    } else {
        0.0
    };
    let buffer = if buffer_months >= 3.0 {
        100
    } else if buffer_months >= 1.0 {
        60
    } else if buffer_months >= 0.3 {
        30
    } else {
        0
    };

    let parts = Parts { income, stability, payment, cash_flow, buffer };
    let score = parts.total();
    let band = match score {
        800.. => "A",
        650..=799 => "B",
        500..=649 => "C",
        _ => "D",
    };
    // min(1000, floor(avg * 0.5 / 50) * 50) dollars == floor(total_cents / 60000) * 50.
    let income_cap_usd = ((total_income.max(0) / 60_000) as u64 * 50).min(1000);
    Score { parts, score, band, income_cap_usd }
}

#[cfg(test)]
#[allow(clippy::inconsistent_digit_grouping)] // dollars_cents literals
mod tests {
    use super::*;

    fn f(monthly_usd: [i64; 6], spending_usd: i64, fees: u32, balance_usd: i64) -> Features {
        Features {
            monthly_income_cents: monthly_usd.map(|m| m * 100),
            spending_cents: spending_usd * 100,
            fee_events: fees,
            balance_cents: balance_usd * 100,
            tx_count: 0,
        }
    }

    #[test]
    fn income_thresholds() {
        for (m, pts) in [(3000, 250), (2999, 180), (2000, 180), (1999, 100), (1000, 100), (999, 40), (0, 40)] {
            assert_eq!(score(&f([m; 6], 0, 0, 0)).parts.income, pts, "monthly {m}");
        }
    }

    #[test]
    fn stability_counts_months_and_cv() {
        assert_eq!(score(&f([1000; 6], 0, 0, 0)).parts.stability, 250);
        // 4 of 6 months, high CV.
        assert_eq!(score(&f([1500, 0, 3200, 800, 0, 2500], 0, 0, 0)).parts.stability, 100);
        // 6 months, CV between 0.15 and 0.40.
        assert_eq!(score(&f([1000, 1000, 1000, 1000, 1500, 500], 0, 0, 0)).parts.stability, 200);
        assert_eq!(score(&f([0; 6], 0, 0, 0)).parts.stability, 0);
    }

    #[test]
    fn payment_loses_60_per_fee_floor_zero() {
        for (fees, pts) in [(0, 250), (1, 190), (4, 10), (5, 0), (40, 0)] {
            assert_eq!(score(&f([0; 6], 0, fees, 0)).parts.payment, pts);
        }
    }

    #[test]
    fn cash_flow_ratio() {
        // income 6000 total
        for (spend, pts) in [(4200, 150), (4201, 100), (5400, 100), (5401, 50), (6000, 50), (6001, 0)] {
            assert_eq!(score(&f([1000; 6], spend, 0, 0)).parts.cash_flow, pts, "spend {spend}");
        }
        assert_eq!(score(&f([0; 6], 0, 0, 0)).parts.cash_flow, 0, "no income");
    }

    #[test]
    fn buffer_months() {
        // avg spending 1000/month
        for (bal, pts) in [(3000, 100), (2999, 60), (1000, 60), (999, 30), (300, 30), (299, 0), (-50, 0)] {
            assert_eq!(score(&f([0; 6], 6000, 0, bal)).parts.buffer, pts, "balance {bal}");
        }
        assert_eq!(score(&f([0; 6], 0, 0, 10)).parts.buffer, 100, "no spending, positive balance");
        assert_eq!(score(&f([0; 6], 0, 0, 0)).parts.buffer, 0);
    }

    #[test]
    fn bands_and_income_cap() {
        assert_eq!(score(&f([4000; 6], 10560, 0, 6000)).income_cap_usd, 1000);
        assert_eq!(score(&f([1500, 0, 3200, 800, 0, 2500], 0, 0, 0)).income_cap_usd, 650);
        assert_eq!(score(&f([99; 6], 0, 0, 0)).income_cap_usd, 0);
        assert_eq!(score(&f([100; 6], 0, 0, 0)).income_cap_usd, 50);
    }

    #[test]
    fn features_use_window_and_sign() {
        let w: [String; 6] = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map(String::from);
        let tx = |d: &str, a: i64, n: &str| Tx { date: d.into(), amount_cents: a, name: n.into() };
        let txs = vec![
            tx("2026-04-30", -999_00, "OLD PAYROLL"), // outside window
            tx("2026-05-01", -4000_00, "PAYROLL"),
            tx("2026-05-03", 1200_00, "RENT"),
            tx("2026-10-15", 35_00, "Overdraft Fee"),
            tx("2026-10-16", 35_00, "NSF RETURNED ITEM FEE"),
            tx("2026-11-01", -4000_00, "PAYROLL"), // current month: outside
        ];
        let fe = features(&txs, &w, 500_00);
        assert_eq!(fe.monthly_income_cents, [400_000, 0, 0, 0, 0, 0]);
        assert_eq!(fe.spending_cents, 1270_00);
        assert_eq!(fe.fee_events, 2, "one per transaction, case-insensitive");
        assert_eq!(fe.tx_count, 4);
    }
}
