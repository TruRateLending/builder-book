/* TRL Contacts: rendering. Everything on screen is a function of `state` (see app.js).
   Three panes plus the rail: renderRail(), renderList(), renderRecord(), renderInsp(). */

'use strict';

function render() {
  if (!state.allowed) return;
  renderRail();
  renderList();
  renderRecord();
  renderInsp();
  applyLayout();
  const cur = currentRecord();
  document.title = (cur ? cur.rec.name + ' · ' : '') + 'TRL Contacts';
}

// ------------------------------------------------------------------ rail
function renderRail() {
  const s = state.route.section;
  const nav = (sec, label, ic) => `<a class="nav" href="#/${sec}" ${s === sec ? 'aria-current="page"' : ''}>${icon(ic, 20)}<span>${label}</span></a>`;
  $('#rail').innerHTML = `
    <div class="brand" aria-hidden="true">TRL</div>
    ${nav('builders', 'Builders', 'builders')}
    ${nav('people', 'People', 'people')}
    ${nav('title', 'Title', 'title')}
    <div class="rail-spacer"></div>
    <div class="account">${accountButtonHtml()}${state.menu === 'account' ? accountMenuHtml() : ''}</div>`;
}
function accountButtonHtml() {
  const email = state.session ? state.session.user.email : '';
  return `<button class="avatar" data-action="menu" aria-label="Account menu" aria-expanded="${state.menu === 'account'}" title="${esc(email)}">${esc((who(email) || '?').slice(0, 2).toUpperCase())}</button>`;
}
function accountMenuHtml() {
  const email = state.session ? state.session.user.email : '';
  return `<div class="menu" role="menu">
    <div class="menu-note">${esc(email)}${state.myAccess === 'read' ? ' · view only' : ''}</div>
    <hr>
    <button role="menuitem" data-action="export">Export to Excel</button>
    ${isAdmin() ? '<button role="menuitem" data-action="panel" data-panel="team">Team access</button><button role="menuitem" data-action="panel" data-panel="roles">Roles</button>' : ''}
    <button role="menuitem" data-action="panel" data-panel="help">How this works</button>
    <hr>
    <button role="menuitem" data-action="signout">Sign out</button>
  </div>`;
}

