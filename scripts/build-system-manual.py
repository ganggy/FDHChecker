"""Build the offline manual HTML. Run with: uv run --with markdown python scripts/build-system-manual.py"""
from pathlib import Path
import html
import json
import re
import subprocess
from urllib.parse import quote
import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
source = (DOCS / "FULL_SYSTEM_MANUAL.md").read_text(encoding="utf-8")
menu_source = (ROOT / "src/config/menuDefinitions.ts").read_text(encoding="utf-8")
menus = dict(re.findall(r"page: '([^']+)', icon: '[^']*', label: '([^']+)'", menu_source))
chapters = {
    "staff": 7, "fdh": 8, "ipd": 9, "ipdExport": 10, "ipdClaimMonitor": 10,
    "nhsoClose": 13, "collaboration": 24, "aiReports": 24, "hospitalReports": 24,
    "fdhImport": 12, "fdhClaimDetail": 12, "repstm": 14, "repstmManage": 25,
    "sssExport": 20, "sssRepStm": 20, "authenSync": 13, "preValidator": 11,
    "workQueue": 11, "rejectTracking": 15, "uuc1Tracking": 15, "receivable": 21,
    "reconciliation": 22, "repDailySummary": 22, "ppfsBenchmark": 22,
    "ppfsVisitMatch": 22, "insuranceOverview": 23, "accountingRevenueBudget": 23,
    "ucOutsideCup": 17, "repDeny": 15, "admin": 23, "memberAdmin": 25,
    "fundFdh": 16, "fund43": 16, "fundKtb": 16, "fundOther": 16,
    "specific": 16, "monitor": 18, "fsMonitor": 18, "revenueOpportunity": 18,
    "mophDmht": 19, "mophVaccine": 19, "icd9Lookup": 25, "guide": 25, "settings": 5,
}
if set(menus) != set(chapters):
    raise SystemExit(f"Menu coverage mismatch: missing={set(menus)-set(chapters)}, removed={set(chapters)-set(menus)}")

for target in re.findall(r"\]\(([^)]+)\)", source):
    if not target.startswith(("http:", "https:", "#")) and not (DOCS / target).exists():
        raise SystemExit(f"Broken documentation link: {target}")

source += "\n## 31. ดัชนีเมนูทั้งระบบ\n\nตารางนี้สร้างจาก menuDefinitions ของโค้ด และตรวจว่าทุกเมนูมีบทอธิบาย\n\n| เมนู | บท | รหัสหน้า |\n| --- | --- | --- |\n"
for key, label in menus.items():
    source += f"| {label} | [บท {chapters[key]}](#chapter-{chapters[key]}) | `{key}` |\n"

