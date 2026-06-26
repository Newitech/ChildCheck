# Open-Source Licenses — Research & Comparison for ChildCheck

This document compares the most common open-source licenses, with pros/cons for each, to help you choose the right one for ChildCheck's public repository.

---

## Quick-Reference Summary Table

| License | Copyleft? | Commercial use? | Must disclose source? | Can be used in proprietary software? | Patent protection? | Complexity |
|---------|-----------|-----------------|----------------------|--------------------------------------|-------------------|------------|
| **MIT** | No | ✅ Yes | Only the license/notice | ✅ Yes | ❌ No | Very low |
| **Apache 2.0** | No | ✅ Yes | Only the license/notice | ✅ Yes | ✅ Yes | Low |
| **BSD 2-Clause** | No | ✅ Yes | Only the license/notice | ✅ Yes | ❌ No | Very low |
| **BSD 3-Clause** | No | ✅ Yes | Only the license/notice | ✅ Yes | ❌ No | Low |
| **MPL 2.0** | Weak (file-level) | ✅ Yes | Modified MPL files must be shared | ✅ Yes (combined works OK) | ✅ Yes | Medium |
| **LGPL 3.0** | Weak (library-level) | ✅ Yes | Modified LGPL code must be shared | ✅ Yes (linking OK) | ✅ Yes | Medium-high |
| **GPL 3.0** | Strong | ✅ Yes | ✅ All derivative work | ❌ No (derivatives must also be GPL) | ✅ Yes | High |
| **AGPL 3.0** | Strong + network | ✅ Yes | ✅ All derivative work + network users | ❌ No | ✅ Yes | High |
| **Unlicense / CC0** | No | ✅ Yes | No | ✅ Yes | ❌ No | Very low |

---

## 1. MIT License

**What it is:** A short, permissive license. Basically says "do whatever you want with this code, just keep the copyright notice + license text."

**Full text:** ~170 words. The shortest popular license.

### Pros
- **Extremely simple** — anyone can understand it in 30 seconds.
- **Maximum adoption** — the most popular license on GitHub (~45% of projects). Companies are comfortable with it; no legal review needed.
- **No restrictions** — anyone can use, modify, distribute, sublicense, sell, or incorporate into proprietary software. No requirement to share modifications.
- **Compatible with almost everything** — MIT-licensed code can be combined with GPL, Apache, proprietary, etc.
- **No paperwork** — no contributor license agreement (CLA) needed.

### Cons
- **No patent protection** — if your code implements a patented method, a user gets no explicit patent grant. They could theoretically be sued by you for patent infringement (rare but possible). Apache 2.0 fixes this.
- **No copyleft** — someone can take your code, improve it, and sell the result as closed-source. They don't have to share their improvements. (This is a pro for adoption, a con if you want to ensure derivatives stay open.)
- **No trademark protection** — the license doesn't address trademarks. Someone could use your project name/logo (though trademark law separately protects registered marks).

### Used by: React, Vue.js, jQuery, .NET Core, Ruby on Rails, Next.js, Node.js ecosystem

### Verdict for ChildCheck: ✅ Good default choice if you want maximum adoption + simplicity. The church/non-profit audience is unlikely to worry about patent clauses.

---

## 2. Apache License 2.0

**What it is:** A permissive license (like MIT) but with explicit patent protection + a contribution CLA mechanism.

**Full text:** ~11,000 words. Much longer than MIT, but the practical requirements are similar.

### Pros
- **Everything MIT gives you** — permissive, commercial-friendly, no copyleft.
- **Explicit patent grant** — contributors automatically grant users a license to any patents needed to use the code. This prevents "submarine patent" attacks.
- **Patent retaliation clause** — if someone sues you alleging the code infringes a patent, they lose their license. Deters patent trolls.
- **Contributor License Agreement (CLA)** — contributions are explicitly licensed under the same terms. No ambiguity about who owns contributed code.
- **NOTICE file** — requires preserving attribution notices in a NOTICE file (good for tracking contributors).
- **Preferred by enterprises** — many large companies (Google, Apache Foundation, Kubernetes, Android) require Apache 2.0 for their projects because of the patent protection.

### Cons
- **More complex** — the full license is long; legal teams may want to review it (though most already have).
- **Slightly more overhead** — the NOTICE file + CLA mechanism is more process than MIT.
- **Still permissive** — like MIT, someone can close-source derivatives. No copyleft.