// ------------------------------------------------------------------ list column
function renderList() {
  const s = state.route.section;
  const newAction = { builders: 'new-builder', people: 'new-person-free', title: 'new-titleco' }[s];
  const label = { builders: 'builders', people: 'people', title: 'title companies' }[s];
  let body, foot;
  if (t(state.q)) {
    ({ body, foot } = searchResultsHtml(state.q));
  } else if (s === 'people') {
    ({ body, foot } = peopleRowsHtml());
  } else if (s === 'title') {
    body = state.titleCompanies.map(c => {
      const nb = buildersOfTc(c.id).length, np = affsOfTc(c.id).length;
      const sub = [nb ? plural(nb, 'builder') : '', np ? plural(np, 'person', 'people') : ''].filter(Boolean).join(' · ');
      return rowHtml(`#/title/${c.id}`, c.name, sub, state.route.id === c.id);
    }).join('') || `<div class="list-empty">No title companies.</div>`;
    foot = plural(state.titleCompanies.length, 'title company', 'title companies');
  } else {
    const builderRow = (b) => {
      const n = affsOfBuilder(b.id).length, tc = titleCo(b.title_company_id);
      const sub = [n ? plural(n, 'person', 'people') : '', tc ? tc.name : ''].filter(Boolean).join(' · ');
      return rowHtml(`#/builders/${b.id}`, b.name, sub, state.route.id === b.id);
    };
    // A processor works a handful of active builders at a time: the last five opened on this device sit on top.
    const recent = state.builders.length >= 8
      ? state.recent.filter(k => k.startsWith('builders:')).map(k => builder(k.slice(9))).filter(Boolean).slice(0, 5) : [];
    body = (recent.length ? `<div class="group">Recent</div>${recent.map(builderRow).join('')}<div class="group">All builders</div>` : '')
      + (state.builders.map(builderRow).join('') || `<div class="list-empty">No builders.</div>`);
    foot = plural(state.builders.length, 'builder');
  }
  const prev = $('#search');
  const hadFocus = prev && document.activeElement === prev;
  const caret = hadFocus ? [prev.selectionStart, prev.selectionEnd] : null;
  $('#list').innerHTML = `
    <div class="list-h">
      <label class="search">${icon('search')}<input id="search" type="search" placeholder="Search" value="${esc(state.q)}" autocomplete="off" aria-label="Search people, builders and title companies"><span class="kbd" aria-hidden="true">/</span></label>
      ${canWrite() ? `<button class="btn icon" data-action="${newAction}" aria-label="New ${label.replace(/s$|ies$/, m => m === 'ies' ? 'y' : '')}" title="New">${icon('plus')}</button>` : ''}
    </div>
    ${s === 'people' && !t(state.q) ? peopleFiltersHtml() : ''}
    <div class="rows">${body}</div>
    <div class="list-f">${esc(foot)}</div>`;
  if (hadFocus) {                       // the re-render replaced the input; put the caret back
    const input = $('#search');
    input.focus();
    try { input.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not all inputs allow it */ }
  }
}
function rowHtml(href, name, sub, on, nameHtml) {
  return `<a class="row" href="${href}" ${on ? 'aria-current="page"' : ''}><span class="n">${nameHtml || esc(name)}</span>${sub ? `<span class="s">${sub}</span>` : ''}</a>`;
}
function peopleFiltersHtml() {
  const roles = [...new Set(state.affiliations.map(a => t(a.role)).filter(Boolean))].sort((a, b) => rankRole(a) - rankRole(b) || a.localeCompare(b));
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  return `<div class="filters">
    <select data-filter="role" aria-label="Filter by role">${opt('', 'Role: all', state.filters.role)}${roles.map(r => opt(r, r, state.filters.role)).join('')}</select>
    <select data-filter="where" aria-label="Filter by builder or title company">${opt('', 'Where: all', state.filters.where)}
      ${state.builders.map(b => opt('b:' + b.id, b.name, state.filters.where)).join('')}
      ${state.titleCompanies.map(c => opt('t:' + c.id, c.name, state.filters.where)).join('')}
      ${opt('none', 'Not linked anywhere', state.filters.where)}</select>
  </div>`;
}
function peopleRowsHtml() {
  const { role, where } = state.filters;
  const rows = state.people.filter(p => {
    const affs = affsOfPerson(p.id);
    if (role && !affs.some(a => ci(a.role) === ci(role))) return false;
    if (where === 'none') return affs.length === 0;
    if (where.startsWith('b:')) return affs.some(a => a.builder_id === where.slice(2));
    if (where.startsWith('t:')) return affs.some(a => a.title_company_id === where.slice(2));
    return true;
  });
  const body = rows.map(p => {
    const affs = affsOfPerson(p.id);
    const sub = affs.length ? `${esc(affs[0].role || 'Contact')} · ${esc(affs.map(parentName).join(', '))}` : esc(t(p.company));
    return rowHtml(`#/people/${p.id}`, p.name, sub, state.route.id === p.id);
  }).join('') || `<div class="list-empty">${state.people.length ? 'No people match these filters.' : 'No people.'}</div>`;
  return { body, foot: plural(rows.length, 'person', 'people') + (rows.length !== state.people.length ? ` of ${state.people.length}` : '') };
}
function searchResultsHtml(q) {
  const tokens = tokenize(q);
  const res = searchAll(q);
  const total = res.people.length + res.builders.length + res.tcs.length;
  const item = (d, href) => {
    const sub = d.nameHit || !d.match ? esc(d.sub) : `${esc(d.match[0])}: ${hl(d.match[1], tokens)}`;
    return rowHtml(href, d.name, sub, false, hl(d.name, tokens));
  };
  let body = '';
  if (res.people.length) body += `<div class="group">People</div>` + res.people.map(d => item(d, `#/people/${d.id}`)).join('');
  if (res.builders.length) body += `<div class="group">Builders</div>` + res.builders.map(d => item(d, `#/builders/${d.id}`)).join('');
  if (res.tcs.length) body += `<div class="group">Title companies</div>` + res.tcs.map(d => item(d, `#/title/${d.id}`)).join('');
  if (!total) body = `<div class="list-empty">No matches for "${esc(q)}". Try a name, role, phone number or email.</div>`;
  return { body, foot: total ? `${plural(total, 'result')} · Enter opens the first` : '' };
}

