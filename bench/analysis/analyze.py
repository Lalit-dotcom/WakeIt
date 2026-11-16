#!/usr/bin/env python3
"""Analysis for the WakeIt cold-start study.

Reads bench/results/coldstart.csv and bench/results/e3.csv and writes
bench/analysis/out/summary.json plus the paper's figures (PDF).
Run from the repository root:  python3 bench/analysis/analyze.py
Needs: pandas, numpy, scipy, matplotlib.
"""
import json, os
import numpy as np, pandas as pd
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "results")
OUT = os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(20261116)  # fixed seed: bootstrap results are repeatable

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

S = {}

# ---------------- E1 / E2: cold starts ----------------
c = pd.read_csv(os.path.join(RES, "coldstart.csv"))
c["region"] = c["region"].str.capitalize()
# Sessions are named night1, day1, night2, ...; group them by time of day.
c["session"] = np.where(c["session"].str.startswith("night"), "night1", "day1")
S["e1_rows"] = int(len(c))
failed = c[c.cold_ok == 0]
answered = c[c.cold_ok == 1].copy()
# A row is a cold start only if the process was younger than the request itself (+10 s margin).
answered["is_cold"] = answered.uptime_ms_at_probe < answered.cold_total_ms + 10000
not_cold = answered[~answered.is_cold]
v = answered[answered.is_cold].copy()
S["e1_failed"] = failed[["session", "target", "cycle", "utc_start", "status_sequence"]].to_dict("records")
S["e1_not_cold"] = not_cold[["session", "target", "cycle", "utc_start", "cold_total_ms", "uptime_ms_at_probe"]].to_dict("records")
S["e1_valid_n"] = int(len(v))
S["e1_status_sequences"] = v.status_sequence.astype(str).value_counts().to_dict()
S["e1_first_content_types"] = v.first_content_type.value_counts().to_dict()
S["e1_attempts_max"] = int(v.attempts.max())

v["cold_s"] = v.cold_total_ms / 1000
S["cold_all"] = desc(v.cold_s)
S["cold_by_region"] = {r: desc(g.cold_s) for r, g in v.groupby("region")}
S["cold_by_region_session"] = {f"{r}|{s}": desc(g.cold_s) for (r, s), g in v.groupby(["region", "session"])}
S["cold_by_session"] = {s: desc(g.cold_s) for s, g in v.groupby("session")}
S["warm_ms_by_region"] = {r: desc(g.warm_median_ms) for r, g in v.groupby("region")}
S["test_region"] = mwu(v[v.region == "Singapore"].cold_s, v[v.region == "Oregon"].cold_s)
S["test_session"] = mwu(v[v.session == "night1"].cold_s, v[v.session == "day1"].cold_s)

# Two clusters: find the largest gap between sorted values.
xs = np.sort(v.cold_s.values); gaps = np.diff(xs); k = int(gaps.argmax())
S["cluster_gap"] = dict(lower_max=round(float(xs[k]), 2), upper_min=round(float(xs[k + 1]), 2), gap=round(float(gaps[k]), 2))
thr = (xs[k] + xs[k + 1]) / 2
v["cluster"] = np.where(v.cold_s < thr, "short", "long")
S["clusters"] = {cl: desc(g.cold_s) for cl, g in v.groupby("cluster")}
S["cluster_counts"] = {f"{r}|{s}": g.cluster.value_counts().to_dict() for (r, s), g in v.groupby(["region", "session"])}
S["cluster_by_region"] = {r: g.cluster.value_counts().to_dict() for r, g in v.groupby("region")}
ct = pd.crosstab(v.region, v.cluster)
S["cluster_region_fisher_p"] = round(float(stats.fisher_exact(ct.values)[1]), 4)

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
S["decomp_by_cluster"] = {cl: {p: desc(g[p]) for p in parts} for cl, g in v.groupby("cluster")}
S["decomp_by_region"] = {r: {p: desc(g[p]) for p in parts} for r, g in v.groupby("region")}
S["decomp_share_of_median_pct"] = {p: round(100 * float(v[p].median()) / float(sum(v[q].median() for q in parts)), 1) for p in parts}
S["platform_overhead_simple_s"] = desc(v.platform_overhead_ms / 1000)

