"""Generate 3 fake Plaid sandbox borrowers (6 months of history each).
Plaid sign: negative amount = money IN (salary), positive = money OUT (spending)."""
import json
from datetime import date, timedelta

def months_back(n):
    today = date.today().replace(day=1)
    out = []
    for i in range(n, 0, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            m += 12; y -= 1
        out.append(date(y, m, 1))
    return out

def tx(d, amount, desc):
    s = d.isoformat()
    return {"date_transacted": s, "date_posted": s, "currency": "USD", "amount": amount, "description": desc}

def borrower(name, start_balance, monthly):
    txs = []
    for i, m in enumerate(months_back(6)):
        txs += monthly(i, m)
    return {"profile": {
        "seed": name, "roll_dates_forward": True,
        "override_accounts": [{
            "type": "depository", "subtype": "checking", "starting_balance": start_balance,
            "identity": {"names": [name]},
            "transactions": txs,
        }],
    }}

def good(i, m):
    return [tx(m, -4000, "ACME CORP PAYROLL"),
            tx(m + timedelta(days=2), 1200, "RENT PAYMENT"),
            tx(m + timedelta(days=8), 320, "GROCERY MART"),
            tx(m + timedelta(days=12), 90, "CITY UTILITIES"),
            tx(m + timedelta(days=20), 150, "RESTAURANT")]

def risky(i, m):
    pay = [1500, 0, 3200, 800, 0, 2500][i]
    out = [tx(m + timedelta(days=3), 1100, "RENT PAYMENT"),
           tx(m + timedelta(days=9), 260, "GROCERY MART")]
    if pay:
        out.append(tx(m + timedelta(days=5), -pay, "GIG PLATFORM PAYOUT"))
    if i in (1, 4):
        out.append(tx(m + timedelta(days=15), 35, "OVERDRAFT FEE"))
        out.append(tx(m + timedelta(days=16), 35, "NSF RETURNED ITEM FEE"))
    return out

def cheater(i, m):
    return [tx(m, -3800, "GLOBEX PAYROLL"),
            tx(m + timedelta(days=2), 1150, "RENT PAYMENT"),
            tx(m + timedelta(days=9), 300, "GROCERY MART"),
            tx(m + timedelta(days=14), 120, "ONLINE SHOPPING")]

for fname, b in [("good.json", borrower("Riya Good", 6000, good)),
                 ("risky.json", borrower("Sam Risky", 3000, risky)),
                 ("cheater.json", borrower("Max Cheater", 5000, cheater))]:
    with open(fname, "w") as f:
        json.dump(b, f)
    n = len(b["profile"]["override_accounts"][0]["transactions"])
    print(f"{fname}: {n} transactions, {len(json.dumps(b))} bytes")
