/* TRL Contacts: everything that edits data. Forms render inside the inspector.
   A form's typed values live in the DOM until saved; state.form.draft holds them across
   re-renders (typeahead picks, adding a phone row, the duplicate warning). */

'use strict';

// ------------------------------------------------------------------ open, close, dirty
function openForm(kind, opts) {
  if (!canWrite()) { toast('Your access is view only.', true); return; }
  state.menu = null;
  state.panel = null;
  const f = { kind, id: opts.id || null, parentKind: opts.parentKind || null, parentId: opts.parentId || null,
    affId: opts.affId || null, personId: opts.personId || null, builderId: opts.builderId || null,
    linkPersonId: null, taOpen: false, taCursor: -1, force: false, dup: null, busy: false, dirty: false,
    confirmDiscard: false, errors: {}, draft: {} };
  if (kind === 'person') {
    const p = f.id ? person(f.id) : null;
    const a = f.affId ? affById(f.affId) : null;
    if (a) { f.parentKind = a.builder_id ? 'b' : 't'; f.parentId = a.builder_id || a.title_company_id; }
    f.draft = { name: p ? p.name : '', company: p ? p.company : '', notes: p ? p.notes : '',
      phones: p ? list(p.phones).map(x => ({ ...x })) : [{ label: 'Mobile', value: '' }],
      emails: p ? list(p.emails).map(x => ({ ...x })) : [{ label: 'Work', value: '' }],
      role: a ? a.role : (opts.role || ''), handles: a ? a.handles : '', always_cc: a ? a.always_cc : false };
    if (!f.draft.phones.length) f.draft.phones = [{ label: 'Mobile', value: '' }];
    if (!f.draft.emails.length) f.draft.emails = [{ label: 'Work', value: '' }];
  } else if (kind === 'aff') {
    const a = f.id ? affById(f.id) : null;
    f.personId = a ? a.person_id : f.personId;
    f.draft = { parentKind: a ? (a.builder_id ? 'b' : 't') : 'b', parentId: a ? (a.builder_id || a.title_company_id) : '',
      role: a ? a.role : '', handles: a ? a.handles : '', always_cc: a ? a.always_cc : false };
  } else if (kind === 'builder') {
    const b = f.id ? builder(f.id) : null;
    f.draft = Object.fromEntries(['name', 'title_company_id', 'dropbox', 'concession', 'calc_from', 'allowed_uses', 'special_process', 'comm_rules', 'notes'].map(k => [k, b ? (b[k] || '') : '']));
  } else if (kind === 'titleco') {
    const c = f.id ? titleCo(f.id) : null;
    f.draft = Object.fromEntries(['name', 'team_email', 'office_phone', 'office_address', 'notes'].map(k => [k, c ? (c[k] || '') : '']));
  } else if (kind === 'linkTitleCo') {
    const b = builder(f.builderId);
    f.draft = { title_company_id: b && b.title_company_id ? b.title_company_id : '', newName: '' };
  }
  state.form = f;
  state.inspOpen = true;
  render();
  focusFirst();
}
function focusFirst() {
  setTimeout(() => {
    const el = $('#insp [data-autofocus]') || $('#insp form input, #insp form select, #insp form textarea');
    if (el) el.focus();
  }, 0);
}
function markDirty() { if (state.form) state.form.dirty = true; }
function isDirty() { return Boolean(state.form && state.form.dirty); }
/* Returns true when the form is gone, false when it asked for confirmation instead. */
function closeForm() {
  const f = state.form;
  if (!f) return true;
  if (f.dirty && !f.confirmDiscard) {
    f.draft = readForm($('#insp form')) || f.draft;
    f.confirmDiscard = true;
    renderInsp();
    return false;
  }
  state.form = null;
  state.inspOpen = Boolean(state.route.sub || state.panel);
  render();
  return true;
}
function keepEditing() {
  if (!state.form) return;
  state.form.confirmDiscard = false;
  renderInsp();
  focusFirst();
}