### Used by: Kubernetes, Android (AOSP), TensorFlow, Swift, Rust, Apache HTTP Server, gRPC

### Verdict for ChildCheck: ✅ Excellent choice if you want patent protection (useful if the codebase implements any novel algorithms). Slightly more "professional" than MIT. The patent clause is reassuring for organisational users.

---

## 3. BSD Licenses (2-Clause "Simplified" + 3-Clause "New")

**What they are:** Permissive licenses, very similar to MIT. The 2-clause is almost identical to MIT. The 3-clause adds a "no endorsement" clause (don't use the author's name to promote derivative products).

### 2-Clause BSD ("Simplified BSD")
- **Clause 1:** Keep the copyright notice when distributing.
- **Clause 2:** Keep the license text when distributing.
- That's it. Effectively identical to MIT in practice.

### 3-Clause BSD ("New BSD" / "Modified BSD")
- Same as 2-clause, plus:
- **Clause 3:** Don't use the names of the authors/contributors to endorse or promote products derived from this software without written permission.

### Pros (both)
- Nearly identical to MIT — simple, permissive, maximum adoption.
- 3-clause adds a mild "don't use my name to sell your thing" protection.

### Cons (both)
- No patent protection (same as MIT).
- The 2-clause is functionally indistinguishable from MIT — no reason to prefer it unless your project has BSD history.

### Used by: FreeBSD, Nginx, PostgreSQL, Python (PSF), Go

### Verdict for ChildCheck: ⚠️ Fine but MIT or Apache 2.0 are better choices for a new project. BSD is mostly used by projects with historical BSD roots. No practical advantage over MIT for a new codebase.

---

## 4. Mozilla Public License 2.0 (MPL 2.0)

**What it is:** A "weak copyleft" license — a middle ground between permissive (MIT/Apache) and strong copyleft (GPL). Copyleft applies **at the file level**: if you modify an MPL-licensed file, you must share that file's source. But you can combine MPL files with proprietary code in a larger work without open-sourcing the whole thing.

### Pros
- **File-level copyleft** — modifications to your code must be shared back (good for community), but the larger application can remain proprietary (good for adoption).
- **Patent protection** — includes an explicit patent grant + retaliation clause (like Apache 2.0).
- **Compatible with GPL** — MPL code can be combined with GPL code.
- **Practical middle ground** — encourages contributions back without scaring away commercial users.

### Cons
- **More complex than MIT/Apache** — file-level copyleft means you need to understand which files are "MPL" vs "proprietary" in a combined work.
- **"Must share modified files" requirement** — if someone modifies your code, they must publish those modifications (under MPL). This is the point, but it's more restrictive than MIT/Apache.
- **Less well-known** — some legal teams are less familiar with MPL than MIT/Apache/GPL.

### Used by: Firefox, Thunderbird, MongoDB (community), LibreOffice, HashiCorp (Terraform pre-BSL)

### Verdict for ChildCheck: ⚠️ A reasonable choice if you want modifications shared back but don't want to force the entire application to be open. The file-level copyleft is a nuanced middle ground. However, for a church check-in system, the distinction is unlikely to matter — MIT or Apache is simpler.

---

## 5. GNU Lesser General Public License 3.0 (LGPL 3.0)

**What it is:** A "weak copyleft" license designed for **libraries**. If you modify the LGPL library itself, you must share the source. But applications that **link to** (use) the library can be proprietary.

### Pros
- **Library-level copyleft** — modifications to the library must be shared, but users of the library aren't forced to open-source their app.
- **Patent protection** — included.
- **Designed for libraries** — the classic "free library" license.

### Cons
- **Complex compliance** — the distinction between "using" vs "modifying" vs "derivative work" is legally nuanced, especially with dynamic vs static linking.
- **Scares some commercial users** — even though linking is allowed, some companies have a "no LGPL" policy due to compliance complexity.
- **GPL compatibility** — LGPL code can be used in GPL projects (but not vice versa without relicensing).

### Used by: Qt (dual-licensed), GTK, GNU C Library (glibc), FFmpeg (LGPL components)

### Verdict for ChildCheck: ❌ Not appropriate. ChildCheck is an application, not a library. LGPL is for libraries that other software links to. Use MPL 2.0 if you want weak copyleft for an application.

---

## 6. GNU General Public License 3.0 (GPL 3.0)