// ------------------------------------------------------------------ record pane
function renderRecord() {
  const main = $('#record');
  const cur = currentRecord();
  if (!cur && state.route.missing) {
    main.innerHTML = `<div class="rec-empty">That ${{ builders: 'builder', people: 'person', title: 'title company' }[state.route.section]} is not here any more. It may have been deleted. <a href="#/${state.route.section}">Back to the list</a></div>`;
    return;
  }
  if (!cur) {
    const rows = sectionRows(state.route.section);
    main.innerHTML = rows.length ? '' : `<div class="rec-empty">${{ builders: 'No builders.', people: 'No people.', title: 'No title companies.' }[state.route.section]}${canWrite() ? ' Use the + button to add one.' : ''}</div>`;
    return;
  }
  const saved = state.scroll[state.route.section + ':' + state.route.id];
  if (cur.kind === 'builder') main.innerHTML = builderHtml(cur.rec);
  else if (cur.kind === 'person') main.innerHTML = personHtml(cur.rec);
  else main.innerHTML = titleCoHtml(cur.rec);
  if (saved) main.scrollTop = saved;
}
const backBtn = () => `<a class="back" href="#/${state.route.section}" aria-label="Back">${icon('back', 20)}</a>`;
function headHtml(name, facts, actions) {
  return `<div class="head">${backBtn()}<h1 class="name">${esc(name)}</h1>
    <div class="facts">${facts.filter(Boolean).map(esc).join('<span class="dot">·</span>')}</div>
    <div class="spacer"></div><div class="actions">${actions}</div></div>`;
}
function moreMenuHtml(items) {
  if (!items.length) return '';
  return `<button class="btn icon" data-action="more" aria-label="More" aria-expanded="${state.menu === 'more'}">${icon('more')}</button>
    ${state.menu === 'more' ? `<div class="row-menu" style="right:0; top:36px;">${items.join('')}</div>` : ''}`;
}
const detailsBtn = () => layoutMode() === 'wide' ? '' : `<button class="btn" data-action="details">${icon('info')}<span>Details</span></button>`;

function builderHtml(b) {
  const affs = affsOfBuilder(b.id);
  const tc = titleCo(b.title_company_id);
  const actions = canWrite() ? `
    <button class="btn" data-action="new-person" data-kind="b" data-parent="${b.id}">${icon('plus')}<span>Add person</span></button>
    <button class="btn" data-action="edit-builder" data-id="${b.id}">${icon('pencil')}<span>Edit</span></button>
    ${detailsBtn()}
    ${moreMenuHtml([
      `<button data-action="link-titleco" data-id="${b.id}">${tc ? 'Change title company' : 'Link a title company'}</button>`,
      `<button class="danger" data-action="delete" data-table="builders" data-id="${b.id}">Delete builder</button>`,
    ])}` : detailsBtn();
  const tcSection = tc ? `
    <table class="grid">
      <thead><tr><th scope="col">Company</th><th scope="col" class="hide-sm w-email">Team email</th><th scope="col" class="hide-sm w-phone">Office phone</th><th scope="col" class="act"></th></tr></thead>
      <tbody><tr>
        <td class="nowrap"><a href="#/title/${tc.id}"><span class="nm">${esc(tc.name)}</span></a></td>
        <td class="nowrap hide-sm">${valueWithCopy(tc.team_email, 'mailto:' + t(tc.team_email))}</td>
        <td class="nowrap hide-sm num">${valueWithCopy(fmtPhone(tc.office_phone), telHref(tc.office_phone), t(tc.office_phone))}</td>
        <td class="act"></td></tr></tbody>
    </table>
    ${peopleTableHtml(affsOfTc(tc.id), 'builders', b.id, { headless: true, noCC: true })}` :
    `<table class="grid"><tbody><tr class="empty"><td>No title company linked</td></tr></tbody></table>`;
  return `<div class="rec">
    ${headHtml(b.name, [plural(affs.length, 'person', 'people'), tc && tc.name], actions)}
    <section>
      <h2 class="sect-h">People <span class="count">${affs.length}</span></h2>
      ${peopleTableHtml(affs, 'builders', b.id, {})}
    </section>
    <section>
      <h2 class="sect-h">Title company ${!tc && canWrite() ? `<button class="tbtn right" data-action="link-titleco" data-id="${b.id}">Link a title company</button>` : ''}</h2>
      ${tcSection}
    </section>
  </div>`;
}