// ------------------------------------------------------------------ reading and validating
function readForm(form) {
  if (!form) return null;
  const out = {};
  $$('[data-f]', form).forEach(el => {
    if (el.closest('[data-rows]')) return;
    out[el.dataset.f] = el.type === 'checkbox' ? el.checked : t(el.value);
  });
  $$('[data-rows]', form).forEach(group => {
    out[group.dataset.rows] = $$('.rrow', group).map(r => {
      const pick = (name) => { const el = $(`[data-rf="${name}"]`, r); return el ? t(el.value) : ''; };
      const ext = digitsOf(pick('ext'));
      const number = pick('value');
      return { label: pick('label'), value: number && ext ? `${number} x${ext}` : number };   // the extension travels inside the value
    }).filter(x => x.value);
  });
  return out;
}
function showFieldError(form, name, message) {
  const el = $(`[data-f="${name}"]`, form);
  if (!el) { toast(message, true); return; }
  const field = el.closest('.field') || el.parentElement;
  field.classList.add('err');
  let msg = $('.field-error', field);
  if (!msg) { msg = document.createElement('div'); msg.className = 'field-error'; field.appendChild(msg); }
  msg.textContent = message;
  el.setAttribute('aria-invalid', 'true');
  el.focus();
}
function clearFieldError(el) {
  const field = el.closest && el.closest('.field.err');
  if (!field) return;
  field.classList.remove('err');
  const msg = $('.field-error', field);
  if (msg) msg.remove();
  el.removeAttribute('aria-invalid');
}