result = subprocess.run([
    "node", "--import", "tsx", "--input-type=module", "-e",
    "import { FUND_DEFINITIONS } from './src/config/fundDefinitions.ts'; console.log(JSON.stringify(FUND_DEFINITIONS));",
], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
funds = json.loads(result.stdout)
source += "\n## 32. ดัชนีกองทุนและช่องทางที่โปรแกรมแสดง\n\nรายการต่อไปนี้สร้างจาก fundDefinitions ในโค้ด เพื่อใช้ค้นชื่อและช่องทางในโปรแกรม ไม่ใช่ประกาศอัตราจ่ายหรือการรับรองว่าทุกช่องทางส่งผ่าน FDH ได้ ให้ใช้ขั้นตอนบท 16 และอ่านข้อเตือนของรายการนั้นก่อนดำเนินการ\n\n| กองทุน | รายละเอียดในโปรแกรม | ช่องทางที่แสดง |\n| --- | --- | --- |\n"
for fund in funds:
    cells = [fund["name"], fund.get("description", ""), fund.get("claimChannel", "ตรวจหน้ากองทุน")]
    source += "| " + " | ".join(x.replace("|", "/").replace("\n", " ") for x in cells) + " |\n"

body = markdown.markdown(source, extensions=["tables", "fenced_code", "sane_lists"])
toc = []
def heading(match):
    number, title = match.group(1), match.group(2)
    toc.append((number, title))
    return f'<h2 id="chapter-{number}">{number}. {title}</h2>'
body = re.sub(r"<h2>(\d+)\. (.*?)</h2>", heading, body)
if len(toc) != 32:
    raise SystemExit(f"Expected 32 chapters, got {len(toc)}")
for chapter in chapters.values():
    assert f'id="chapter-{chapter}"' in body
toc_html = '<nav class="toc"><h2>สารบัญ</h2><ol>' + ''.join(
    f'<li><a href="#chapter-{n}">{title}</a></li>' for n, title in toc
) + '</ol></nav>'
first_chapter = body.index('<h2 id="chapter-1"')
body = '<section class="cover"><div class="brand">FDH CHECKER / OPERATIONS HANDBOOK</div>' + body[:first_chapter] + '</section>' + toc_html + body[first_chapter:]
css = """
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#edf2f7;color:#172b45;font-family:'Leelawadee UI',Tahoma,sans-serif;font-size:15px;line-height:1.8}
main{max-width:1060px;margin:28px auto;background:white;padding:56px 68px;box-shadow:0 8px 35px #23375412}
.toolbar{position:sticky;top:0;background:#123556;color:white;padding:10px 24px;display:flex;gap:20px;justify-content:space-between;z-index:10}.toolbar a{color:white}.toolbar button{border:0;border-radius:5px;padding:8px 18px;cursor:pointer}
.brand{letter-spacing:2px;color:#147d83;font-weight:bold;margin:20px 0 30px}h1{font-size:38px;line-height:1.4;color:#123556}h2{font-size:25px;line-height:1.55;color:#123556;border-top:3px solid #16818a;padding-top:22px;margin-top:58px;scroll-margin-top:70px}h3{font-size:18px;color:#14717b;margin-top:24px;line-height:1.6}
p{margin:12px 0}li{margin:5px 0}a{color:#076b9a}table{border-collapse:collapse;width:100%;margin:18px 0;font-size:13px;table-layout:auto}th{background:#e8f2f6;text-align:left;color:#123556}td,th{border:1px solid #cad8e2;padding:9px 10px;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even) td{background:#f7fafc}
code{font-family:Consolas,monospace;font-size:.88em;overflow-wrap:anywhere;background:#f1f5f9;padding:1px 3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;border-left:3px solid #16818a;padding:14px;font-size:12px;line-height:1.6}pre code{padding:0;background:none}
.cover{border-bottom:1px solid #ccdce4;padding:20px 0 36px}.toc ol{columns:2;column-gap:36px;padding-left:24px}.toc li{break-inside:avoid;margin:8px 0}.toc h2{border:0}.cover p{font-size:16px}.footer-note{font-size:12px;color:#526478}
@media(max-width:720px){main{margin:0;padding:24px}.toc ol{columns:1}h1{font-size:29px}table{font-size:12px}}
@media print{body{background:white;font-size:10pt;line-height:1.65;color:#172b45}main{max-width:none;margin:0;padding:0;box-shadow:none}.toolbar{display:none}.cover{break-after:page;border:0;padding-top:30mm}.cover p{font-size:11pt}.brand{font-size:11pt}h1{font-size:30pt}h2{break-before:page;break-after:avoid;font-size:18pt;margin:0 0 14pt;padding-top:12pt}h3{break-after:avoid;font-size:12pt;margin-top:15pt}p{orphans:3;widows:3}table{font-size:8.8pt;line-height:1.6;margin:12pt 0}td,th{padding:6pt}tr{break-inside:avoid}thead{display:table-header-group}pre{font-size:8pt;break-inside:avoid}a{color:inherit;text-decoration:none}.toc{break-after:page}.toc h2{break-before:auto}.toc ol{columns:2;font-size:10pt}.toc li{margin:7pt 0}.cover h1{break-before:auto}}
"""
document = '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>คู่มือ FDH Checker ทั้งระบบ</title><style>' + css + '</style></head><body><div class="toolbar"><span>คู่มือ FDH Checker ทั้งระบบ</span><a href="#chapter-1">เริ่มอ่าน</a><button onclick="window.print()">พิมพ์ / บันทึก PDF</button></div><main>' + body + '<p class="footer-note">ตรวจเทียบโค้ด 22 กันยายน 2569 • ใช้ร่วมกับทะเบียนค่ารายโรงพยาบาลและประกาศที่หน่วยงานรับผิดชอบ</p></main></body></html>'
(DOCS / "manual_system_overview.html").write_text(document, encoding="utf-8")
# Public files are served from the site root; documentation links must not fall
# through to the application's SPA router.
def public_link(match):
    target = match.group(1)
    if target.startswith(("http:", "https:", "#")):
        return match.group(0)
    relative = (DOCS / target).resolve().relative_to(ROOT).as_posix()
    return 'href="https://github.com/ganggy/FDHChecker/blob/abdfa5f/' + quote(relative) + '"'
(ROOT / "public/manual_system_overview.html").write_text(
    re.sub(r'href="([^"]+)"', public_link, document), encoding="utf-8")
print(f"HTML complete: {len(toc)} chapters; {len(menus)} menus covered; {len(funds)} fund entries; local links valid")
