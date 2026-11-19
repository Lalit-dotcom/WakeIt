#!/usr/bin/env python3
"""Analysis for the WakeIt cold-start study.

Reads every bench/results/coldstart*.csv and e3*.csv file (one pair per client
laptop) and writes bench/analysis/out/summary.json plus the paper's figures (PDF).
Run from the repository root:  python3 bench/analysis/analyze.py
Needs: pandas, numpy, scipy, matplotlib.

Clients ("vantage points") are labelled A and B in the paper:
  A = india-laptop  (coldstart.csv, e3.csv)
  B = nikhil-laptop (coldstart.nikhil.csv, e3.nikhil.csv)
Sessions are identified by client and local start date, because the session
names typed on the command line (night1, day1) do not always match the clock.
"""
import glob, json, os
import numpy as np, pandas as pd
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "results")
OUT = os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(20261116)  # fixed seed: bootstrap results are repeatable
CLIENT = {"india-laptop": "A", "nikhil-laptop": "B"}
GAP_S = 1.5  # a gap of at least this size between sorted cold starts separates two levels

def boot_ci(x, n=10000):
    x = np.asarray(x, float)
    meds = np.median(RNG.choice(x, size=(n, len(x)), replace=True), axis=1)
    return [round(float(np.percentile(meds, 2.5)), 2), round(float(np.percentile(meds, 97.5)), 2)]

def desc(x):
    x = np.asarray(x, float)
    q1, q3 = np.percentile(x, [25, 75])
    return dict(n=int(len(x)), median=round(float(np.median(x)), 2), q1=round(float(q1), 2), q3=round(float(q3), 2),
                iqr=round(float(q3 - q1), 2), p90=round(float(np.percentile(x, 90)), 2),
                min=round(float(x.min()), 2), max=round(float(x.max()), 2), ci95=boot_ci(x))

def cliffs_delta(a, b):
    a, b = np.asarray(a), np.asarray(b)
    gt = sum((x > b).sum() for x in a); lt = sum((x < b).sum() for x in a)
    return round(float((gt - lt) / (len(a) * len(b))), 3)

def mwu(a, b):
    u, p = stats.mannwhitneyu(a, b, alternative="two-sided")
    return dict(U=float(u), p=round(float(p), 4), cliffs_delta=cliffs_delta(a, b), n=[len(a), len(b)])

def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i]); adj = [0.0] * len(ps); run = 0.0
    for r, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - r) * ps[i])); adj[i] = round(run, 4)
    return adj

def load(pattern):
    frames = [pd.read_csv(f) for f in sorted(glob.glob(os.path.join(RES, pattern)))]
    d = pd.concat(frames, ignore_index=True)
    d["client"] = d.vantage.map(CLIENT).fillna(d.vantage)
    return d

S = {}

# ---------------- E1 / E2: cold starts ----------------
c = load("coldstart*.csv")
c["region"] = c["region"].str.capitalize()
c["ist"] = pd.to_datetime(c.utc_start, utc=True) + pd.Timedelta(hours=5, minutes=30)
c["session_typed"] = c["session"]
c["session"] = c.client + ", " + c.ist.dt.strftime("%d %b").str.lstrip("0")
S["e1_rows"] = int(len(c))
S["e1_rows_by_client"] = c.client.value_counts().to_dict()
S["e1_sessions"] = {s: dict(n=int(len(g)), start_ist=g.ist.min().strftime("%Y-%m-%d %H:%M"), end_ist=g.ist.max().strftime("%Y-%m-%d %H:%M"),
                            label_typed=sorted(g.session_typed.unique().tolist()))
                    for s, g in c.groupby("session")}