// ------------------------------------------------------------------ pieces
function fieldHtml(label, name, value, opts) {
  const o = opts || {};
  const ph = o.ph ? ` placeholder="${esc(o.ph)}"` : '';
  const auto = o.autofocus ? ' data-autofocus' : '';
  const extra = o.attrs || '';
  let control;
  if (o.textarea) control = `<textarea data-f="${name}" rows="${o.rows || 3}"${ph}${auto}${extra}>${esc(value || '')}</textarea>`;
  else if (o.options) control = `<select data-f="${name}"${auto}${extra}>${o.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else control = `<input data-f="${name}" type="${o.type || 'text'}" value="${esc(value || '')}"${ph}${auto}${extra}>`;
  return `<label class="field"><span>${esc(label)}</span>${control}${o.hint ? `<div class="hint" style="margin-top:4px;">${esc(o.hint)}</div>` : ''}</label>`;
}
function rowsFieldHtml(kind, items, labels) {
  const rows = (items && items.length ? items : [{ label: labels[0], value: '' }]).map((x, i) => {
    const parts = kind === 'phones' ? splitExt(x.value) : { number: x.value || '', ext: '' };
    return `
    <div class="rrow ${kind === 'phones' ? 'phone' : ''}">
      <select data-rf="label" aria-label="${kind === 'phones' ? 'Phone type' : 'Email type'}">
        ${[''].concat(labels).map(l => `<option value="${esc(l)}" ${ci(l) === ci(x.label) ? 'selected' : ''}>${esc(l || 'No label')}</option>`).join('')}
        ${x.label && !labels.some(l => ci(l) === ci(x.label)) ? `<option value="${esc(x.label)}" selected>${esc(x.label)}</option>` : ''}
      </select>
      <input data-rf="value" type="${kind === 'phones' ? 'tel' : 'email'}" value="${esc(parts.number)}" placeholder="${kind === 'phones' ? '915-555-0100' : 'name@company.com'}" aria-label="${kind === 'phones' ? 'Phone number' : 'Email address'}">
      ${kind === 'phones' ? `<input data-rf="ext" type="text" inputmode="numeric" value="${esc(parts.ext)}" placeholder="Ext." aria-label="Extension">` : ''}
      <button type="button" class="del" data-action="del-row" aria-label="Remove">${icon('x', 14)}</button>
    </div>`; }).join('');
  return `<div class="field rows-field" data-rows="${kind}"><span>${kind === 'phones' ? 'Phones' : 'Emails'}</span>${rows}
    <button type="button" class="tbtn" data-action="add-row" data-kind="${kind}">Add ${kind === 'phones' ? 'phone' : 'email'}</button></div>`;
}
const checkHtml = (name, label, checked) => `<label class="check"><input type="checkbox" data-f="${name}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
function footerHtml(f, buttons) {
  if (f.confirmDiscard) {
    return `<div class="insp-f confirm"><span>Discard unsaved changes?</span>
      <span class="acts"><button type="button" class="btn text" data-action="keep">Keep editing</button><button type="button" class="btn danger fill" data-action="discard">Discard</button></span></div>`;
  }
  return `<div class="insp-f">${buttons}</div>`;
}
const saveBtn = (f, label) => `<button type="submit" form="insp-form" class="btn primary" ${f.busy ? 'disabled' : ''}>${f.busy ? 'Saving' : (label || 'Save')}</button>`;
const cancelBtn = () => `<button type="button" class="btn text" data-action="cancel">Cancel</button>`;
function parentLabel(kind, id) {
  const rec = kind === 'b' ? builder(id) : titleCo(id);
  return rec ? rec.name : '';
}

// ------------------------------------------------------------------ the forms
function formHtml() {
  const f = state.form;
  const d = f.draft;
  const closeX = `<button type="button" class="x" data-action="cancel" aria-label="Close">${icon('x')}</button>`;
  const head = (title) => `<div class="insp-h"><span class="t">${esc(title)}</span>${closeX}</div>`;
  const roleOptions = (kind) => `<datalist id="role-list">${(kind === 't' ? TITLE_ROLE_SUGGESTIONS : state.roles.map(r => r.name)).map(r => `<option value="${esc(r)}"></option>`).join('')}</datalist>`;

  if (f.kind === 'person') {
    const p = f.id ? person(f.id) : null;
    const hasParent = Boolean(f.parentKind && f.parentId);
    const pname = hasParent ? parentLabel(f.parentKind, f.parentId) : '';
    const linked = f.linkPersonId ? person(f.linkPersonId) : null;
    const title = p ? `Edit ${p.name}` : (linked ? `Link ${linked.name}` : 'Add person');
    let body = '';
    if (hasParent && !p) body += `<div class="meta" style="margin-bottom:12px;">To ${esc(pname)}</div>`;
    if (linked) {
      body += `<div class="field"><span>Name</span><div class="input" style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span>${esc(linked.name)}</span><button type="button" class="tbtn" data-action="ta-create">Not them, create new</button></div>
        <div class="hint" style="margin-top:4px;">${esc(affsOfPerson(linked.id).map(a => `${a.role || 'Contact'} at ${parentName(a)}`).join(', ') || 'Not linked anywhere')}</div></div>`;
    } else {
      body += `<div class="field ta"><span>Name</span><input data-f="name" data-ta="${p ? '' : '1'}" type="text" value="${esc(d.name || '')}" placeholder="Full name" autocomplete="off" data-autofocus>${!p && f.taOpen ? `<div class="ta-drop" id="ta-drop">${taOptionsHtml(d.name || '')}</div>` : ''}</div>`;
      if (f.dup) body += dupWarningHtml(f.dup);
      body += fieldHtml('Company or role', 'company', d.company, { ph: 'Optional' });
      body += rowsFieldHtml('phones', d.phones, PHONE_LABELS);
      body += rowsFieldHtml('emails', d.emails, EMAIL_LABELS);
      body += fieldHtml('Notes', 'notes', d.notes, { textarea: true, rows: 3, ph: 'Out Fridays, prefers text, and so on' });
    }
    if (hasParent) {
      body += `<h3 class="sect-h" style="font-size:14px; margin-top:6px;">At ${esc(pname)}</h3>
        <label class="field"><span>Role</span><input data-f="role" list="role-list" value="${esc(d.role || '')}" placeholder="${f.parentKind === 't' ? 'Escrow Agent' : 'Builder Rep'}" autocomplete="off"></label>${roleOptions(f.parentKind)}
        ${fieldHtml('Handles', 'handles', d.handles, { textarea: true, rows: 2, ph: 'What they handle here, when to contact them' })}
        ${f.parentKind === 'b' ? checkHtml('always_cc', 'Always CC on emails to this builder', d.always_cc) : ''}`;
    }
    const buttons = `${p && !f.affId ? `<button type="button" class="btn danger" data-action="delete" data-table="people" data-id="${p.id}">Delete person</button>` : ''}${p && f.affId ? `<button type="button" class="btn danger" data-action="remove-aff" data-id="${f.affId}">Remove from ${esc(pname)}</button>` : ''}<span class="spacer"></span>${cancelBtn()}
      ${!p && hasParent ? `<button type="submit" form="insp-form" class="btn" name="then" value="another" ${f.busy ? 'disabled' : ''}>Save and add another</button>` : ''}${saveBtn(f)}`;
    return `${head(title)}<form id="insp-form" data-form="person" novalidate class="insp-b">${body}</form>${footerHtml(f, buttons)}`;
  }

  if (f.kind === 'aff') {
    const a = f.id ? affById(f.id) : null;
    const p = person(f.personId);
    const kind = d.parentKind || 'b';
    const parentOpts = kind === 'b' ? state.builders.map(b => [b.id, b.name]) : state.titleCompanies.map(c => [c.id, c.name]);
    const body = `
      ${a ? `<div class="meta" style="margin-bottom:12px;">${esc(p ? p.name : '')} at ${esc(parentName(a))}</div>` : `
        ${fieldHtml('Link to', 'parentKind', kind, { options: [['b', 'A builder'], ['t', 'A title company']], attrs: ' data-rerender="1"' })}
        ${fieldHtml(kind === 'b' ? 'Builder' : 'Title company', 'parentId', d.parentId, { options: [['', 'Choose']].concat(parentOpts), autofocus: true })}`}
      <label class="field"><span>Role</span><input data-f="role" list="role-list" value="${esc(d.role || '')}" autocomplete="off" ${a ? 'data-autofocus' : ''}></label>${roleOptions(kind)}
      ${fieldHtml('Handles', 'handles', d.handles, { textarea: true, rows: 2, ph: 'What they handle here, when to contact them' })}
      ${kind === 'b' ? checkHtml('always_cc', 'Always CC on emails to this builder', d.always_cc) : ''}`;
    const buttons = `${a ? `<button type="button" class="btn danger" data-action="remove-aff" data-id="${a.id}">Remove from ${esc(parentName(a))}</button>` : ''}<span class="spacer"></span>${cancelBtn()}${saveBtn(f)}`;
    return `${head(a ? 'Edit link' : 'Link to an organization')}<form id="insp-form" data-form="aff" novalidate class="insp-b">${body}</form>${footerHtml(f, buttons)}`;
  }

  if (f.kind === 'builder') {
    const body = `
      ${fieldHtml('Name', 'name', d.name, { autofocus: true, ph: 'Builder name' })}
      ${fieldHtml('Title company', 'title_company_id', d.title_company_id, { options: [['', 'No title company']].concat(state.titleCompanies.map(c => [c.id, c.name])) })}
      ${fieldHtml('Dropbox folder', 'dropbox', d.dropbox, { ph: 'Paste the folder link' })}
      <div class="half">${fieldHtml('Concession', 'concession', d.concession, { ph: 'Up to 3%' })}${fieldHtml('Calculated from', 'calc_from', d.calc_from, { ph: 'Loan amount' })}</div>
      ${fieldHtml('Allowed uses', 'allowed_uses', d.allowed_uses, { textarea: true, rows: 4 })}
      ${fieldHtml('Special process', 'special_process', d.special_process, { textarea: true, rows: 3, ph: 'Anything unusual about how this builder works' })}
      ${fieldHtml('CC rules', 'comm_rules', d.comm_rules, { textarea: true, rows: 3, ph: 'Who to copy, and when' })}
      ${fieldHtml('Notes', 'notes', d.notes, { textarea: true, rows: 3 })}`;
    const buttons = `${f.id ? `<button type="button" class="btn danger" data-action="delete" data-table="builders" data-id="${f.id}">Delete builder</button>` : ''}<span class="spacer"></span>${cancelBtn()}${saveBtn(f)}`;
    return `${head(f.id ? 'Edit builder' : 'New builder')}<form id="insp-form" data-form="builder" novalidate class="insp-b">${body}</form>${footerHtml(f, buttons)}`;
  }

  if (f.kind === 'titleco') {
    const body = `
      ${fieldHtml('Name', 'name', d.name, { autofocus: true, ph: 'Company name' })}
      ${fieldHtml('Team or group email', 'team_email', d.team_email, { type: 'email' })}
      ${fieldHtml('Office phone', 'office_phone', d.office_phone, { type: 'tel' })}
      ${fieldHtml('Office address', 'office_address', d.office_address, { textarea: true, rows: 2 })}
      ${fieldHtml('Notes', 'notes', d.notes, { textarea: true, rows: 3 })}`;
    const buttons = `${f.id ? `<button type="button" class="btn danger" data-action="delete" data-table="title_companies" data-id="${f.id}">Delete company</button>` : ''}<span class="spacer"></span>${cancelBtn()}${saveBtn(f)}`;
    return `${head(f.id ? 'Edit title company' : 'New title company')}<form id="insp-form" data-form="titleco" novalidate class="insp-b">${body}</form>${footerHtml(f, buttons)}`;
  }

  if (f.kind === 'linkTitleCo') {
    const b = builder(f.builderId);
    const isNew = d.title_company_id === '__new';
    const body = `
      <div class="meta" style="margin-bottom:12px;">${esc(b ? b.name : '')}</div>
      ${fieldHtml('Title company', 'title_company_id', d.title_company_id, { options: [['', 'No title company']].concat(state.titleCompanies.map(c => [c.id, c.name])).concat([['__new', 'Create a new title company']]), autofocus: true, attrs: ' data-rerender="1"' })}
      ${isNew ? fieldHtml('New company name', 'newName', d.newName, { ph: 'Company name', autofocus: true }) : ''}`;
    return `${head('Link a title company')}<form id="insp-form" data-form="linkTitleCo" novalidate class="insp-b">${body}</form>${footerHtml(f, `<span class="spacer"></span>${cancelBtn()}${saveBtn(f)}`)}`;
  }
  return '';
}
function dupWarningHtml(dup) {
  const affs = affsOfPerson(dup.id);
  return `<div class="warn" role="alert"><strong>${esc(dup.name)}</strong> is already in the system${affs.length ? ` (${esc(affs.map(a => `${a.role || 'Contact'} at ${parentName(a)}`).join(', '))})` : ''} with the same ${esc(dup.why)}.
    <div class="acts"><button type="button" class="btn" data-action="link-existing" data-id="${dup.id}">Link ${esc(dup.name)}</button><button type="button" class="btn text" data-action="force-create">Create anyway</button></div></div>`;
}

// ------------------------------------------------------------------ typeahead over existing people
function taMatches(q) {
  const tokens = tokenize(q);
  if (!tokens.length || q.length < 2) return [];
  return state.people.filter(p => {
    const hay = ci([p.name, p.company, ...list(p.emails).map(x => x.value)].join(' '));
    return tokens.every(tok => hay.includes(tok));
  }).sort(byName).slice(0, 6);
}
function taOptionsHtml(q) {
  const tokens = tokenize(q);
  const f = state.form;
  const opts = taMatches(q).map((p, i) => `<button type="button" class="ta-opt ${i === f.taCursor ? 'on' : ''}" data-action="ta-pick" data-id="${p.id}" role="option">${hl(p.name, tokens)}
    <span class="sub">${esc(affsOfPerson(p.id).map(a => `${a.role || 'Contact'} at ${parentName(a)}`).join(', ') || (t(p.company) || 'Not linked anywhere'))}</span></button>`).join('');
  return `${opts}<button type="button" class="ta-opt create" data-action="ta-create" role="option">Create new person "${esc(q)}"</button>`;
}
function typeaheadInput(input) {
  const f = state.form;
  if (!f || f.kind !== 'person' || f.id) return;
  const q = t(input.value);
  f.taCursor = -1;
  f.taOpen = q.length >= 2;
  const wrap = input.closest('.ta');
  let drop = $('#ta-drop', wrap);
  if (!f.taOpen) { if (drop) drop.remove(); return; }
  if (!drop) { drop = document.createElement('div'); drop.className = 'ta-drop'; drop.id = 'ta-drop'; wrap.appendChild(drop); }
  drop.innerHTML = taOptionsHtml(q);
}
function typeaheadKey(e) {
  const f = state.form;
  if (!f || !f.taOpen) return;
  const opts = $$('#ta-drop .ta-opt');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    f.taCursor = Math.max(-1, Math.min(opts.length - 1, f.taCursor + (e.key === 'ArrowDown' ? 1 : -1)));
    opts.forEach((o, i) => o.classList.toggle('on', i === f.taCursor));
  }
  if (e.key === 'Enter' && f.taCursor >= 0 && opts[f.taCursor]) { e.preventDefault(); opts[f.taCursor].click(); }
}
function typeaheadPick(personId) {
  const f = state.form;
  if (!f) return;
  f.draft = readForm($('#insp form')) || f.draft;
  f.linkPersonId = personId;
  f.dup = null;
  f.taOpen = false;
  f.dirty = true;
  renderInsp();
  const role = $('#insp [data-f="role"]');
  if (role) role.focus();
}
function typeaheadCreate() {
  const f = state.form;
  if (!f) return;
  f.draft = readForm($('#insp form')) || f.draft;
  if (f.linkPersonId) { const p = person(f.linkPersonId); if (p && !t(f.draft.name)) f.draft.name = ''; }
  f.linkPersonId = null;
  f.taOpen = false;
  renderInsp();
  const name = $('#insp [data-f="name"]');
  if (name) { name.focus(); }
}
function addRow(kind) {
  const f = state.form;
  f.draft = readForm($('#insp form')) || f.draft;
  f.draft[kind] = list(f.draft[kind]).concat([{ label: kind === 'phones' ? 'Office' : 'Personal', value: '' }]);
  f.dirty = true;
  renderInsp();
  const inputs = $$(`#insp [data-rows="${kind}"] [data-rf="value"]`);
  if (inputs.length) inputs[inputs.length - 1].focus();
}
function delRow(btn) {
  const row = btn.closest('.rrow');
  const group = row.closest('[data-rows]');
  row.remove();
  markDirty();
  if (!$('.rrow', group)) addRow(group.dataset.rows);
}

