# Signal study, step 4: can a learned model beat the hand-built edge signs?
# Reads backtest/study-rows.json.gz (STUDY=2 CALIB=1 node backtest/replay.js). Trains a gradient-boosted model on two
# seasons to predict "hit" from the book's no-vig chance plus every pre-kickoff trait, tests on the third season,
# and compares three ways of ranking picks: book only, book + edge signs, and the model.
# Run: python3 -I backtest/study-ml.py
import gzip, json, sys, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

rows = json.load(gzip.open("backtest/study-rows.json.gz"))
P = pd.DataFrame([r for r in rows if r["k"] == "p"])
dec = lambda a: 1 + a / 100 if a > 0 else 1 + 100 / -a
P["imp"] = P["a"].map(lambda a: 1 / dec(a))
band = lambda a: "big" if a <= -300 else "fav" if a <= -150 else "even" if a < 130 else "dog" if a < 300 else "long"
P["band"] = P["a"].map(band)
# book chance with the vig removed (main lines from both sides; alt lines / TDs: implied minus the band's average overround)
alt = P["nv"].isna()
hold = P[alt].assign(d=lambda d: d["imp"] - d["won"]).groupby(["mkt", "side", "band"])["d"].mean()
P["bk"] = P["nv"]
P.loc[alt, "bk"] = (P[alt]["imp"] - P[alt].set_index(["mkt", "side", "band"]).index.map(hold).values).clip(0.02, 0.98)
P["over"] = (P["side"] != "under").astype(int)
P["windy"] = ((P["dome"] == 0) & (P["wind"].fillna(0) >= 15)).astype(int)
P["windv"] = np.where(P["dome"] == 1, 0, P["wind"].fillna(0))
P["marg"] = (P["avg3"] - P["line"]) / P["line"].clip(lower=1)
P["form"] = (P["avg3"] - P["avg"]) / P["line"].clip(lower=1)
P["cv"] = P["sdv"] / P["avg"].replace(0, np.nan)
P["histd"] = P["rp"] - P["bk"]
P["sntr"] = P["sn3"] - P["snS"]
P["tgtr"] = P["tgt3"] - P["tgtS"]
P["pr"] = P["mkt"].str.contains("Pass|Rece").astype(int)
P["rec"] = P["mkt"].str.contains("Receiv").astype(int)
P["under_type"] = ((P["over"] == 0) & P["mkt"].str.contains("Rushing yards|Receptions|Rush \\+ rec")).astype(int)
P["mkt_i"] = P["mkt"].astype("category").cat.codes
SITE = P[(P["healthy"] == 1) & (P["a"] >= -700) & (P["a"] <= 250) & (P["bp"] >= 0.45)].copy()

# the hand-built signs (same points as engine.js edgeSigns)
def signs(r):
    s = 0.0; ov = r["over"] == 1; un = not ov; w = r["windv"]; windy = w >= 15
    if ov and windy: s -= 5
    if ov and 10 <= w < 15 and r["pr"]: s -= 1
    if un and windy: s += 4
    if r["tsp"] >= 4.5: s += -2 if ov else 2
    if r["under_type"]: s += 1.5
    if un and r["oppF"] < 0.98: s += 1.5
    if ov and r["oppF"] > 1.01: s += 1
    if ov and 8 <= (r["rest"] or 0) <= 10: s += 1.5
    if ov and r["home"] == 1: s += 1
    if ov and r["home"] == 0 and r["dome"] == 0 and not pd.isna(r["wind"]): s -= 1.5
    if ov and r["pr"] and (r["pass"] or 0) >= 0.61: s -= 2
    if ov and r["rec"] and (r["tgt3"] or 0) >= 0.2: s -= 1.5
    if r["wk"] <= 4 or r["gp"] <= 2: s -= 1
    if r["histd"] >= 0.12: s -= 1
    if r["missed"]: s -= 1.5
    return max(-6, min(6, s))
SITE["sg"] = SITE.apply(signs, axis=1)
SITE["p_signs"] = (SITE["bk"] + SITE["sg"] / 100).clip(0.02, 0.98)

FEATS = ["bk", "imp", "over", "td", "mkt_i", "line", "n", "rp", "histd", "h10", "h3", "since", "hn", "vs", "vsn", "avg", "avg3", "marg", "form", "cv", "gp",
         "tgt3", "tgtS", "tgtr", "ay3", "car3", "att3", "snL", "sn3", "snS", "sntr", "g50", "oppF", "inj", "missed", "home", "tsp", "tot", "rest", "orest",
         "windv", "windy", "dome", "temp", "pace", "opace", "pass", "opass", "wk", "pr", "rec", "under_type"]

