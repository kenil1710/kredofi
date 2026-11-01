import json, statistics
LEVEL_CAP = {1: 100, 2: 250, 3: 500, 4: 1000}
BAND_PCT = {"A": 1.0, "B": 0.75, "C": 0.5, "D": 0.0}

def score(profile):
    acct = profile["override_accounts"][0]
    txs = acct["transactions"]
    months = sorted({t["date_transacted"][:7] for t in txs})
    inc = {m: 0.0 for m in months}
    spend = 0.0; fees = 0
    for t in txs:
        a = t["amount"]; d = t["description"].upper()
        if a < 0: inc[t["date_transacted"][:7]] += -a
        else: spend += a
        if "OVERDRAFT" in d or "NSF" in d or "RETURNED" in d: fees += 1
    n = len(months); monthly = list(inc.values())
    avg_inc = sum(monthly) / n
    m_with = sum(1 for v in monthly if v > 0)
    cv = statistics.pstdev(monthly) / avg_inc if avg_inc else 9
    tot_inc = sum(monthly)
    p_income = 250 if avg_inc >= 3000 else 180 if avg_inc >= 2000 else 100 if avg_inc >= 1000 else 40
    p_stab = round(150 * m_with / n) + (100 if cv <= 0.15 else 50 if cv <= 0.4 else 0)
    p_pay = max(0, 250 - 60 * fees)
    ratio = (tot_inc - spend) / tot_inc if tot_inc else -1
    p_cash = 150 if ratio >= 0.3 else 100 if ratio >= 0.1 else 50 if ratio >= 0 else 0
    bal = acct["starting_balance"]; avg_sp = spend / n
    buf = bal / avg_sp if avg_sp else 9
    p_buf = 100 if buf >= 3 else 60 if buf >= 1 else 30 if buf >= 0.3 else 0
    s = p_income + p_stab + p_pay + p_cash + p_buf
    band = "A" if s >= 800 else "B" if s >= 650 else "C" if s >= 500 else "D"
    income_cap = min(1000, int(avg_inc * 0.5 // 50 * 50))
    limit_l1 = min(LEVEL_CAP[1] * BAND_PCT[band], income_cap)
    return dict(score=s, band=band, parts=[p_income, p_stab, p_pay, p_cash, p_buf],
                avg_income=round(avg_inc), cv=round(cv, 2), fees=fees, cash_ratio=round(ratio, 2),
                buffer_months=round(buf, 1), income_cap=income_cap, level1_limit=limit_l1)

for f in ["good.json", "risky.json", "cheater.json"]:
    print(f, score(json.load(open(f))["profile"]))