/* The people table used by builders and title companies. Rows select the person into the inspector. */
function peopleTableHtml(affs, section, recId, opts) {
  const rows = affs.map(a => {
    const p = person(a.person_id);
    if (!p) return '';
    const on = state.route.sub === 'person' && state.route.subId === p.id;
    const href = `#/${section}/${recId}/person/${p.id}`;
    const phone = primary(p.phones), email = primary(p.emails);
    const more = (arr) => (list(arr).filter(x => t(x && x.value)).length > 1 ? ` <span class="muted">+${list(arr).filter(x => t(x && x.value)).length - 1}</span>` : '');
    const menuKey = 'row:' + a.id;
    return `<tr class="link ${on ? 'on' : ''}" data-href="${href}">
      <td class="nowrap">${esc(a.role || 'Contact')}</td>
      <td><a href="${href}"><div class="nm">${esc(p.name)}</div></a>${t(a.handles) ? `<div class="hd">${esc(a.handles)}</div>` : ''}</td>
      <td class="nowrap hide-sm num">${valueWithCopy(fmtPhone(phone), telHref(phone), phone)}${more(p.phones)}</td>
      <td class="nowrap hide-sm">${valueWithCopy(email, 'mailto:' + email)}${more(p.emails)}</td>
      ${opts.noCC ? '' : `<td class="c ck hide-sm">${a.always_cc ? `<span title="Always CC" aria-label="Always CC">${icon('check')}</span>` : ''}</td>`}
      <td class="act hide-sm">${canWrite() ? `<button class="mini" data-action="row-menu" data-id="${a.id}" aria-label="Actions for ${esc(p.name)}" aria-expanded="${state.menu === menuKey}">${icon('more', 14)}</button>
        ${state.menu === menuKey ? rowMenuHtml(a, p) : ''}` : ''}</td>
    </tr>`;
  }).join('');
  return `<table class="grid">
    ${opts.headless ? '' : `<thead><tr><th scope="col" class="w-role">Role</th><th scope="col">Name</th><th scope="col" class="hide-sm w-phone">Phone</th><th scope="col" class="hide-sm w-email">Email</th>${opts.noCC ? '' : '<th scope="col" class="c hide-sm" title="Always CC">CC</th>'}<th scope="col" class="act hide-sm"></th></tr></thead>`}
    <tbody>${rows || `<tr class="empty"><td colspan="6">No people linked</td></tr>`}</tbody>
  </table>`;
}
function rowMenuHtml(a, p) {
  const parent = parentOf(a);
  return `<div class="row-menu" role="menu">
    <button role="menuitem" data-action="edit-person" data-id="${p.id}" data-aff="${a.id}">Edit ${esc(p.name)}</button>
    <button role="menuitem" data-action="edit-aff" data-id="${a.id}">Edit role here</button>
    <button role="menuitem" class="danger" data-action="remove-aff" data-id="${a.id}">Remove from ${esc(parent ? parent.name : 'here')}</button>
  </div>`;
}
function valueWithCopy(shown, href, raw) {
  const v = t(shown);
  if (!v) return '';
  const copyVal = t(raw) || v;
  return `<a href="${esc(href)}">${esc(v)}</a> ${copyBtn(copyVal)}`;
}
const copyBtn = (value) => `<button class="copy" data-action="copy" data-copy="${esc(value)}" aria-label="Copy ${esc(value)}" title="Copy">${icon('copy')}</button>`;