def logit(p): p = np.clip(p, 0.01, 0.99); return np.log(p / (1 - p))

def evaluate(test, col, label):
    out = []
    for lo, hi in [(0.45, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0)]:
        L = test[(test["bk"] >= lo) & (test["bk"] < hi)]
        if len(L) < 300: continue
        gain = L[col] - L["bk"]; cut = gain.quantile(0.7)
        top = L[gain >= cut]; rest = L[gain < cut]
        out.append(f"    book {lo:.0%}-{hi:.0%}: top 30% by {label} hit {top['won'].mean():.1%} (book {top['bk'].mean():.1%}, said {top[col].mean():.1%}, n={len(top)}) | rest hit {rest['won'].mean():.1%} (book {rest['bk'].mean():.1%})")
    return "\n".join(out)

def parlay_sim(test, col, k=3, lo=0.65, hi=0.9, filt=None):
    won = n = 0
    for (s, wk), L in test.groupby(["s", "wk"]):
        L = L[(L["bk"] >= lo) & (L["bk"] < hi)]
        if filt is not None: L = L[filt(L)]
        if len(L) < 30: continue
        L = L.sort_values(col, ascending=False).drop_duplicates("player").head(k)
        if len(L) < k: continue
        n += 1; won += int(L["won"].all())
    return won, n

def brier(y, p): return float(np.mean((y - p) ** 2))

for test_season in [2025, 2024, 2023]:
    tr = SITE[SITE["s"] != test_season]; te = SITE[SITE["s"] == test_season].copy()
    Xtr = tr[FEATS].astype(float); Xte = te[FEATS].astype(float)
    gbm = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.04, max_depth=4, min_samples_leaf=200, l2_regularization=1.0, random_state=0)
    gbm.fit(Xtr, tr["won"])
    te["p_gbm"] = gbm.predict_proba(Xte)[:, 1]
    # logistic on the book's logit + a few features (a linear, portable model)
    lf = ["windy", "over", "under_type", "home", "tsp", "oppF", "histd", "pass", "tgt3", "rest", "wk", "gp", "missed", "marg", "form", "sn3", "sntr"]
    def lin(df):
        X = df[lf].astype(float).fillna(0).copy(); X["lb"] = logit(df["bk"].values); X["windy_ov"] = X["windy"] * X["over"]; X["tsp_ov"] = X["tsp"] * X["over"]; X["opp_ov"] = (X["oppF"] - 1) * X["over"]; X["home_ov"] = X["home"] * X["over"]; X["pass_ov"] = X["pass"] * X["over"]; X["tgt_ov"] = X["tgt3"] * X["over"]; return X
    lr = LogisticRegression(C=1.0, max_iter=2000); lr.fit(lin(tr), tr["won"]); te["p_lr"] = lr.predict_proba(lin(te))[:, 1]
    print(f"\n===== test season {test_season} (trained on the other two), {len(te)} site-type picks =====")
    print(f"  Brier score (lower = better): book {brier(te['won'], te['bk']):.4f}  signs {brier(te['won'], te['p_signs']):.4f}  logistic {brier(te['won'], te['p_lr']):.4f}  GBM {brier(te['won'], te['p_gbm']):.4f}")
    for col, label in [("p_signs", "signs"), ("p_lr", "logistic"), ("p_gbm", "GBM")]:
        print(f"  -- {label}"); print(evaluate(te, col, label))
    print("  Weekly parlays, safest picks (book 65-90%), one per player:")
    for k in (3, 5):
        wb, nb = parlay_sim(te, "bk", k)
        ws, ns = parlay_sim(te, "bk", k, filt=lambda L: L["sg"] >= 1)
        wl, nl = parlay_sim(te, "p_lr", k)
        wg, ng = parlay_sim(te, "p_gbm", k)
        wg2, ng2 = parlay_sim(te, "bk", k, filt=lambda L: (L["p_gbm"] - L["bk"]) >= 0.01)
        print(f"    {k}-pick: book {wb}/{nb}  signs-filter {ws}/{ns}  logistic-rank {wl}/{nl}  GBM-rank {wg}/{ng}  book-rank + GBM-filter {wg2}/{ng2}")
    imp = pd.Series(gbm.feature_importances_ if hasattr(gbm, "feature_importances_") else np.zeros(len(FEATS)), index=FEATS)