# ---------------- E3: WakeIt off vs on ----------------
e = pd.read_csv(os.path.join(RES, "e3.csv"))
S["e3_rows"] = int(len(e)); S["e3_errors"] = int(e.error.notna().sum()); S["e3_seed"] = int(e.seed.iloc[0])
S["e3_cold_evidence"] = e.cold_evidence.value_counts().to_dict()
S["e3_action_status"] = e.action_status.astype(str).value_counts().to_dict()
off = e[e["mode"] == "off"].set_index("cycle"); on = e[e["mode"] == "on"].set_index("cycle")
off = off.assign(boot_s=(off.t_done_ms - off.t_click_ms) / 1000, wait_s=off.wait_after_intent_ms / 1000, done_s=off.t_done_ms / 1000)
on = on.assign(boot_s=(on.t_wakeit_ready_ms - on.t_probe_start_ms) / 1000, wait_s=on.wait_after_intent_ms / 1000, done_s=on.t_done_ms / 1000,
               think_s=on.think_ms / 1000, intent_s=on.t_intent_ms / 1000)
off["think_s"] = off.think_ms / 1000
S["e3_pairs"] = int(len(on))
S["e3_boot_off"] = desc(off.boot_s); S["e3_boot_on"] = desc(on.boot_s)
S["e3_boot_test"] = mwu(off.boot_s, on.boot_s)
S["e3_wait_off"] = desc(off.wait_s); S["e3_wait_on"] = desc(on.wait_s)
w = stats.wilcoxon(off.wait_s.sort_index(), on.wait_s.sort_index())
S["e3_wait_wilcoxon"] = dict(W=float(w.statistic), p=round(float(w.pvalue), 5), n=int(len(on)))
diff = (off.wait_s.sort_index() - on.wait_s.sort_index())
S["e3_wait_reduction_paired"] = desc(diff)
S["e3_pairs_on_shorter"] = int((diff > 0).sum())
dd = (off.done_s.sort_index() - on.done_s.sort_index())
S["e3_done_reduction_paired"] = desc(dd)
w2 = stats.wilcoxon(off.done_s.sort_index(), on.done_s.sort_index())
S["e3_done_wilcoxon"] = dict(W=float(w2.statistic), p=round(float(w2.pvalue), 5))
by = {}
for t in sorted(on.think_s.unique()):
    o, n_ = off[off.think_s == t], on[on.think_s == t]
    by[str(int(t))] = dict(n=int(len(n_)), done_off=round(float(o.done_s.median()), 1), done_on=round(float(n_.done_s.median()), 1),
                           wait_off=round(float(o.wait_s.median()), 1), wait_on=round(float(n_.wait_s.median()), 1),
                           wait_on_min=round(float(n_.wait_s.min()), 1), wait_on_max=round(float(n_.wait_s.max()), 1),
                           wait_off_min=round(float(o.wait_s.min()), 1), wait_off_max=round(float(o.wait_s.max()), 1),
                           blocked_on=int(n_.blocked_at_intent.sum()),
                           model_saving=round(float(np.minimum(n_.think_s, n_.boot_s).median()), 1))
S["e3_by_think"] = by
# Model check on the WakeIt runs, using each run's own measured boot time:
#   predicted wait after intent = max(0, boot - time of intent)
on["pred_wait_s"] = np.maximum(0, on.boot_s + on.t_probe_start_ms / 1000 - on.intent_s)
on["resid_s"] = on.wait_s - on.pred_wait_s
S["e3_model_mae_s"] = round(float(on.resid_s.abs().mean()), 3)
S["e3_model_resid"] = desc(on.resid_s)
S["e3_model_pearson_r"] = round(float(np.corrcoef(on.pred_wait_s, on.wait_s)[0, 1]), 4)
# Same-boot saving: what the same run would have taken had the boot started at the click.
on["saving_s"] = on.intent_s + on.boot_s - on.done_s
S["e3_saving_samebott"] = desc(on.saving_s)
S["e3_saving_by_think"] = {str(int(t)): round(float(g.saving_s.median()), 1) for t, g in on.groupby("think_s")}
S["e3_feedback_first_ms"] = desc(on.t_warming_shown_ms)
S["e3_action_rtt_on_s"] = desc((on.t_done_ms - on.t_click_ms) / 1000)

json.dump(S, open(os.path.join(OUT, "summary.json"), "w"), indent=1, default=str)

# ---------------- figures (greyscale-safe: markers, line styles, hatching) ----------------
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"font.family": "serif", "font.size": 8, "axes.linewidth": 0.6, "pdf.fonttype": 42,
                     "axes.spines.top": False, "axes.spines.right": False, "xtick.major.width": 0.6, "ytick.major.width": 0.6})
W = 3.45  # IEEE column width in inches
INK, MID = "#111111", "#777777"