// ------------------------------------------------------------------ saving
async function handleSubmit(form, submitter) {
  const f = state.form;
  if (!f || f.busy) return;
  const v = readForm(form);
  f.draft = v;
  const kind = form.dataset.form;
  const then = submitter && submitter.value === 'another';
  const busy = (on) => { f.busy = on; $$('#insp button[type="submit"]').forEach(b => { b.disabled = on; }); };

  if (kind === 'person') {
    const hasParent = Boolean(f.parentKind && f.parentId);
    const parentCols = hasParent ? (f.parentKind === 'b' ? { builder_id: f.parentId, title_company_id: null } : { builder_id: null, title_company_id: f.parentId }) : null;
    const affValues = hasParent ? { role: v.role || '', handles: v.handles || '', always_cc: Boolean(v.always_cc) } : null;
    let pid = f.id || f.linkPersonId;
    busy(true);
    try {
      if (!pid) {
        if (!v.name) { busy(false); showFieldError(form, 'name', 'Name is required'); return; }
        const dup = !f.force && findDuplicate(v);
        if (dup) { busy(false); f.dup = dup; renderInsp(); return; }
        const p = await saveRow('people', null, { name: v.name, company: v.company || '', notes: v.notes || '', phones: v.phones || [], emails: v.emails || [] });
        if (!p) { busy(false); return; }
        pid = p.id;
        if (hasParent) {
          const a = await saveRow('affiliations', null, { person_id: pid, ...parentCols, ...affValues });
          if (!a) { await deleteRow('people', pid); busy(false); return; }
        }
        toast(`Added ${p.name}`);
      } else if (f.linkPersonId) {
        const a = await saveRow('affiliations', null, { person_id: pid, ...parentCols, ...affValues });
        if (!a) { busy(false); return; }
        toast(`Linked ${person(pid).name}`);
      } else {
        if (!v.name) { busy(false); showFieldError(form, 'name', 'Name is required'); return; }
        const p = await saveRow('people', pid, { name: v.name, company: v.company || '', notes: v.notes || '', phones: v.phones || [], emails: v.emails || [] });
        if (!p) { busy(false); return; }
        if (f.affId) { const a = await saveRow('affiliations', f.affId, affValues); if (!a) { busy(false); return; } }
        toast(`Saved ${p.name}`);
      }
    } finally { f.busy = false; }
    if (then && hasParent) {
      openForm('person', { parentKind: f.parentKind, parentId: f.parentId });
      return;
    }
    state.form = null;
    if (hasParent && !f.id) navigate(`#/${f.parentKind === 'b' ? 'builders' : 'title'}/${f.parentId}/person/${pid}`);
    else if (!hasParent && !f.id) navigate(`#/people/${pid}`);
    else { state.inspOpen = Boolean(state.route.sub); render(); }
    return;
  }

  if (kind === 'aff') {
    const pk = v.parentKind || (f.id ? (affById(f.id).builder_id ? 'b' : 't') : 'b');
    const parentId = f.id ? (affById(f.id).builder_id || affById(f.id).title_company_id) : v.parentId;
    if (!parentId) { showFieldError(form, 'parentId', 'Pick a builder or title company'); return; }
    const values = { role: v.role || '', handles: v.handles || '', always_cc: Boolean(v.always_cc) };
    if (!f.id) Object.assign(values, { person_id: f.personId, builder_id: pk === 'b' ? parentId : null, title_company_id: pk === 't' ? parentId : null });
    busy(true);
    const a = await saveRow('affiliations', f.id, values);
    busy(false);
    if (!a) return;
    toast('Saved');
    state.form = null;
    if (state.route.section === 'people') navigate(`#/people/${a.person_id}/at/${a.id}`);
    else { state.inspOpen = Boolean(state.route.sub); render(); }
    return;
  }

  if (kind === 'builder' || kind === 'titleco') {
    if (!v.name) { showFieldError(form, 'name', 'Name is required'); return; }
    const table = kind === 'builder' ? 'builders' : 'title_companies';
    if (kind === 'builder') v.title_company_id = v.title_company_id || null;
    busy(true);
    const rec = await saveRow(table, f.id, v);
    busy(false);
    if (!rec) return;
    toast(`Saved ${rec.name}`);
    state.form = null;
    if (!f.id) navigate(`#/${kind === 'builder' ? 'builders' : 'title'}/${rec.id}`);
    else if (state.route.sub) navigate(routeHash({ ...state.route, sub: null, subId: null }));   // show the details just edited
    else { state.inspOpen = false; render(); }
    return;
  }

  if (kind === 'linkTitleCo') {
    let tcId = v.title_company_id || null;
    busy(true);
    if (tcId === '__new') {
      if (!v.newName) { busy(false); showFieldError(form, 'newName', 'Company name is required'); return; }
      const c = await saveRow('title_companies', null, { name: v.newName });
      if (!c) { busy(false); return; }
      tcId = c.id;
    }
    const b = await saveRow('builders', f.builderId, { title_company_id: tcId });
    busy(false);
    if (!b) return;
    toast(tcId ? 'Title company linked' : 'Title company unlinked');
    state.form = null;
    state.inspOpen = Boolean(state.route.sub);
    render();
  }
}
/* Same name, or a phone or email that someone already has. */
function findDuplicate(v) {
  const name = ci(v.name);
  const phones = list(v.phones).map(x => digitsOf(x.value)).filter(d => d.length >= 7);
  const emails = list(v.emails).map(x => ci(x.value)).filter(Boolean);
  for (const p of state.people) {
    if (name && ci(p.name) === name) return { ...p, why: 'name' };
    if (phones.length && list(p.phones).some(x => phones.includes(digitsOf(x.value)))) return { ...p, why: 'phone number' };
    if (emails.length && list(p.emails).some(x => emails.includes(ci(x.value)))) return { ...p, why: 'email' };
  }
  return null;
}