**What it is:** A **strong copyleft** license. If you use, modify, or distribute GPL-licensed code, your entire derivative work must also be GPL-licensed + the source must be made available.

### Pros
- **Strong copyleft guarantees freedom** — anyone who distributes a derivative must share their source under the same terms. "Freedom stays free."
- **Patent protection** — explicit patent grant + retaliation.
- **Anti-tivoization** — GPL 3.0 specifically prevents "Tivoization" (hardware that runs free software but blocks modified versions from running).
- **Strong community** — the Free Software Foundation (FSF) ecosystem is large and active.
- **Ensures contributions flow back** — no one can take your code, improve it, and keep the improvements private (if they distribute the result).

### Cons
- **"Viral" or "contagious"** — if your code touches GPL code, your code must also be GPL. This scares many companies. "GPL incompatibility" is a real problem.
- **Can't be used in proprietary software** — even linking to a GPL library makes your whole app GPL. This is more restrictive than LGPL.
- **SaaS loophole** — running GPL software as a web service (without distributing it) does NOT trigger the copyleft requirement. AGPL fixes this.
- **Compliance burden** — distributing GPL software requires providing the full source code (not just a link), tracking modifications, etc.
- **Some companies ban GPL entirely** — Google, Apple, and many enterprise companies have policies against using GPL code in their products.

### Used by: Linux kernel, Git, WordPress, GCC, GIMP, Bash, Audacity

