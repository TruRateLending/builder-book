/* TRL Contacts: Export to Excel. Fills the team's standard workbook (template_v5.xlsx, built by
   ../build_v5.py --template) with the live data and downloads it. The template's sheet names
   and column order are the contract here; if either changes, change build_v5.py and this file
   together. */

'use strict';

const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const colToNum = (col) => col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/* Capacities match the N_* constants in build_v5.py. */
const CAP = { builders: 200, contacts: 300, tcs: 100, titleContacts: 200, general: 200, roles: 30 };

/* The data for every sheet, as {sheetName: {cellRef: value}}. Pure, so it can be tested
   without a browser. */
function exportSheets() {
  const sorted = (arr) => [...arr].sort(byName);
  const builders = sorted(state.builders);
  const tcs = sorted(state.titleCompanies);
  const first = (arr) => primary(arr);
  const others = (arr) => rest(arr);
  // "Office 915-555-0199; Fax 915-555-0198": every phone after the primary, formatted like the UI
  const otherPhones = (arr) => list(arr).slice(1).filter(x => t(x && x.value)).map(x => (t(x.label) ? t(x.label) + ' ' : '') + fmtPhone(x.value)).join('; ');
  const affRow = (parent, a, p) => [parent, a.role, p.name, fmtPhone(first(p.phones)), first(p.emails), otherPhones(p.phones), others(p.emails), a.always_cc ? 'Yes' : '', a.handles, p.notes];
  const put = (sheet, cols, rowNum, vals) => vals.forEach((v, j) => { if (t(v)) sheet[cols[j] + rowNum] = t(v); });
  const L = (n) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

  const sheets = { 'Builders': {}, 'Contacts': {}, 'Title Companies': {}, 'Title Contacts': {}, 'General Contacts': {}, 'Lists': {}, 'Dashboard': {} };
  const clipped = [];

  builders.slice(0, CAP.builders).forEach((b, i) => {
    const tc = titleCo(b.title_company_id);
    put(sheets['Builders'], L(9), i + 2, [b.name, tc ? tc.name : '', b.dropbox, b.concession, b.calc_from, b.allowed_uses, b.special_process, b.comm_rules, b.notes]);
  });
  if (builders.length > CAP.builders) clipped.push(`builders (first ${CAP.builders} of ${builders.length})`);

  let row = 2, total = 0;
  for (const b of builders) for (const a of affsOfBuilder(b.id)) {
    total++;
    if (row > CAP.contacts + 1) continue;
    const p = person(a.person_id);
    if (p) put(sheets['Contacts'], L(10), row++, affRow(b.name, a, p));
  }
  if (total > CAP.contacts) clipped.push(`builder people (first ${CAP.contacts} of ${total})`);

  tcs.slice(0, CAP.tcs).forEach((c, i) => put(sheets['Title Companies'], L(5), i + 2, [c.name, c.team_email, fmtPhone(c.office_phone), c.office_address, c.notes]));
  if (tcs.length > CAP.tcs) clipped.push(`title companies (first ${CAP.tcs} of ${tcs.length})`);

  row = 2; total = 0;
  for (const c of tcs) for (const a of affsOfTc(c.id)) {
    total++;
    if (row > CAP.titleContacts + 1) continue;
    const p = person(a.person_id);
    if (p) put(sheets['Title Contacts'], L(10), row++, affRow(c.name, a, p));
  }
  if (total > CAP.titleContacts) clipped.push(`title company people (first ${CAP.titleContacts} of ${total})`);

  const general = sorted(state.ix.unlinked);
  general.slice(0, CAP.general).forEach((p, i) => put(sheets['General Contacts'], L(7), i + 2, [p.name, p.company, fmtPhone(first(p.phones)), first(p.emails), otherPhones(p.phones), others(p.emails), p.notes]));
  if (general.length > CAP.general) clipped.push(`general contacts (first ${CAP.general} of ${general.length})`);

  state.roles.slice(0, CAP.roles).forEach((r, i) => { sheets['Lists']['A' + (i + 2)] = r.name; });
  if (state.roles.length > CAP.roles) clipped.push(`roles (first ${CAP.roles} of ${state.roles.length})`);
  if (builders.length) sheets['Dashboard']['B4'] = builders[0].name;

  return { sheets, clipped };
}

async function getSheetPaths(zip) {
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const wbDoc = parse(await zip.file('xl/workbook.xml').async('string'));
  const relDoc = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
  const rels = {};
  for (const r of relDoc.getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const paths = {};
  for (const s of wbDoc.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid];
    if (target.startsWith('/')) target = target.slice(1); else target = 'xl/' + target;
    paths[s.getAttribute('name')] = target;
  }
  return paths;
}

/* Writes values as inline strings into existing (pre-styled) cells, creating rows or cells only
   when the template lacks them. */
function setSheetCells(doc, cells) {
  const sheetData = doc.getElementsByTagNameNS(SS_NS, 'sheetData')[0];
  const rows = {};
  for (const r of Array.from(sheetData.getElementsByTagNameNS(SS_NS, 'row'))) rows[r.getAttribute('r')] = r;
  for (const [ref, value] of Object.entries(cells)) {
    if (value === '' || value == null) continue;
    const m = ref.match(/^([A-Z]+)([0-9]+)$/);
    const colN = colToNum(m[1]);
    let row = rows[m[2]];
    if (!row) {
      row = doc.createElementNS(SS_NS, 'row');
      row.setAttribute('r', m[2]);
      let after = null;
      for (const r of Array.from(sheetData.getElementsByTagNameNS(SS_NS, 'row'))) if (Number(r.getAttribute('r')) > Number(m[2])) { after = r; break; }
      sheetData.insertBefore(row, after);
      rows[m[2]] = row;
    }
    let cell = null, before = null;
    for (const c of Array.from(row.getElementsByTagNameNS(SS_NS, 'c'))) {
      const cRef = c.getAttribute('r');
      if (cRef === ref) { cell = c; break; }
      if (!before && colToNum(cRef.match(/^[A-Z]+/)[0]) > colN) before = c;
    }
    if (!cell) { cell = doc.createElementNS(SS_NS, 'c'); cell.setAttribute('r', ref); row.insertBefore(cell, before); }
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(SS_NS, 'is');
    const tEl = doc.createElementNS(SS_NS, 't');
    tEl.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    tEl.textContent = String(value);
    is.appendChild(tEl);
    cell.appendChild(is);
  }
}

async function exportExcel() {
  toast('Building the Excel workbook');
  try {
    const resp = await fetch('template_v5.xlsx?v=' + APP_VERSION);
    if (!resp.ok) throw new Error('Could not load the Excel template.');
    const zip = await JSZip.loadAsync(await resp.arrayBuffer());
    const paths = await getSheetPaths(zip);
    const { sheets, clipped } = exportSheets();
    for (const [name, cells] of Object.entries(sheets)) {
      const path = paths[name];
      if (!path) throw new Error(`The template has no sheet named ${name}.`);
      const doc = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
      setSheetCells(doc, cells);
      let xml = new XMLSerializer().serializeToString(doc);
      if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
      zip.file(path, xml);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `TRL_Contacts_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(clipped.length ? 'Exported, but clipped: ' + clipped.join('; ') : 'Excel workbook downloaded');
  } catch (err) {
    toast('Export failed: ' + err.message, true);
  }
}