// ------------------------------------------------------------------ deletes (two clicks, the first one says what goes)
function deleteFromForm(btn) {
  const table = btn.dataset.table, id = btn.dataset.id;
  if (!canWrite()) return;
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    let msg = 'Click again to confirm';
    if (table === 'builders') { const n = affsOfBuilder(id).length; msg = `Delete ${builder(id).name}${n ? ` and its ${plural(n, 'link')} (people stay in the list)` : ''}? Click again to confirm.`; }
    if (table === 'title_companies') { const n = buildersOfTc(id).length, m = affsOfTc(id).length; msg = `Delete ${titleCo(id).name}${n ? `, unlinking ${plural(n, 'builder')}` : ''}${m ? ` and ${plural(m, 'person', 'people')}` : ''}? Click again to confirm.`; }
    if (table === 'people') { const n = affsOfPerson(id).length; msg = `Delete ${person(id).name}${n ? ` and their ${plural(n, 'link')}` : ''}? Click again to confirm.`; }
    btn.textContent = msg;
    return;
  }
  (async () => {
    const name = (builder(id) || titleCo(id) || person(id) || {}).name || '';
    if (!(await deleteRow(table, id))) return;
    toast(`Deleted ${name}`);
    state.form = null;
    state.menu = null;
    state.inspOpen = false;
    navigate('#/' + state.route.section);
  })();
}
function removeAffiliation(id, btn) {
  const a = affById(id);
  if (!a || !canWrite()) return;
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    const p = person(a.person_id);
    btn.textContent = `Remove ${p ? p.name : 'them'} from ${parentName(a)}? They stay in People. Click again.`;
    return;
  }
  (async () => {
    if (!(await deleteRow('affiliations', id))) return;
    toast('Removed');
    state.form = null;
    state.menu = null;
    const r = state.route;
    if ((r.sub === 'person' && r.subId === a.person_id) || (r.sub === 'at' && r.subId === id)) navigate(routeHash({ ...r, sub: null, subId: null }));
    else render();
  })();
}