failed = c[c.cold_ok == 0]
answered = c[c.cold_ok == 1].copy()
# A row is a cold start only if the process was younger than the request itself (+10 s margin).
answered["is_cold"] = answered.uptime_ms_at_probe < answered.cold_total_ms + 10000
not_cold = answered[~answered.is_cold]
v = answered[answered.is_cold].copy()
S["e1_failed"] = failed[["client", "session", "target", "cycle", "utc_start", "status_sequence"]].to_dict("records")
S["e1_not_cold"] = not_cold[["client", "session", "target", "cycle", "utc_start", "cold_total_ms", "uptime_ms_at_probe"]].to_dict("records")
S["e1_valid_n"] = int(len(v)); S["e1_valid_by_client"] = v.client.value_counts().to_dict()
S["e1_status_sequences"] = v.status_sequence.astype(str).value_counts().to_dict()
S["e1_first_content_types"] = v.first_content_type.value_counts().to_dict()
S["e1_cold_evidence"] = v.cold_evidence.value_counts().to_dict()
S["e1_attempts_max"] = int(v.attempts.max())

v["cold_s"] = v.cold_total_ms / 1000
S["cold_all"] = desc(v.cold_s)
S["cold_by_client"] = {k: desc(g.cold_s) for k, g in v.groupby("client")}
S["cold_by_region"] = {r: desc(g.cold_s) for r, g in v.groupby("region")}
S["cold_by_session"] = {s: desc(g.cold_s) for s, g in v.groupby("session")}
S["cold_by_session_region"] = {f"{s}|{r}": desc(g.cold_s) for (s, r), g in v.groupby(["session", "region"])}
S["cold_by_client_region"] = {f"{k}|{r}": desc(g.cold_s) for (k, r), g in v.groupby(["client", "region"])}
S["warm_ms_by_client_region"] = {f"{k}|{r}": desc(g.warm_median_ms) for (k, r), g in v.groupby(["client", "region"])}
S["edge_by_client"] = {k: g.first_headers.astype(str).str.extract(r"cf-ray[^-]*-([A-Z]{3})")[0].value_counts().to_dict() for k, g in v.groupby("client")}

# Levels: split the sorted durations wherever two neighbours are at least GAP_S apart.
xs = np.sort(v.cold_s.values); cut = np.where(np.diff(xs) >= GAP_S)[0]
groups = np.split(xs, cut + 1)
S["level_gaps"] = [dict(below=round(float(xs[i]), 2), above=round(float(xs[i + 1]), 2), gap=round(float(xs[i + 1] - xs[i]), 2)) for i in cut]
big = [g for g in groups if len(g) >= 10]          # the populated levels
names = ["L1", "L2", "L3"][:len(big)]
edges = [(float(g.min()), float(g.max())) for g in big]
def level(x):
    for n_, (lo, hi) in zip(names, edges):
        if lo <= x <= hi: return n_
    return "slow"
v["level"] = v.cold_s.map(level)
S["levels"] = {l: desc(g.cold_s) for l, g in v.groupby("level")}
S["level_steps_s"] = [round(S["levels"][names[i + 1]]["median"] - S["levels"][names[i]]["median"], 2) for i in range(len(names) - 1)]
S["level_counts_by_session"] = {s: g.level.value_counts().to_dict() for s, g in v.groupby("session")}
S["level_counts_by_session_region"] = {f"{s}|{r}": g.level.value_counts().to_dict() for (s, r), g in v.groupby(["session", "region"])}
S["level_counts_by_client"] = {k: g.level.value_counts().to_dict() for k, g in v.groupby("client")}
S["slow_runs"] = v[v.level == "slow"][["session", "region", "cycle", "cold_s", "status_sequence", "app_listening_ms"]].to_dict("records")
inl = v[v.level != "slow"]
ct = pd.crosstab(inl.session, inl.level)
chi = stats.chi2_contingency(ct.values)
S["level_session_chi2"] = dict(chi2=round(float(chi[0]), 2), dof=int(chi[2]), p=float(f"{chi[1]:.3g}"), table=ct.to_dict())

