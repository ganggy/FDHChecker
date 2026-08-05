---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "src/pages/HospitalReportHubPage.css"
source_hash: "7eff57f7b7955a0ded152a423b94adad5491742c209d248673161de683ee6449"
managed_by: "sync-ksp-vault"
---
# HospitalReportHubPage.css

> Source: `src/pages/HospitalReportHubPage.css`
> SHA-256: `7eff57f7b7955a0ded152a423b94adad5491742c209d248673161de683ee6449`

````css
.hospital-report-hub { min-height: 100%; padding: 24px; color: #172033; background: #f4f7fb; }
.report-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 28px 30px; border-radius: 22px; color: white; background: radial-gradient(circle at 80% 20%, rgba(45, 212, 191, .24), transparent 34%), linear-gradient(135deg, #12304a, #075985 58%, #0f766e); box-shadow: 0 16px 40px rgba(15, 65, 91, .18); }
.report-eyebrow { display: block; margin-bottom: 8px; color: #99f6e4; font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.report-hero h1 { margin: 0; font-size: clamp(1.7rem, 3vw, 2.45rem); }
.report-hero p { max-width: 650px; margin: 8px 0 0; color: rgba(255,255,255,.78); line-height: 1.6; }
.report-hero-stats { display: grid; grid-template-columns: repeat(3, minmax(100px, 1fr)); gap: 8px; min-width: 360px; }
.report-hero-stats article { padding: 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 14px; background: rgba(255,255,255,.09); backdrop-filter: blur(8px); }
.report-hero-stats strong, .report-hero-stats span { display: block; }.report-hero-stats strong { font-size: 1.25rem; }.report-hero-stats span { margin-top: 3px; color: rgba(255,255,255,.68); font-size: .7rem; }
.report-filter { display: flex; gap: 8px; margin: 20px 0; overflow-x: auto; }.report-filter button { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; padding: 9px 13px; border: 1px solid #d8e1eb; border-radius: 999px; background: white; color: #526071; cursor: pointer; font: inherit; font-size: .78rem; }.report-filter button.active { border-color: #0f766e; color: #0f766e; background: #ecfdf5; box-shadow: 0 0 0 2px rgba(15,118,110,.08); }
.report-workspace { display: grid; grid-template-columns: minmax(340px, .9fr) minmax(460px, 1.25fr); gap: 18px; align-items: start; }
.report-catalog { display: grid; gap: 9px; max-height: calc(100vh - 265px); overflow: auto; padding-right: 4px; }
.report-card { position: relative; display: grid; grid-template-columns: 42px 1fr auto; gap: 12px; align-items: start; width: 100%; padding: 15px; border: 1px solid #dfe6ee; border-radius: 15px; background: white; color: inherit; text-align: left; cursor: pointer; transition: .16s ease; }.report-card:hover { transform: translateY(-1px); border-color: #94b9c4; box-shadow: 0 8px 20px rgba(30,64,84,.08); }.report-card.selected { border-color: #0f766e; box-shadow: inset 4px 0 #0f766e, 0 8px 22px rgba(15,118,110,.1); }
.report-card-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: #f0f7fa; font-size: 1.25rem; }.report-card-copy strong,.report-card-copy small,.report-card-copy p { display: block; }.report-card-copy strong { font-size: .9rem; }.report-card-copy small { margin-top: 2px; color: #789; font-size: .68rem; }.report-card-copy p { margin: 7px 0 0; color: #64748b; font-size: .75rem; line-height: 1.45; }
.report-status { padding: 4px 7px; border-radius: 999px; font-size: .63rem; font-weight: 800; white-space: nowrap; }.report-status.is-ready { color: #047857; background: #d1fae5; }.report-status.is-partial { color: #a16207; background: #fef3c7; }.report-status.is-source-required { color: #64748b; background: #eef2f7; }
.report-builder { position: sticky; top: 16px; padding: 22px; border: 1px solid #dfe6ee; border-radius: 19px; background: white; box-shadow: 0 12px 30px rgba(28,54,73,.08); }.report-builder > header { display: flex; align-items: center; gap: 13px; padding-bottom: 17px; border-bottom: 1px solid #edf1f5; }.report-builder > header > span { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 15px; background: linear-gradient(145deg, #e6fffb, #e0f2fe); font-size: 1.55rem; }.report-builder header small { color: #0f766e; font-weight: 800; }.report-builder h2 { margin: 2px 0; font-size: 1.25rem; }.report-builder header p { margin: 0; color: #8491a2; font-size: .72rem; }
.report-requirement { display: flex; flex-direction: column; gap: 4px; margin: 15px 0; padding: 11px 13px; border-radius: 11px; font-size: .74rem; line-height: 1.5; }.report-requirement.is-partial { color: #854d0e; background: #fffbeb; }.report-requirement.is-source-required { color: #475569; background: #f1f5f9; }
.report-form { display: grid; gap: 13px; margin-top: 16px; }.report-form label > span { display: block; margin-bottom: 6px; color: #475569; font-size: .74rem; font-weight: 700; }.report-form input,.report-form select,.report-form textarea { width: 100%; box-sizing: border-box; padding: 10px 11px; border: 1px solid #cfd9e4; border-radius: 10px; background: white; color: #172033; font: inherit; font-size: .82rem; }.report-form input:focus,.report-form select:focus,.report-form textarea:focus { outline: 2px solid rgba(15,118,110,.17); border-color: #0f766e; }.report-identifier { display: grid; grid-template-columns: 85px 1fr; gap: 8px; }.report-date-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.report-ai-toggle { display: flex; gap: 9px; align-items: flex-start; padding: 11px; border-radius: 11px; background: #f0fdfa; cursor: pointer; }.report-ai-toggle input { width: auto; margin-top: 3px; }.report-ai-toggle span { margin: 0 !important; }.report-ai-toggle strong,.report-ai-toggle small { display: block; }.report-ai-toggle small { margin-top: 3px; color: #64748b; font-weight: 400; }
.report-run { padding: 12px; border: 0; border-radius: 11px; color: white; background: linear-gradient(135deg, #0f766e, #0284c7); font: inherit; font-weight: 800; cursor: pointer; }.report-run:disabled { opacity: .48; cursor: default; }
.report-not-ready { display: grid; place-items: center; padding: 40px 25px; text-align: center; }.report-not-ready > span { font-size: 2rem; }.report-not-ready strong { margin-top: 10px; }.report-not-ready p { max-width: 340px; color: #64748b; font-size: .8rem; line-height: 1.55; }
.report-error { margin-top: 14px; padding: 11px; border-radius: 10px; color: #b42318; background: #fef3f2; font-size: .78rem; }
.report-output { margin-top: 18px; padding-top: 18px; border-top: 1px solid #e8edf2; }.report-output-head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }.report-output-head small { color: #0f766e; font-weight: 800; }.report-output-head h3 { margin: 3px 0; font-size: 1rem; }.report-output-head p { margin: 0; color: #64748b; font-size: .72rem; }.report-output-head button { padding: 8px 11px; border: 0; border-radius: 9px; color: white; background: #0f766e; cursor: pointer; font-weight: 700; }
.report-ai-summary { margin-top: 12px; padding: 13px; border-left: 4px solid #0284c7; border-radius: 8px; background: #f0f9ff; }.report-ai-summary strong { color: #0369a1; font-size: .72rem; }.report-ai-summary p { margin: 5px 0 0; white-space: pre-wrap; font-size: .8rem; line-height: 1.6; }.report-output ul { padding-left: 18px; color: #8a5a0a; font-size: .72rem; }
.report-preview { margin-top: 12px; overflow-x: auto; }.report-preview table { width: 100%; border-collapse: collapse; font-size: .7rem; }.report-preview th,.report-preview td { padding: 7px; border-bottom: 1px solid #e7edf3; text-align: left; white-space: nowrap; }.report-preview th { color: #475569; background: #f8fafc; }.report-preview > small { display: block; margin-top: 6px; color: #8491a2; }
@media (max-width: 1000px) { .report-hero { align-items: stretch; flex-direction: column; }.report-hero-stats { min-width: 0; }.report-workspace { grid-template-columns: 1fr; }.report-catalog { max-height: none; }.report-builder { position: static; } }
@media (max-width: 640px) { .hospital-report-hub { padding: 12px; }.report-hero { padding: 21px; }.report-hero-stats { grid-template-columns: 1fr 1fr; }.report-hero-stats article:last-child { grid-column: 1 / -1; }.report-card { grid-template-columns: 38px 1fr; }.report-status { grid-column: 2; justify-self: start; }.report-date-row { grid-template-columns: 1fr; } }

````
