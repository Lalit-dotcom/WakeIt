# User study kit (optional)

A short comparison of the same page **without** and **with** WakeIt, on real sleeping servers. Aim for 12 to 20 participants.

**Before you start:** ask your guide or department whether a study with classmates needs ethics approval or a permission letter. If it does, get it first and mention it in the paper.

## Design

- **Within-subjects:** every participant tries both versions.
- **Counterbalanced:** odd-numbered participants start with Version 1, even-numbered with Version 2. Backends are swapped for every second participant (the script prints both sets of links).
- **One participant every 25 minutes:** both servers must be asleep before each participant, and Render needs 15 idle minutes.
- Participants are not told which version has WakeIt, or what it does.

## Setup

```powershell
node bench/build-demo.mjs
node bench/serve-demo.mjs --a https://wakeit-e3-a.onrender.com --b https://wakeit-e3-b.onrender.com
```

Open each link in a **new private (incognito) window** for every participant, so nothing is remembered from the previous person.

## Script to read to each participant

> "This is a small to-do page. Please read the page, then add one item by pressing **Add item**. Tell me when you think it has been saved. You will do this twice, on two versions of the page. There are no right or wrong answers; we are testing the page, not you."

Do not explain cold starts until both versions are done.

## After each version, ask

1. "About how many seconds did you wait from pressing the button until it was saved?" (number)
2. "At any point, did you think the page was broken or stuck?" (yes / no)
3. "How satisfied were you with how the page responded?" (1 = very dissatisfied, 5 = very satisfied)

After both versions:

4. "Which version did you prefer?" (first / second / no preference)
5. "Any comment?" (free text)

## Recording sheet

Record answers in `bench/results/user-study.csv` with exactly these columns:

```
participant,order,backend_off,backend_on,est_wait_off_s,broken_off,satisfaction_off,est_wait_on_s,broken_on,satisfaction_on,preferred,comment
P01,off-first,a,b,20,yes,2,3,no,4,on,"thought it froze the first time"
```

- `participant`: P01, P02, ... No names, roll numbers or emails.
- `order`: `off-first` or `on-first`.
- `preferred`: `off`, `on` or `none`.

## Consent sheet (print or show on screen)

> **Study:** Response of a web page hosted on a free cloud service.
> **Researchers:** Lalit Kumar and Nikhil Bhardwaj, Department of CSE, Dronacharya College of Engineering, Gurugram. Guide: Mrs. Vimmi Malhotra.
>
> **What you will do:** use a small to-do web page twice and answer five short questions. It takes about five minutes.
>
> **Data:** we record only your answers, under a code such as "P07". We do not record your name, roll number, voice or screen. Results will be reported only as totals and averages in a research paper.
>
> **Your choice:** taking part is voluntary. You may stop at any time without giving a reason, and it has no effect on your marks or standing.
>
> **Risks and benefits:** there are no known risks and no payment.
>
> **Questions:** [add a contact email].
>
> ☐ I am 18 or older, I have read this, and I agree to take part.

Keep a count of how many people agreed. Do not store signed sheets with the answers.

## Analysis (done later from the CSV)

Paired comparison of the two versions with the Wilcoxon signed-rank test for estimated wait and satisfaction, counts for "thought it was broken", and the preference split. With fewer than about 12 participants the results will be reported as descriptive only.