# Decomposition, all from the server's own clock except the totals:
#   app      = process start -> listening
#   routing  = listening -> first request delivered to the app
#   network  = warm response time
#   before   = cold total - first-request time - network  (time before the process existed)
v["app_s"] = v.app_listening_ms / 1000
v["routing_s"] = (v.app_first_request_ms - v.app_listening_ms) / 1000
v["network_s"] = v.warm_median_ms / 1000
v["before_s"] = v.cold_s - v.app_first_request_ms / 1000 - v.network_s
parts = ["before_s", "app_s", "routing_s", "network_s"]
S["decomp_all"] = {p: desc(v[p]) for p in parts}
S["decomp_by_level"] = {l: {p: desc(g[p]) for p in parts} for l, g in v.groupby("level")}
S["decomp_by_client"] = {k: {p: desc(g[p]) for p in parts} for k, g in v.groupby("client")}
S["app_s_share_le_1_7"] = round(float((v.app_s <= 1.7).mean()), 3)

# RQ2 tests, Holm-corrected together: region, client, session (level mix).
t_reg = mwu(v[v.region == "Singapore"].cold_s, v[v.region == "Oregon"].cold_s)
t_cli = mwu(v[v.client == "A"].cold_s, v[v.client == "B"].cold_s)
kw = stats.kruskal(*[g.cold_s.values for _, g in v.groupby("session")])
ps = [t_reg["p"], t_cli["p"], float(kw.pvalue), S["level_session_chi2"]["p"]]
adj = holm(ps)
S["test_region"] = {**t_reg, "p_holm": adj[0]}
S["test_client"] = {**t_cli, "p_holm": adj[1]}
S["test_session_kruskal"] = dict(H=round(float(kw.statistic), 2), p=round(float(kw.pvalue), 4), p_holm=adj[2])
S["level_session_chi2"]["p_holm"] = adj[3]
S["test_region_by_client"] = {k: mwu(g[g.region == "Singapore"].cold_s, g[g.region == "Oregon"].cold_s) for k, g in v.groupby("client")}

# ---------------- E3: WakeIt off vs on ----------------
e = load("e3*.csv")
e["key"] = e.client + "-" + e.cycle.astype(str)
S["e3_rows"] = int(len(e)); S["e3_errors"] = int(e.error.notna().sum())
S["e3_seed_by_client"] = {k: int(g.seed.iloc[0]) for k, g in e.groupby("client")}
S["e3_cold_evidence"] = e.cold_evidence.value_counts().to_dict()
S["e3_action_status"] = e.action_status.astype(str).value_counts().to_dict()
e["ist"] = pd.to_datetime(e.utc_start, utc=True) + pd.Timedelta(hours=5, minutes=30)
S["e3_period_ist"] = {k: [g.ist.min().strftime("%Y-%m-%d %H:%M"), g.ist.max().strftime("%Y-%m-%d %H:%M")] for k, g in e.groupby("client")}
OFF = e[e["mode"] == "off"].set_index("key").sort_index(); ON = e[e["mode"] == "on"].set_index("key").sort_index()
OFF = OFF.assign(boot_s=(OFF.t_done_ms - OFF.t_click_ms) / 1000, wait_s=OFF.wait_after_intent_ms / 1000, done_s=OFF.t_done_ms / 1000, think_s=OFF.think_ms / 1000)
ON = ON.assign(boot_s=(ON.t_wakeit_ready_ms - ON.t_probe_start_ms) / 1000, wait_s=ON.wait_after_intent_ms / 1000, done_s=ON.t_done_ms / 1000,
               think_s=ON.think_ms / 1000, intent_s=ON.t_intent_ms / 1000)
# Model check on the WakeIt runs, using each run's own measured boot time:
#   predicted wait after intent = max(0, boot - time of intent)
ON["pred_wait_s"] = np.maximum(0, ON.boot_s + ON.t_probe_start_ms / 1000 - ON.intent_s)
ON["resid_s"] = ON.wait_s - ON.pred_wait_s
# Same-boot saving: what the same run would have taken had the boot started at the click.
ON["saving_s"] = ON.intent_s + ON.boot_s - ON.done_s