function personHtml(p) {
  const affs = affsOfPerson(p.id);
  const nb = affs.filter(a => a.builder_id).length, nt = affs.filter(a => a.title_company_id).length;
  const facts = [affs.length ? affs[0].role : t(p.company), nb ? plural(nb, 'builder') : '', nt ? plural(nt, 'title company', 'title companies') : ''];
  const actions = canWrite() ? `
    <button class="btn" data-action="new-aff" data-person="${p.id}">${icon('plus')}<span>Link to organization</span></button>
    <button class="btn" data-action="edit-person" data-id="${p.id}">${icon('pencil')}<span>Edit</span></button>
    ${detailsBtn()}
    ${moreMenuHtml([`<button class="danger" data-action="delete" data-table="people" data-id="${p.id}">Delete ${esc(p.name)}</button>`])}` : detailsBtn();
  const contactRows = [
    ...list(p.phones).filter(x => t(x && x.value)).map(x => [t(x.label) || 'Phone', fmtPhone(x.value), telHref(x.value), t(x.value)]),
    ...list(p.emails).filter(x => t(x && x.value)).map(x => [t(x.label) ? t(x.label) + ' email' : 'Email', t(x.value), 'mailto:' + t(x.value), t(x.value)]),
  ];
  const orgRows = affs.map(a => {
    const par = parentOf(a);
    if (!par) return '';
    const on = state.route.sub === 'at' && state.route.subId === a.id;
    const href = `#/people/${p.id}/at/${a.id}`;
    return `<tr class="link ${on ? 'on' : ''}" data-href="${href}">
      <td><a href="${href}"><span class="nm">${esc(par.name)}</span></a></td>
      <td class="nowrap">${esc(a.role || 'Contact')}</td>
      <td class="hide-sm">${esc(a.handles)}</td>
      <td class="c ck hide-sm">${a.always_cc ? `<span aria-label="Always CC">${icon('check')}</span>` : ''}</td>
      <td class="act hide-sm">${canWrite() ? `<button class="mini" data-action="edit-aff" data-id="${a.id}" aria-label="Edit link">${icon('pencil', 14)}</button>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="rec">
    ${headHtml(p.name, facts, actions)}
    <section>
      <h2 class="sect-h">Contact</h2>
      <table class="grid"><tbody>${contactRows.length ? contactRows.map(([k, v, href, raw]) => `
        <tr><td class="nowrap" style="width:140px; color:var(--t2);">${esc(k)}</td><td class="nowrap num always">${valueWithCopy(v, href, raw)}</td></tr>`).join('')
        : '<tr class="empty"><td>No phone or email recorded</td></tr>'}</tbody></table>
    </section>
    <section>
      <h2 class="sect-h">Organizations <span class="count">${affs.length}</span></h2>
      <table class="grid">
        <thead><tr><th scope="col" class="w-org">Organization</th><th scope="col" class="w-role">Role</th><th scope="col" class="hide-sm">Handles</th><th scope="col" class="c hide-sm" title="Always CC">CC</th><th scope="col" class="act hide-sm"></th></tr></thead>
        <tbody>${orgRows || '<tr class="empty"><td colspan="5">Not linked to any builder or title company</td></tr>'}</tbody>
      </table>
    </section>
    ${t(p.notes) ? `<section><h2 class="sect-h">Notes</h2><div class="notes">${esc(p.notes)}</div></section>` : ''}
  </div>`;
}

function titleCoHtml(c) {
  const affs = affsOfTc(c.id), bl = buildersOfTc(c.id);
  const actions = canWrite() ? `
    <button class="btn" data-action="new-person" data-kind="t" data-parent="${c.id}">${icon('plus')}<span>Add person</span></button>
    <button class="btn" data-action="edit-titleco" data-id="${c.id}">${icon('pencil')}<span>Edit</span></button>
    ${detailsBtn()}
    ${moreMenuHtml([`<button class="danger" data-action="delete" data-table="title_companies" data-id="${c.id}">Delete company</button>`])}` : detailsBtn();
  return `<div class="rec">
    ${headHtml(c.name, [bl.length ? `Used by ${plural(bl.length, 'builder')}` : '', plural(affs.length, 'person', 'people')], actions)}
    <section>
      <h2 class="sect-h">People <span class="count">${affs.length}</span></h2>
      ${peopleTableHtml(affs, 'title', c.id, { noCC: true })}
    </section>
    <section>
      <h2 class="sect-h">Builders using this company <span class="count">${bl.length}</span></h2>
      <table class="grid">
        <thead><tr><th scope="col">Builder</th><th scope="col" class="w-phone">People</th></tr></thead>
        <tbody>${bl.map(b => `<tr class="link" data-href="#/builders/${b.id}"><td><a href="#/builders/${b.id}"><span class="nm">${esc(b.name)}</span></a></td><td class="num">${affsOfBuilder(b.id).length}</td></tr>`).join('')
          || '<tr class="empty"><td colspan="2">No builders use this company</td></tr>'}</tbody>
      </table>
    </section>
  </div>`;
}

// ------------------------------------------------------------------ inspector
function renderInsp() {
  const insp = $('#insp');
  const closeX = `<button class="x" data-action="close-insp" aria-label="Close">${icon('x')}</button>`;
  let html;
  if (state.form) html = formHtml();
  else if (state.panel) html = panelHtml(state.panel);
  else {
    const cur = currentRecord();
    const r = state.route;
    if (!cur) html = `<div class="insp-empty">Nothing selected.</div>`;
    else if (r.sub === 'person' && person(r.subId)) html = personCardHtml(person(r.subId), cur, closeX);
    else if (r.sub === 'at' && affById(r.subId)) html = orgSummaryHtml(affById(r.subId), cur.rec, closeX);
    else if (cur.kind === 'builder') html = builderDetailsHtml(cur.rec);
    else if (cur.kind === 'tc') html = companyDetailsHtml(cur.rec);
    else {
      const first = affsOfPerson(cur.rec.id)[0];
      html = first ? orgSummaryHtml(first, cur.rec, '') : `<div class="insp-h"><span class="t">Details</span></div><div class="insp-empty">Not linked to any builder or title company.${canWrite() ? ' Use Link to organization.' : ''}</div>`;
    }
  }
  insp.innerHTML = html;
}

function propHtml(key, label, value, opts) {
  const v = t(value);
  if (!v) return '';
  const k = key;
  const clamp = opts && opts.clamp && v.length > 240 && !state.expanded[k];
  return `<div class="prop"><div class="k">${esc(label)}</div><div class="v ${clamp ? 'clamp' : ''}">${esc(v)}</div>
    ${opts && opts.clamp && v.length > 240 ? `<button class="tbtn" data-action="show-more" data-key="${esc(k)}">${state.expanded[k] ? 'Show less' : 'Show more'}</button>` : ''}</div>`;
}
function ccEmails(b) {
  if (!b) return [];
  return affsOfBuilder(b.id).filter(a => a.always_cc).map(a => primary((person(a.person_id) || {}).emails)).filter(Boolean);
}
function metaHtml(rec) {
  const by = who(rec.updated_by);
  return `<span class="meta">${by ? `Edited by ${esc(by)}, ${fmtAgo(rec.updated_at)}` : (rec.updated_at ? `Edited ${fmtAgo(rec.updated_at)}` : '')}</span>`;
}
function emptyFieldsHtml(rec, fields) {
  const empty = fields.filter(([k]) => !t(rec[k]));
  if (!empty.length) return '';
  const open = state.showEmpty[rec.id];
  return `${open ? empty.map(([, label]) => `<div class="prop"><div class="k">${esc(label)}</div><div class="v muted">Empty</div></div>`).join('') : ''}
    <button class="tbtn" data-action="toggle-empty" data-id="${rec.id}">${open ? 'Hide empty fields' : `Show ${plural(empty.length, 'empty field')}`}</button>`;
}
function builderDetailsHtml(b) {
  const cc = affsOfBuilder(b.id).filter(a => a.always_cc);
  const ccNames = cc.map(a => (person(a.person_id) || {}).name).filter(Boolean);
  const emails = ccEmails(b);
  const dbx = t(b.dropbox);
  const isUrl = /^https?:\/\//i.test(dbx);
  const fields = [['comm_rules', 'CC rules'], ['concession', 'Concession'], ['calc_from', 'Calculated from'], ['allowed_uses', 'Allowed uses'], ['special_process', 'Special process'], ['notes', 'Notes'], ['dropbox', 'Dropbox folder']];
  return `<div class="insp-h"><span class="t">Builder details</span>${canWrite() ? `<button class="tbtn" data-action="edit-builder" data-id="${b.id}">Edit</button>` : ''}${layoutMode() === 'wide' ? '' : `<button class="x" data-action="close-insp" aria-label="Close">${icon('x')}</button>`}</div>
  <div class="insp-b">
    ${propHtml(b.id + ':cc', 'CC rules', b.comm_rules, { clamp: true })}
    ${ccNames.length ? `<div class="prop"><div class="k">Always CC</div><div class="v">${esc(ccNames.join(', '))}</div>${emails.length ? `<button class="tbtn" data-action="copy-cc" data-id="${b.id}">Copy ${emails.length === 1 ? 'email' : 'all ' + emails.length + ' emails'}</button>` : ''}</div>` : ''}
    ${propHtml(b.id + ':con', 'Concession', b.concession)}
    ${propHtml(b.id + ':calc', 'Calculated from', b.calc_from)}
    ${propHtml(b.id + ':uses', 'Allowed uses', b.allowed_uses, { clamp: true })}
    ${propHtml(b.id + ':sp', 'Special process', b.special_process, { clamp: true })}
    ${propHtml(b.id + ':notes', 'Notes', b.notes, { clamp: true })}
    ${dbx ? `<div class="prop"><div class="k">Dropbox folder</div><div class="v">${isUrl ? `<a class="tbtn" href="${esc(dbx)}" target="_blank" rel="noopener">Open folder ${icon('external', 14)}</a>` : `<span class="always">${esc(dbx)} ${copyBtn(dbx)}</span>`}</div></div>` : ''}
    ${emptyFieldsHtml(b, fields)}
  </div>
  <div class="insp-f">${metaHtml(b)}</div>`;
}
function companyDetailsHtml(c) {
  const fields = [['team_email', 'Team email'], ['office_phone', 'Office phone'], ['office_address', 'Office address'], ['notes', 'Notes']];
  return `<div class="insp-h"><span class="t">Company details</span>${canWrite() ? `<button class="tbtn" data-action="edit-titleco" data-id="${c.id}">Edit</button>` : ''}${layoutMode() === 'wide' ? '' : `<button class="x" data-action="close-insp" aria-label="Close">${icon('x')}</button>`}</div>
  <div class="insp-b">
    ${t(c.team_email) ? `<div class="prop"><div class="k">Team email</div><div class="crow always"><span class="val"><a href="mailto:${esc(t(c.team_email))}">${esc(t(c.team_email))}</a></span>${copyBtn(t(c.team_email))}</div></div>` : ''}
    ${t(c.office_phone) ? `<div class="prop"><div class="k">Office phone</div><div class="crow always"><span class="val num"><a href="${telHref(c.office_phone)}">${esc(fmtPhone(c.office_phone))}</a></span>${copyBtn(t(c.office_phone))}</div></div>` : ''}
    ${propHtml(c.id + ':addr', 'Office address', c.office_address)}
    ${propHtml(c.id + ':notes', 'Notes', c.notes, { clamp: true })}
    ${emptyFieldsHtml(c, fields)}
  </div>
  <div class="insp-f">${metaHtml(c)}</div>`;
}
/* A person selected inside a builder or title company. Shows them in that context. */
function personCardHtml(p, cur, closeX) {
  const affs = affsOfPerson(p.id);
  const here = affs.find(a => (cur.kind === 'builder' && a.builder_id === cur.rec.id) || (cur.kind === 'tc' && a.title_company_id === cur.rec.id))
    || (cur.kind === 'builder' && cur.rec.title_company_id ? affs.find(a => a.title_company_id === cur.rec.title_company_id) : null)
    || affs[0] || null;
  const par = parentOf(here);
  const others = affs.filter(a => a !== here);
  const crows = (arr, kind) => list(arr).filter(x => t(x && x.value)).map(x => {
    const v = t(x.value);
    const shown = kind === 'phone' ? fmtPhone(v) : v;
    const href = kind === 'phone' ? telHref(v) : 'mailto:' + v;
    return `<div class="crow always"><span class="lbl">${esc(t(x.label) || (kind === 'phone' ? 'Phone' : 'Email'))}</span><span class="val ${kind === 'phone' ? 'num' : ''}"><a href="${esc(href)}">${esc(shown)}</a></span>${copyBtn(v)}</div>`;
  }).join('');
  return `<div class="insp-h"><span class="t">Person</span>${closeX}</div>
  <div class="insp-b">
    <div class="who"><a href="#/people/${p.id}">${esc(p.name)}</a></div>
    <div class="role">${here ? `<span>${esc(here.role || 'Contact')} at ${esc(par ? par.name : '')}</span>` : `<span>${esc(t(p.company) || 'Not linked anywhere')}</span>`}${here && here.always_cc ? '<span class="badge">Always CC</span>' : ''}</div>
    ${list(p.phones).some(x => t(x && x.value)) ? `<div class="prop"><div class="k">Phones</div>${crows(p.phones, 'phone')}</div>` : ''}
    ${list(p.emails).some(x => t(x && x.value)) ? `<div class="prop"><div class="k">Emails</div>${crows(p.emails, 'email')}</div>` : ''}
    ${here ? propHtml(p.id + ':handles', 'Handles here', here.handles) : ''}
    ${others.length ? `<div class="prop"><div class="k">Also linked to</div><div class="links">${others.map(a => { const o = parentOf(a); return o ? `<div class="lk"><a class="strong" href="#/${o.kind === 'b' ? 'builders' : 'title'}/${o.rec.id}">${esc(o.name)}</a><span>${esc(a.role || 'Contact')}</span></div>` : ''; }).join('')}</div></div>` : ''}
    ${propHtml(p.id + ':notes', 'Notes', p.notes, { clamp: true })}
    ${t(p.company) && here ? propHtml(p.id + ':co', 'Company', p.company) : ''}
  </div>
  <div class="insp-f">${canWrite() ? `<button class="btn" data-action="edit-person" data-id="${p.id}" data-aff="${here ? here.id : ''}">Edit</button>${here ? `<button class="btn danger" data-action="remove-aff" data-id="${here.id}">Remove from ${esc(par ? par.name : 'here')}</button>` : ''}` : ''}<span class="spacer"></span>${metaHtml(p)}</div>`;
}
/* An organization selected inside a person record: what this person does there, plus the essentials. */
function orgSummaryHtml(a, p, closeX) {
  const par = parentOf(a);
  if (!par) return `<div class="insp-empty">This link points nowhere.</div>`;
  const rec = par.rec;
  const first = t(p.name).split(' ')[0];
  const open = `<a class="tbtn" href="#/${par.kind === 'b' ? 'builders' : 'title'}/${rec.id}">Open ${par.kind === 'b' ? 'builder' : 'company'}</a>`;
  const meta = par.kind === 'b'
    ? [plural(affsOfBuilder(rec.id).length, 'person', 'people'), titleCo(rec.title_company_id) && titleCo(rec.title_company_id).name].filter(Boolean).join(' · ')
    : [plural(buildersOfTc(rec.id).length, 'builder'), plural(affsOfTc(rec.id).length, 'person', 'people')].join(' · ');
  return `<div class="insp-h"><span class="t">${esc(par.name)}</span>${closeX || open}</div>
  <div class="insp-b">
    <div class="meta" style="margin-bottom:14px;">${esc(meta)}</div>
    <div class="prop"><div class="k">${esc(first)} here</div><div class="v">${esc([a.role || 'Contact', t(a.handles), a.always_cc ? 'Always CC.' : ''].filter(Boolean).join('. ').replace(/\.\./g, '.'))}</div></div>
    ${par.kind === 'b' ? propHtml(rec.id + ':cc', 'CC rules', rec.comm_rules, { clamp: true }) + propHtml(rec.id + ':con', 'Concession', [t(rec.concession), t(rec.calc_from) ? 'calculated from ' + t(rec.calc_from).toLowerCase() : ''].filter(Boolean).join(', '))
      : (t(rec.team_email) ? `<div class="prop"><div class="k">Team email</div><div class="crow always"><span class="val"><a href="mailto:${esc(t(rec.team_email))}">${esc(t(rec.team_email))}</a></span>${copyBtn(t(rec.team_email))}</div></div>` : '') + propHtml(rec.id + ':op', 'Office phone', fmtPhone(rec.office_phone))}
    ${closeX ? '' : ''}
  </div>
  <div class="insp-f">${canWrite() ? `<button class="btn" data-action="edit-aff" data-id="${a.id}">Edit link</button><button class="btn danger" data-action="remove-aff" data-id="${a.id}">Remove from ${esc(par.name)}</button>` : ''}<span class="spacer"></span>${closeX ? open : ''}</div>`;
}

// ------------------------------------------------------------------ sign in and fatal screens
function renderAuth() {
  $('#app').hidden = true;
  $('#auth-screen').hidden = false;
  const body = $('#auth-body');
  const msg = state.authMsg ? `<div class="auth-msg${state.authMsg.err ? ' err' : ''}">${esc(state.authMsg.text)}</div>` : '';
  const field = (id, label, type, auto) => `<label class="field"><span>${label}</span><input id="${id}" type="${type}" autocomplete="${auto}"></label>`;
  if (state.session && state.allowed === false) {
    body.innerHTML = `<div class="auth-sub">You are signed in as <strong>${esc(state.session.user.email)}</strong>, but that email is not on the team list. Ask an admin to add it, then try again.</div>
      <button class="btn primary wide" data-auth="retry">Try again</button>
      <div class="auth-links"><span></span><button class="tbtn" data-auth="signout">Sign out</button></div>`;
    return;
  }
  if (state.authView === 'recovery') {
    body.innerHTML = `<div class="auth-sub">Set a new password for ${esc(state.session ? state.session.user.email : 'your account')}.</div>
      <form data-auth-form="setpass" novalidate>${field('auth-pass', 'New password', 'password', 'new-password')}${msg}
      <button type="submit" class="btn primary wide">Save new password</button></form>`;
    return;
  }
  if (state.authView === 'pending') {
    body.innerHTML = `<div class="auth-sub">Check your email for a confirmation link, then come back and sign in.</div>${msg}
      <div class="auth-links"><button class="tbtn" data-auth="view-signin">Back to sign in</button></div>`;
    return;
  }
  if (state.authView === 'forgot') {
    body.innerHTML = `<div class="auth-sub">We will email you a reset link.</div>
      <form data-auth-form="forgot" novalidate>${field('auth-email', 'Email', 'email', 'email')}${msg}
      <button type="submit" class="btn primary wide">Send reset link</button></form>
      <div class="auth-links"><button class="tbtn" data-auth="view-signin">Back to sign in</button></div>`;
    return;
  }
  const signup = state.authView === 'signup';
  body.innerHTML = `<div class="auth-sub">${signup ? 'Create your account with the email your admin added to the team.' : 'Sign in with your team email.'}</div>
    <form data-auth-form="${signup ? 'signup' : 'signin'}" novalidate>
    ${field('auth-email', 'Email', 'email', 'email')}
    ${field('auth-pass', 'Password', 'password', signup ? 'new-password' : 'current-password')}
    ${msg}
    <button type="submit" class="btn primary wide">${signup ? 'Create account' : 'Sign in'}</button></form>
    <div class="auth-links">${signup
      ? '<button class="tbtn" data-auth="view-signin">Back to sign in</button>'
      : '<button class="tbtn" data-auth="view-signup">Create an account</button><button class="tbtn" data-auth="view-forgot">Forgot password?</button>'}</div>`;
  const first = $('#auth-email') || $('#auth-pass');
  if (first) first.focus();
}
function renderFatal(message) {
  $('#rail').innerHTML = '';
  $('#list').innerHTML = '';
  $('#insp').innerHTML = '';
  $('#record').innerHTML = `<div class="fatal"><h1 class="name" style="font-size:20px;">Could not load</h1><p>${esc(message)}</p><button class="btn primary" data-action="reload">Try again</button></div>`;
  $('#app').hidden = false;
  $('#insp').hidden = true;
}