// ------------------------------------------------------------------ team, roles, help panels
function panelHtml(kind) {
  const closeX = `<button class="x" data-action="close-insp" aria-label="Close">${icon('x')}</button>`;
  if (kind === 'team') {
    const me = state.session ? ci(state.session.user.email) : '';
    const levels = ['read', 'write', 'admin'];
    const sel = (email, cur) => `<select data-team-access data-email="${esc(email)}" aria-label="Access for ${esc(email)}">${levels.map(l => `<option value="${l}" ${l === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="insp-h"><span class="t">Team access</span>${closeX}</div>
    <div class="insp-b">
      <p class="meta" style="margin:0 0 12px; font-size:13px; line-height:18px;">Everyone here can sign in. Read is view only. Write can edit builders, people and title companies. Admin can also manage this list and the roles. To add a teammate, add their email and pick a level; they then create an account with that exact email.</p>
      <div class="tlist">${state.team.map(r => `<div class="trow"><span class="who2">${esc(r.email)}${ci(r.email) === me ? ' <span class="muted">(you)</span>' : ''}</span><span class="ctl">${sel(r.email, r.access)}<button class="tbtn" data-action="team-remove" data-email="${esc(r.email)}">Remove</button></span></div>`).join('')}</div>
      <div class="tadd"><input type="email" data-f="new_email" placeholder="teammate@company.com" aria-label="Email"><select data-f="new_access" aria-label="Access">${levels.map(l => `<option value="${l}">${l}</option>`).join('')}</select><button class="btn" data-action="team-add">Add</button></div>
    </div>`;
  }
  if (kind === 'roles') {
    return `<div class="insp-h"><span class="t">Roles</span>${closeX}</div>
    <div class="insp-b">
      <p class="meta" style="margin:0 0 12px; font-size:13px; line-height:18px;">These are the suggestions in the Role box and the order people are listed in. Renaming or removing a role does not change people already saved with it.</p>
      <div class="tlist">${state.roles.map((r, i) => `<div class="trow"><span class="who2">${esc(r.name)}</span><span class="ctl">
        <button class="mini" data-action="role-up" data-id="${r.id}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 14)}</button>
        <button class="mini" data-action="role-down" data-id="${r.id}" aria-label="Move down" ${i === state.roles.length - 1 ? 'disabled' : ''}>${icon('down', 14)}</button>
        <button class="tbtn" data-action="role-remove" data-id="${r.id}">Remove</button></span></div>`).join('')}</div>
      <div class="tadd"><input data-f="new_role" placeholder="New role" aria-label="New role"><button class="btn" data-action="role-add">Add</button></div>
    </div>`;
  }
  return `<div class="insp-h"><span class="t">How this works</span>${closeX}</div>
  <div class="insp-b help">
    <h4>Three sections</h4>
    <p>Builders, People and Title companies, in the rail on the left. Pick one in the list and it opens in the middle. The panel on the right shows details for whatever you click.</p>
    <h4>Look up a builder</h4>
    <p>Its people are listed first, with what each one handles. The builder's CC rules, concession and Dropbox folder sit in the details panel. A check in the CC column marks people who are always copied; Copy all emails puts their addresses on your clipboard.</p>
    <h4>Find anyone</h4>
    <p>Type in the search box (or press /) to find a person, builder or title company by name, role, phone number or email. Results are grouped; Enter opens the first one.</p>
    <h4>One person, many places</h4>
    <p>A person is entered once and can be linked to several builders or title companies with a different role at each. When you add a person to a builder, start typing their name: if they already exist, pick them to link instead of creating a duplicate.</p>
    <h4>Copy</h4>
    <p>Every phone and email has a copy button. Clicking the number or address itself calls or emails.</p>
    <h4>Export to Excel</h4>
    <p>In the account menu. Downloads the whole database as the team's standard workbook, in case you ever want a spreadsheet copy or an offline backup.</p>
    <p class="meta">Version ${esc(APP_VERSION)}</p>
  </div>`;
}
async function teamAdd() {
  const email = ci($('#insp [data-f="new_email"]').value);
  const access = $('#insp [data-f="new_access"]').value;
  if (!email || !email.includes('@')) { toast('Enter an email address.', true); return; }
  const { error } = DEMO ? { error: null } : await supa.from('allowed_users').insert({ email, access });
  if (error) { toast(friendlyError(error), true); return; }
  state.team.push({ email, access });
  state.team.sort((a, b) => a.email.localeCompare(b.email));
  renderInsp();
}
async function teamRemove(email, btn) {
  const me = state.session ? ci(state.session.user.email) : '';
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = ci(email) === me ? 'This locks you out. Click again.' : 'Click again to confirm'; return; }
  const { data, error } = DEMO ? { data: [1], error: null } : await supa.from('allowed_users').delete().eq('email', email).select();
  if (error) { toast(friendlyError(error), true); renderInsp(); return; }
  if (!data.length) { toast('Not allowed.', true); renderInsp(); return; }
  state.team = state.team.filter(r => r.email !== email);
  if (ci(email) === me) { state.allowed = false; state.myAccess = null; renderAuth(); return; }
  renderInsp();
}
async function teamSetAccess(sel) {
  const email = sel.dataset.email;
  const { data, error } = DEMO ? { data: [1], error: null } : await supa.from('allowed_users').update({ access: sel.value }).eq('email', email).select();
  if (error || !data.length) { toast(error ? friendlyError(error) : 'Not allowed.', true); renderInsp(); return; }
  const row = state.team.find(r => r.email === email);
  if (row) row.access = sel.value;
  toast('Access updated');
  if (state.session && ci(email) === ci(state.session.user.email)) { state.myAccess = sel.value; if (!isAdmin()) state.panel = null; render(); }
}
async function roleAdd() {
  const input = $('#insp [data-f="new_role"]');
  const name = t(input.value);
  if (!name) return;
  const r = await saveRow('roles', null, { name, position: state.roles.length });
  if (r) renderInsp();
}
async function roleRemove(id, btn) {
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Sure?'; return; }
  if (await deleteRow('roles', id)) renderInsp();
}
async function roleMove(id, dir) {
  const i = state.roles.findIndex(r => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.roles.length) return;
  const a = state.roles[i], b = state.roles[j];
  const [pa, pb] = [a.position, b.position];
  a.position = pb; b.position = pa;
  state.roles.sort((x, y) => x.position - y.position);
  renderInsp();
  const r1 = await api.update('roles', a.id, { position: pb });
  const r2 = await api.update('roles', b.id, { position: pa });
  if (r1.error || r2.error) { toast(friendlyError(r1.error || r2.error), true); a.position = pa; b.position = pb; state.roles.sort((x, y) => x.position - y.position); renderInsp(); return; }
  reindex();
}