### Verdict for ChildCheck: ⚠️ This is the key decision point. GPL 3.0 would mean:
- ✅ Anyone who distributes a modified ChildCheck must share their modifications.
- ❌ No one can build a proprietary product on top of ChildCheck.
- ❌ Some churches/organisations with IT policies against GPL software might avoid it.
- ❌ If you ever want to offer a paid "enterprise" version with closed-source additions, GPL makes that legally tricky (you'd need dual-licensing with a CLA).

**Consider GPL if:** you want to ensure all derivatives stay open-source + you don't care about proprietary users.
**Avoid GPL if:** you want maximum adoption, or might dual-license in the future.

---

## 7. GNU Affero General Public License 3.0 (AGPL 3.0)

**What it is:** GPL 3.0 **plus the network clause**. If you run AGPL-licensed software as a network service (e.g. a web app), you must make the source code available to the users of that service — even if you never "distribute" the software in the traditional sense.

### Pros
- **Closes the SaaS loophole** — prevents companies from hosting your software as a service without sharing modifications.
- **Everything else from GPL 3.0** — strong copyleft, patent protection, anti-tivoization.
- **Increasingly popular for web apps** — since most modern software is served over a network, AGPL is the "correct" GPL for web applications.

### Cons
- **Even more restrictive than GPL** — the network clause means even hosting the software triggers source-disclosure obligations.
- **Strongly discourages commercial SaaS use** — no company will host an AGPL app as a service without being very careful about compliance (they'd have to share all their modifications with users).
- **Some companies ban AGPL more strictly than GPL** — Google's policy explicitly bans AGPL code from ALL Google products, even internal tools.
- **Complex compliance** — determining what counts as "interacting with the software remotely" can be legally ambiguous.

### Used by: MongoDB (pre-2018), Mastodon, Nextcloud, Mattermost (community edition), Plausible Analytics, Minio

### Verdict for ChildCheck: ⚠️ This is actually an interesting option for ChildCheck because:
- ✅ Since ChildCheck is a **web application** (not a library), AGPL is the "correct" strong-copyleft license — it prevents someone from hosting a modified ChildCheck as a service without sharing their modifications.
- ✅ Since ChildCheck is **self-hosted** (the user installs it on their own hardware), the AGPL network clause is less of a burden — the user IS the network user, so they already have the source.
- ❌ But it still scares some organisations (Google-style AGPL bans).
- ❌ Dual-licensing becomes harder.

**Consider AGPL if:** you want to prevent anyone from offering a hosted/SaaS version of ChildCheck without contributing back.
**Avoid AGPL if:** you want maximum adoption, or some of your target organisations have AGPL bans.

---

## 8. The Unlicense / CC0 (Public Domain Dedication)

**What it is:** Dedicates the work to the public domain — no restrictions at all, not even attribution.

### Pros
- Maximum freedom — no restrictions whatsoever.
- No attribution required.

### Cons
- **Not recognised in all jurisdictions** — some countries don't allow public domain dedication (civil law countries like France/Germany have "moral rights" that can't be waived).
- **No patent protection.**
- **Some projects refuse public-domain code** because the legal status is ambiguous in some jurisdictions.

### Used by: SQLite, some small libraries/tools

### Verdict for ChildCheck: ❌ Not recommended. The jurisdictional ambiguity + lack of patent protection makes it risky for a project handling child data. Use MIT if you want maximum permissiveness.

---

## 9. Other Notable Mentions

### BSL 1.1 (Business Source License)
- A "source-available" license that converts to an open-source license (usually Apache/GPL) after a time delay (e.g. 4 years).
- Used by: HashiCorp (Terraform, Vault), CockroachDB, MariaDB.
- **Purpose:** allows the project to be free for non-production use, but requires a paid license for large-scale production use (until the time delay expires).
- **Verdict for ChildCheck:** ❌ Overkill. Adds complexity without benefit for a church-focused project.

### PolyForm Noncommercial / Source-Available
- "Source available" but not open source (OSI doesn't recognise them).
- Restricts commercial use.
- **Verdict for ChildCheck:** ❌ These aren't truly open-source and limit adoption.

### Proprietary / Custom License
- You write your own terms.
- **Verdict for ChildCheck:** ❌ Avoids the open-source ecosystem entirely. More legal work, less trust, less adoption.

---

## Decision Matrix for ChildCheck

| Your priority | Recommended license |
|---------------|-------------------|
| Maximum adoption + simplicity | **MIT** |
| Maximum adoption + patent protection | **Apache 2.0** |
| Modifications must be shared back (file-level) | **MPL 2.0** |
| All derivatives must stay open-source | **GPL 3.0** |
| Prevent hosted/SaaS forks | **AGPL 3.0** |
| Want to dual-license (free OSS + paid enterprise) | **Apache 2.0** (with a CLA that grants you the right to relicense) |

---

## My Recommendation for ChildCheck

Given that ChildCheck is:
- A **self-hosted web application** (not a library)
- Targeted at **churches, clubs, schools** (non-technical users, non-profit)
- Handling **sensitive child data** (security matters more than licensing philosophy)
- You want a **public repo** for transparency + community contributions
- You may want to **offer commercial support or hosting** later

### Recommended: **Apache 2.0** (or MIT)

**Apache 2.0** is my top pick because:
1. **Permissive** — churches/orgs can use it without legal concerns. No "viral" copyleft scaring anyone.
2. **Patent protection** — important for a system handling child data; defends against patent trolls.
3. **Enterprise-friendly** — if a large church network or school district wants to deploy it, their legal team will be comfortable with Apache 2.0 (many ban GPL/AGPL).
4. **Dual-licensing friendly** — if you later want a paid "enterprise" version with closed-source additions, Apache 2.0 (with a CLA) lets you do that. GPL/AGPL makes it much harder.
5. **Well-understood** — every legal team knows Apache 2.0. No surprises.

**MIT** is the runner-up — simpler but no patent protection. For a project handling child data, the patent clause is worth having.

**GPL/AGPL** would be the choice if your primary goal is ensuring all derivatives stay open-source + preventing commercial forks. But for a church-focused project where adoption + trust matter more than copyleft ideology, permissive is better.

### If you choose Apache 2.0, the changes needed:
1. Replace `LICENSE` (currently MIT) with the Apache 2.0 full text.
2. Add a `NOTICE` file with attribution.
3. Add a `CONTRIBUTING.md` clause about the CLA (optional but recommended).
4. Update `README.md` to say "Apache 2.0" instead of "MIT".

### If you keep MIT:
No changes needed — the LICENSE file is already MIT.

---

## License Compatibility Note

If you use any third-party libraries (you do — Next.js is MIT, Prisma is Apache, shadcn/ui is MIT, etc.), you must ensure your chosen license is compatible with theirs:

- **MIT-licensed dependencies** (Next.js, React, shadcn/ui, etc.) → compatible with everything. ✅
- **Apache-licensed dependencies** (Prisma) → compatible with MIT, Apache, GPL. ✅
- **GPL-licensed dependencies** (none in ChildCheck) → would force GPL on the whole project. N/A.

All of ChildCheck's dependencies are permissively licensed (MIT or Apache), so you can choose any license for ChildCheck itself without compatibility issues.

---

*This document is for informational purposes only and does not constitute legal advice. For a production deployment, consult a lawyer familiar with open-source licensing in your jurisdiction.*