# Fig. 2: every cold start as a dot, by region and session.
fig, ax = plt.subplots(figsize=(W, 1.75))
rows = [("Singapore", "night1"), ("Singapore", "day1"), ("Oregon", "night1"), ("Oregon", "day1")]
for i, (r, s) in enumerate(rows):
    g = v[(v.region == r) & (v.session == s)].cold_s.values
    y = len(rows) - 1 - i + RNG.uniform(-0.16, 0.16, len(g))
    ax.plot(g, y, "o" if s == "night1" else "s", ms=4, mfc=INK if s == "night1" else "white", mec=INK, mew=0.8, ls="none")
ax.set_yticks(range(len(rows))); ax.set_yticklabels([f"{r}, {'night' if s == 'night1' else 'day'}" for r, s in rows][::-1])
ax.set_xlim(0, 26); ax.set_xlabel("Cold-start duration (s)"); ax.set_ylim(-0.6, len(rows) - 0.4)
ax.axvspan(S["cluster_gap"]["lower_max"], S["cluster_gap"]["upper_min"], color="#e6e6e6", lw=0)
ax.text((S["cluster_gap"]["lower_max"] + S["cluster_gap"]["upper_min"]) / 2, len(rows) - 0.42, "no runs", ha="center", va="top", fontsize=7, color=MID)
ax.grid(axis="x", lw=0.3, color="#cccccc"); ax.set_axisbelow(True); ax.tick_params(axis="y", length=0)
fig.tight_layout(pad=0.3); fig.savefig(os.path.join(OUT, "fig_cold.pdf")); plt.close(fig)

# Fig. 3: decomposition of short and long cold starts (medians), stacked horizontal bars.
fig, ax = plt.subplots(figsize=(W, 1.75))
labels = [("before_s", "Before the process starts", "#111111", None), ("app_s", "Application start-up", "#ffffff", None),
          ("routing_s", "Listening, awaiting first request", "#a8a8a8", None), ("network_s", "Network", "#ffffff", "//////")]
for i, cl in enumerate(["long", "short"]):
    left = 0
    for key, lab, col, hatch in labels:
        val = S["decomp_by_cluster"][cl][key]["median"]
        ax.barh(i, val, left=left, height=0.5, color=col, edgecolor=INK, lw=0.6, hatch=hatch, label=lab if i == 0 else None)
        if val > 1.0:
            ax.text(left + val / 2, i, f"{val:.1f}", ha="center", va="center", fontsize=7, color="white" if col == "#111111" else INK)
        left += val
n_l, n_s = S["clusters"]["long"]["n"], S["clusters"]["short"]["n"]
ax.set_yticks([0, 1]); ax.set_yticklabels([f"Long\n(n={n_l})", f"Short\n(n={n_s})"]); ax.set_xlabel("Median time (s)")
ax.set_xlim(0, 26); ax.set_ylim(-0.5, 1.5); ax.tick_params(axis="y", length=0)
fig.legend(loc="lower center", ncol=2, frameon=False, fontsize=7, handlelength=1.4, columnspacing=1.0, bbox_to_anchor=(0.5, 0.0))
fig.tight_layout(pad=0.3, rect=(0, 0.2, 1, 1)); fig.savefig(os.path.join(OUT, "fig_decomp.pdf")); plt.close(fig)

# Fig. 4: wait after the user's intended action, by think-time, without and with WakeIt.
fig, ax = plt.subplots(figsize=(W, 1.7))
ts = sorted(on.think_s.unique())
for j, t in enumerate(ts):
    a = off[off.think_s == t].wait_s.values; b = on[on.think_s == t].wait_s.values
    ax.plot(j - 0.17 + RNG.uniform(-0.05, 0.05, len(a)), a, "o", ms=4.2, mfc="white", mec=INK, mew=0.8, ls="none", label="Without WakeIt" if j == 0 else None)
    ax.plot(j + 0.17 + RNG.uniform(-0.05, 0.05, len(b)), b, "o", ms=4.2, mfc=INK, mec=INK, mew=0.8, ls="none", label="With WakeIt" if j == 0 else None)
    ax.hlines(np.median(a), j - 0.32, j - 0.02, color=INK, lw=1.2); ax.hlines(np.median(b), j + 0.02, j + 0.32, color=INK, lw=1.2)
ax.set_xticks(range(len(ts))); ax.set_xticklabels([f"{int(t)} s" for t in ts]); ax.set_xlabel("Think-time before the action")
ax.set_ylabel("Wait after intent (s)"); ax.set_ylim(0, 30); ax.grid(axis="y", lw=0.3, color="#cccccc"); ax.set_axisbelow(True)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, frameon=False, fontsize=7, handletextpad=0.2, borderaxespad=0.1)
fig.tight_layout(pad=0.3); fig.savefig(os.path.join(OUT, "fig_wakeit.pdf")); plt.close(fig)

print(json.dumps(S, indent=1, default=str))