def e3_block(off, on):
    R = {}
    R["pairs"] = int(len(on))
    R["boot_off"] = desc(off.boot_s); R["boot_on"] = desc(on.boot_s); R["boot_test"] = mwu(off.boot_s, on.boot_s)
    R["wait_off"] = desc(off.wait_s); R["wait_on"] = desc(on.wait_s)
    w = stats.wilcoxon(off.wait_s, on.wait_s)
    R["wait_wilcoxon"] = dict(W=float(w.statistic), p=float(f"{w.pvalue:.3g}"), n=int(len(on)))
    diff = off.wait_s - on.wait_s
    R["wait_reduction_paired"] = desc(diff); R["pairs_on_shorter"] = int((diff > 0).sum())
    by = {}
    for t in sorted(on.think_s.unique()):
        o, n_ = off[off.think_s == t], on[on.think_s == t]
        by[str(int(t))] = dict(n=int(len(n_)), wait_off=round(float(o.wait_s.median()), 1), wait_on=round(float(n_.wait_s.median()), 1),
                               wait_on_min=round(float(n_.wait_s.min()), 1), wait_on_max=round(float(n_.wait_s.max()), 1),
                               wait_off_min=round(float(o.wait_s.min()), 1), wait_off_max=round(float(o.wait_s.max()), 1),
                               saving_same_run=round(float(n_.saving_s.median()), 1),
                               model_saving=round(float(np.minimum(n_.think_s, n_.boot_s).median()), 1))
    R["by_think"] = by
    R["model_mae_s"] = round(float(on.resid_s.abs().mean()), 3)
    R["model_resid"] = desc(on.resid_s)
    R["model_pearson_r"] = round(float(np.corrcoef(on.pred_wait_s, on.wait_s)[0, 1]), 4)
    R["feedback_first_ms"] = desc(on.t_warming_shown_ms)
    R["action_rtt_on_s"] = desc((on.t_done_ms - on.t_click_ms) / 1000)
    return R

S["e3_all"] = e3_block(OFF, ON)
S["e3_by_client"] = {k: e3_block(OFF[OFF.client == k], ON[ON.client == k]) for k in sorted(ON.client.unique())}

json.dump(S, open(os.path.join(OUT, "summary.json"), "w"), indent=1, default=str)

# ---------------- figures (greyscale-safe: markers, fills, hatching) ----------------
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"font.family": "serif", "font.size": 8, "axes.linewidth": 0.6, "pdf.fonttype": 42,
                     "axes.spines.top": False, "axes.spines.right": False, "xtick.major.width": 0.6, "ytick.major.width": 0.6})
W = 3.45  # IEEE column width in inches
INK, MID = "#111111", "#777777"

# Fig. 2: every cold start as a dot, one row per session; filled = Singapore, open = Oregon.
sessions = sorted(v.session.unique(), key=lambda s: v[v.session == s].ist.min())
fig, ax = plt.subplots(figsize=(W, 1.6))
for lv in names:
    lo, hi = S["levels"][lv]["min"], S["levels"][lv]["max"]
    ax.axvspan(lo - 0.15, hi + 0.15, color="#ececec", lw=0)
    ax.text((lo + hi) / 2, len(sessions) - 0.25, f"{S['levels'][lv]['median']:.1f}", ha="center", va="top", fontsize=6.5, color=MID)
for i, s in enumerate(sessions):
    for r, filled, dy in [("Singapore", True, 0.14), ("Oregon", False, -0.14)]:
        g = v[(v.session == s) & (v.region == r)].cold_s.values
        y = len(sessions) - 1 - i + dy + RNG.uniform(-0.07, 0.07, len(g))
        ax.plot(g, y, "o", ms=3.6, mfc=INK if filled else "white", mec=INK, mew=0.7, ls="none", label=r if i == 0 else None)
ax.set_yticks(range(len(sessions))); ax.set_yticklabels(sessions[::-1])
ax.set_xlim(0, 35); ax.set_xlabel("Cold-start duration (s)"); ax.set_ylim(-0.6, len(sessions) - 0.15)
ax.grid(axis="x", lw=0.3, color="#cccccc"); ax.set_axisbelow(True); ax.tick_params(axis="y", length=0)
ax.legend(loc="upper right", frameon=False, fontsize=6.5, handletextpad=0.1, borderaxespad=0.1)
fig.tight_layout(pad=0.3); fig.savefig(os.path.join(OUT, "fig_cold.pdf")); plt.close(fig)

# Fig. 3: decomposition of each level (medians), stacked horizontal bars.
fig, ax = plt.subplots(figsize=(W, 1.5))
labels = [("before_s", "Before the process starts", "#111111", None), ("app_s", "Application start-up", "#ffffff", None),
          ("routing_s", "Listening, awaiting first request", "#a8a8a8", None), ("network_s", "Network", "#ffffff", "//////")]
order = names[::-1]
for i, lv in enumerate(order):
    left = 0
    for key, lab, col, hatch in labels:
        val = S["decomp_by_level"][lv][key]["median"]
        ax.barh(i, val, left=left, height=0.55, color=col, edgecolor=INK, lw=0.6, hatch=hatch, label=lab if i == 0 else None)
        if val > 1.6:
            ax.text(left + val / 2, i, f"{val:.1f}", ha="center", va="center", fontsize=7, color="white" if col == "#111111" else INK)
        left += val
ax.set_yticks(range(len(order))); ax.set_yticklabels([f"~{S['levels'][l]['median']:.1f} s (n={S['levels'][l]['n']})" for l in order])
ax.set_xlabel("Median time (s)"); ax.set_xlim(0, 25); ax.set_ylim(-0.5, len(order) - 0.5); ax.tick_params(axis="y", length=0)
fig.legend(loc="lower center", ncol=2, frameon=False, fontsize=7, handlelength=1.4, columnspacing=1.0, bbox_to_anchor=(0.5, 0.0))
fig.tight_layout(pad=0.3, rect=(0, 0.23, 1, 1)); fig.savefig(os.path.join(OUT, "fig_decomp.pdf")); plt.close(fig)

# Fig. 4: wait after the user's intended action, by think-time, without and with WakeIt (both clients).
fig, ax = plt.subplots(figsize=(W, 1.55))
ts = sorted(ON.think_s.unique())
for j, t in enumerate(ts):
    a = OFF[OFF.think_s == t].wait_s.values; b = ON[ON.think_s == t].wait_s.values
    ax.plot(j - 0.17 + RNG.uniform(-0.06, 0.06, len(a)), a, "o", ms=3.8, mfc="white", mec=INK, mew=0.7, ls="none", label="Without WakeIt" if j == 0 else None)
    ax.plot(j + 0.17 + RNG.uniform(-0.06, 0.06, len(b)), b, "o", ms=3.8, mfc=INK, mec=INK, mew=0.7, ls="none", label="With WakeIt" if j == 0 else None)
    ax.hlines(np.median(a), j - 0.32, j - 0.02, color=INK, lw=1.2); ax.hlines(np.median(b), j + 0.02, j + 0.32, color=INK, lw=1.2)
ax.set_xticks(range(len(ts))); ax.set_xticklabels([f"{int(t)} s" for t in ts]); ax.set_xlabel("Think-time before the action")
ax.set_ylabel("Wait after intent (s)"); ax.set_ylim(0, 46); ax.grid(axis="y", lw=0.3, color="#cccccc"); ax.set_axisbelow(True)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, frameon=False, fontsize=7, handletextpad=0.2, borderaxespad=0.1)
fig.tight_layout(pad=0.3); fig.savefig(os.path.join(OUT, "fig_wakeit.pdf")); plt.close(fig)

print(json.dumps(S, indent=1, default=str))
