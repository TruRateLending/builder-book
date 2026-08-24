/* Builder Book - team builder database.
   Plain JavaScript, no build step. To change the backend, edit the two
   constants below. Data lives in Supabase; this page holds no data itself. */

'use strict';

const SUPABASE_URL = 'https://rqmuaeuqiqkhsnmashab.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Vrs-KYaeRnKCXlhAvq_w1w_8JqcBtJq';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ------------------------------------------------------------------ state
const state = {
  session: null,
  allowed: null,          // null = unknown, true/false after check
  myAccess: null,         // 'read' | 'write' | 'admin' once signed in and allowed
  authView: 'signin',     // signin | signup | forgot | recovery | pending
  authMsg: null,          // {text, err}
  builders: [],
  contacts: [],
  titleCompanies: [],
  roles: [],
  team: [],               // [{email, access}]
  sel: null,              // {type:'b'|'t', id}
  q: '',
};

const canWrite = () => state.myAccess === 'write' || state.myAccess === 'admin';
const isAdmin = () => state.myAccess === 'admin';

function applyTeam(rows) {
  state.team = rows;
  const me = state.session ? ci(state.session.user.email) : '';
  const mine = rows.find(r => ci(r.email) === me);
  state.myAccess = mine ? mine.access : null;
}

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const t = (s) => (s || '').trim();
const telHref = (p) => 'tel:' + (p || '').replace(/[^0-9+]/g, '');
const ci = (s) => (s || '').toLowerCase();

let toastTimer = null;
function toast(text, isErr) {
  const el = $('#toast');
  el.textContent = text;
  el.className = isErr ? 'err' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 5000 : 2600);
}

function friendlyError(error) {
  const m = (error && error.message) || 'Something went wrong.';
  if (/duplicate key|unique/i.test(m)) return 'That name is already in use.';
  return m;
}

// ------------------------------------------------------------------ auth
async function boot() {
  const { data } = await db.auth.getSession();
  state.session = data.session;
  db.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') {
      state.authView = 'recovery';
      state.allowed = null;
      renderAuth();
      return;
    }
    if (event === 'SIGNED_OUT') {
      state.allowed = null;
      state.authView = 'signin';
      state.authMsg = null;
      renderAuth();
      return;
    }
    if (event === 'SIGNED_IN' && state.allowed === null) enter();
  });
  if (state.session) enter(); else renderAuth();
}

async function enter() {
  const { data, error } = await db.from('allowed_users').select('email, access').order('email');
  if (error) {
    state.authView = 'signin';
    state.authMsg = { text: 'Could not reach the database: ' + friendlyError(error), err: true };
    renderAuth();
    return;
  }
  applyTeam(data);
  state.allowed = data.length > 0;
  if (!state.allowed) { renderAuth(); return; }
  await loadAll();
  if (!state.allowed) return;
  if (!state.sel && state.builders.length) state.sel = { type: 'b', id: state.builders[0].id };
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  render();
}

function renderAuth() {
  $('#app').hidden = true;
  $('#auth-screen').hidden = false;
  const body = $('#auth-body');
  const msg = state.authMsg
    ? `<div class="auth-msg${state.authMsg.err ? ' err' : ''}">${esc(state.authMsg.text)}</div>` : '';

  if (state.session && state.allowed === false) {
    body.innerHTML = `
      <div class="auth-msg err">You're signed in as <strong>${esc(state.session.user.email)}</strong>,
      but that email isn't on the team list yet. Ask a teammate to add it under Team, then try again.</div>
      <button class="btn-primary" data-auth="retry">Try again</button>
      <div class="auth-alt"><button data-auth="signout">Sign out</button></div>`;
    return;
  }
  if (state.authView === 'recovery') {
    body.innerHTML = `
      <div class="auth-msg">Set a new password for ${esc(state.session ? state.session.user.email : 'your account')}.</div>
      <label class="auth-field"><span>New password</span><input id="auth-pass" type="password" autocomplete="new-password"></label>
      ${msg}
      <button class="btn-primary" data-auth="setpass">Save new password</button>`;
    return;
  }
  if (state.authView === 'pending') {
    body.innerHTML = `
      <div class="auth-msg">Check your email for a confirmation link, then come back and sign in.</div>
      ${msg}
      <div class="auth-alt"><button data-auth="view-signin">Back to sign in</button></div>`;
    return;
  }
  if (state.authView === 'forgot') {
    body.innerHTML = `
      <label class="auth-field"><span>Email</span><input id="auth-email" type="email" autocomplete="email"></label>
      ${msg}
      <button class="btn-primary" data-auth="forgot">Send reset link</button>
      <div class="auth-alt"><button data-auth="view-signin">Back to sign in</button></div>`;
    return;
  }
  const signup = state.authView === 'signup';
  body.innerHTML = `
    <label class="auth-field"><span>Email</span><input id="auth-email" type="email" autocomplete="email"></label>
    <label class="auth-field"><span>Password</span><input id="auth-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
    ${msg}
    <button class="btn-primary" data-auth="${signup ? 'signup' : 'signin'}">${signup ? 'Create account' : 'Sign in'}</button>
    <div class="auth-alt">
      ${signup
        ? 'Already have an account? <button data-auth="view-signin">Sign in</button>'
        : 'New here? <button data-auth="view-signup">Create an account</button> &middot; <button data-auth="view-forgot">Forgot password?</button>'}
    </div>`;
}

async function handleAuth(action) {
  const email = $('#auth-email') ? t($('#auth-email').value) : '';
  const pass = $('#auth-pass') ? $('#auth-pass').value : '';
  state.authMsg = null;
  if (action === 'view-signin') { state.authView = 'signin'; return renderAuth(); }
  if (action === 'view-signup') { state.authView = 'signup'; return renderAuth(); }
  if (action === 'view-forgot') { state.authView = 'forgot'; return renderAuth(); }
  if (action === 'signout') { await db.auth.signOut(); return; }
  if (action === 'retry') { state.allowed = null; return enter(); }

  if (action === 'signin') {
    const { error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; return renderAuth(); }
    return; // onAuthStateChange -> enter()
  }
  if (action === 'signup') {
    const { data, error } = await db.auth.signUp({ email, password: pass });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; return renderAuth(); }
    if (data.session) return; // confirmations off -> signed in
    state.authView = 'pending';
    return renderAuth();
  }
  if (action === 'forgot') {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; }
    else state.authMsg = { text: 'If that email has an account, a reset link is on its way.' };
    return renderAuth();
  }
  if (action === 'setpass') {
    const { error } = await db.auth.updateUser({ password: pass });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; return renderAuth(); }
    state.authView = 'signin';
    state.allowed = null;
    return enter();
  }
}

// ------------------------------------------------------------------ data
async function loadAll() {
  const [b, c, tc, r, team] = await Promise.all([
    db.from('builders').select('*').order('name'),
    db.from('contacts').select('*'),
    db.from('title_companies').select('*').order('name'),
    db.from('roles').select('*').order('position'),
    db.from('allowed_users').select('email, access').order('email'),
  ]);
  for (const res of [b, c, tc, r, team]) {
    if (res.error) { toast('Load failed: ' + friendlyError(res.error), true); return; }
  }
  if (team.data.length === 0) {   // access was revoked while signed in
    state.allowed = false;
    state.myAccess = null;
    renderAuth();
    return;
  }
  applyTeam(team.data);
  state.builders = b.data;
  state.contacts = c.data;
  state.titleCompanies = tc.data;
  state.roles = r.data;
}

async function refresh() {
  await loadAll();
  if (!state.allowed) return;
  const list = state.sel && state.sel.type === 'b' ? state.builders : state.titleCompanies;
  if (state.sel && !list.some(x => x.id === state.sel.id)) {
    state.sel = state.builders.length ? { type: 'b', id: state.builders[0].id } : null;
  }
  render();
}

const tcById = (id) => state.titleCompanies.find(x => x.id === id) || null;
const contactsOf = (id) => {
  const rank = (role) => {
    const i = state.roles.findIndex(r => r.name === role);
    return i < 0 ? 99 : i;
  };
  return state.contacts.filter(c => c.builder_id === id)
    .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
};

/* Gap logic - same rules as the "To Fill In" tab of the Excel workbook. */
function gapsFor(b) {
  const cs = state.contacts.filter(c => c.builder_id === b.id);
  const tc = tcById(b.title_company_id);
  const roleHas = (frag) => cs.some(c => ci(c.role).includes(frag));
  const roleStarts = (frag) => cs.some(c => ci(c.role).startsWith(frag));
  const handlesHas = (frag) => cs.some(c => ci(c.handles).includes(frag));
  const g = [];
  const openB = { kind: 'builder', id: b.id };
  const openRole = (role) => ({ kind: 'contact', builderId: b.id, role });
  const openT = tc ? { kind: 'titleco', id: tc.id } : openB;
  if (!tc) g.push({ label: 'Title company', go: openB });
  if (!t(b.dropbox)) g.push({ label: 'Dropbox', go: openB });
  if (!t(b.concession)) g.push({ label: 'Concession terms', go: openB });
  if (!t(b.allowed_uses)) g.push({ label: 'Allowed uses', go: openB });
  if (!roleHas('owner') && !handlesHas('owner')) g.push({ label: 'Owner', go: openRole('Owner') });
  if (!roleHas('listing') && !handlesHas('listing agent')) g.push({ label: 'Listing agent', go: openRole('Listing Agent') });
  if (!roleHas('builder rep') && !roleStarts('sales')) g.push({ label: 'Builder rep', go: openRole('Builder Rep') });
  if (!roleHas('docs') && !handlesHas('builder doc')) g.push({ label: 'Builder docs POC', go: openRole('Builder Docs POC') });
  if (!roleHas('appraisal') && !handlesHas('apprais')) g.push({ label: 'Appraisal POC', go: openRole('Appraisal POC') });
  if (!tc || !t(tc.agent_name)) g.push({ label: 'Escrow agent', go: openT });
  if (!tc || !t(tc.asst_name)) g.push({ label: 'Escrow assistant', go: openT });
  return g;
}

// ------------------------------------------------------------------ render
function render() {
  $('[data-action="team"]').hidden = !isAdmin();
  $('#access-note').hidden = state.myAccess !== 'read';
  renderSidebar();
  renderMain();
}

function renderSidebar() {
  const q = ci(t(state.q));
  const cMatch = (c) => ci(`${c.name} ${c.role} ${c.email} ${c.phone}`).includes(q);

  const builders = state.builders.filter(b => {
    if (!q) return true;
    if (ci(b.name).includes(q)) return true;
    const tc = tcById(b.title_company_id);
    if (tc && ci(tc.name).includes(q)) return true;
    return state.contacts.some(c => c.builder_id === b.id && cMatch(c));
  });
  const tcs = state.titleCompanies.filter(x => !q || ci(x.name + ' ' + x.agent_name).includes(q));

  const newBtn = (action) => canWrite() ? `<button data-action="${action}">+ New</button>` : '';
  let html = `
    <div class="side-heading"><span>Builders</span>${newBtn('new-builder')}</div>`;
  for (const b of builders) {
    const active = state.sel && state.sel.type === 'b' && state.sel.id === b.id;
    const g = gapsFor(b).length;
    const tc = tcById(b.title_company_id);
    const m = q && !ci(b.name).includes(q)
      ? state.contacts.find(c => c.builder_id === b.id && cMatch(c)) : null;
    const sub = m ? `↳ ${m.name} · ${m.role}` : (tc ? tc.name : 'No title company yet');
    html += `
      <div class="side-item${active ? ' active' : ''}" data-action="select" data-type="b" data-id="${b.id}">
        <div class="side-item-top">
          <span class="side-item-name">${esc(b.name)}</span>
          ${g > 0 ? `<span class="gap-badge">${g}</span>` : '<span class="ok-dot"></span>'}
        </div>
        <div class="side-item-sub">${esc(sub)}</div>
      </div>`;
  }
  html += `
    <div class="side-heading" style="margin-top:20px"><span>Title companies</span>${newBtn('new-titleco')}</div>`;
  for (const x of tcs) {
    const active = state.sel && state.sel.type === 't' && state.sel.id === x.id;
    const miss = (t(x.agent_name) ? 0 : 1) + (t(x.asst_name) ? 0 : 1);
    html += `
      <div class="side-item${active ? ' active' : ''}" data-action="select" data-type="t" data-id="${x.id}">
        <div class="side-item-top">
          <span class="side-item-name tc">${esc(x.name)}</span>
          ${miss > 0 ? `<span class="gap-badge">${miss}</span>` : '<span class="ok-dot"></span>'}
        </div>
        <div class="side-item-sub">${esc(t(x.agent_name) ? x.agent_name : 'Escrow agent needed')}</div>
      </div>`;
  }
  if (q && !builders.length && !tcs.length) html += '<div class="no-match">No matches.</div>';
  $('#sidebar-lists').innerHTML = html;
}

function escrowBlockHtml(title, name, phone, email) {
  return `
    <div class="esc-block">
      <div class="card-label">${esc(title)}</div>
      ${t(name) ? `<div class="who">${esc(name)}</div>` : '<div class="needed">Still needed</div>'}
      <div class="lines">
        ${t(phone) ? `<a href="${telHref(phone)}">${esc(phone)}</a>` : ''}
        ${t(email) ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}
      </div>
    </div>`;
}

function escrowSectionHtml(tc) {
  const cells = [
    ['Team / group email', tc.team_email, tc.team_email ? `mailto:${tc.team_email}` : null],
    ['Office phone', tc.office_phone, tc.office_phone ? telHref(tc.office_phone) : null],
    ['Office address', tc.office_address, null],
  ];
  return `
    <div class="esc-grid">
      ${escrowBlockHtml('Escrow agent', tc.agent_name, tc.agent_phone, tc.agent_email)}
      ${escrowBlockHtml('Escrow assistant', tc.asst_name, tc.asst_phone, tc.asst_email)}
    </div>
    <div class="info-grid">
      ${cells.map(([label, val, href]) => `
        <div class="info-cell">
          <div class="card-label">${esc(label)}</div>
          ${t(val)
            ? (href ? `<a href="${esc(href)}">${esc(val)}</a>` : `<div class="val">${esc(val)}</div>`)
            : '<div class="val">—</div>'}
        </div>`).join('')}
    </div>
    ${t(tc.notes) ? `<div class="esc-note"><strong>Note</strong> · ${esc(tc.notes)}</div>` : ''}`;
}

function renderMain() {
  const main = $('#main');
  const sel = state.sel;
  if (!sel) {
    main.innerHTML = `
      <div class="center-empty"><div style="text-align:center">
        <div style="font-size:15px;font-weight:600;color:var(--text-mid)">Nothing selected</div>
        <div style="font-size:13.5px;color:oklch(0.55 0.02 235);margin-top:6px">Pick a builder on the left${canWrite() ? ', or create one' : ''}.</div>
        ${canWrite() ? '<button class="btn-solid" style="margin-top:16px" data-action="new-builder">+ New builder</button>' : ''}
      </div></div>`;
    return;
  }
  if (sel.type === 't') { renderTitleCo(main, tcById(sel.id)); return; }
  renderBuilder(main, state.builders.find(b => b.id === sel.id));
}

function renderBuilder(main, b) {
  if (!b) { state.sel = null; renderMain(); return; }
  const tc = tcById(b.title_company_id);
  const gaps = gapsFor(b);
  const people = contactsOf(b.id);
  const dbx = t(b.dropbox);
  const dbxIsUrl = /^https?:\/\//i.test(dbx);

  const peopleCards = people.map(p => {
    const asst = [p.asst_name, p.asst_phone, p.asst_email].map(t).filter(Boolean).join(' · ');
    return `
      <div class="card person-card">
        <div class="person-top">
          <span class="role-pill">${esc(p.role || 'Contact')}</span>
          ${canWrite() ? `<button class="edit-link" data-action="edit-contact" data-id="${p.id}">Edit</button>` : ''}
        </div>
        <div class="person-name">${esc(p.name)}</div>
        <div class="person-contact">
          ${t(p.phone) ? `<a href="${telHref(p.phone)}">${esc(p.phone)}</a>` : ''}
          ${t(p.email) ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}
        </div>
        ${t(p.handles) ? `<div class="person-handles">${esc(p.handles)}</div>` : ''}
        ${asst ? `<div class="person-asst">Assistant · ${esc(asst)}</div>` : ''}
        ${t(p.notes) ? `<div class="person-asst">Note · ${esc(p.notes)}</div>` : ''}
      </div>`;
  }).join('');

  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div style="min-width:0">
        <div class="kicker">Builder profile</div>
        <h1>${esc(b.name)}</h1>
      </div>
      <div class="page-head-actions">
        ${dbx ? (dbxIsUrl
          ? `<a class="btn-ghost mono" href="${esc(dbx)}" target="_blank" rel="noopener">Dropbox folder ↗</a>`
          : `<span class="dropbox-path" title="Dropbox location">${esc(dbx)}</span>`) : ''}
        ${canWrite() ? `<button class="btn-ghost" data-action="edit-builder" data-id="${b.id}">Edit builder</button>` : ''}
      </div>
    </div>

    ${gaps.length ? `
      <div class="gap-row">
        <span class="gap-row-label">To fill in</span>
        ${gaps.map((g, i) => canWrite()
          ? `<button class="gap-chip" data-action="gap" data-idx="${i}">${esc(g.label)}</button>`
          : `<span class="gap-chip static">${esc(g.label)}</span>`).join('')}
      </div>` : `
      <div class="complete-row"><span class="ok-dot"></span>Profile complete, nothing missing</div>`}

    ${t(b.comm_rules) ? `
      <div class="cc-banner"><div class="tag">CC rules</div>
        <div class="body">${esc(b.comm_rules)}</div></div>` : ''}

    <div class="card-grid">
      <div class="card">
        <div class="card-label">Concessions</div>
        <div class="card-big">${esc(t(b.concession) || '—')}</div>
        ${t(b.calc_from) ? `<div class="card-note">calculated from ${esc(b.calc_from)}</div>` : ''}
        <div class="card-divider"></div>
        <div class="card-label">Allowed uses &amp; details</div>
        <div class="card-text">${esc(t(b.allowed_uses) || 'Not entered yet.')}</div>
      </div>
      <div class="card">
        <div class="card-label">Special process &amp; incentives</div>
        <div class="card-text">${esc(t(b.special_process) || 'Not entered yet.')}</div>
        <div class="card-divider"></div>
        <div class="card-label">General notes</div>
        <div class="card-text">${esc(t(b.notes) || '—')}</div>
      </div>
    </div>

    <div class="section-head">
      <div style="display:flex;align-items:baseline">
        <h2>People</h2>
        <span class="count">${people.length} ${people.length === 1 ? 'person' : 'people'}</span>
      </div>
      ${canWrite() ? `<button class="btn-solid" data-action="new-contact" data-builder="${b.id}">+ Add person</button>` : ''}
    </div>
    ${people.length
      ? `<div class="people-grid">${peopleCards}</div>`
      : '<div class="empty-box">No people entered for this builder yet.</div>'}

    <div class="section-head">
      <h2>Title &amp; escrow</h2>
      ${tc && canWrite() ? `<button class="btn-ghost" data-action="edit-titleco" data-id="${tc.id}">Edit company</button>` : ''}
    </div>
    ${tc ? `
      <div class="card">
        <div class="card-label">Title company</div>
        <div style="font-size:17px;font-weight:800;margin-top:6px;letter-spacing:-0.01em">${esc(tc.name)}</div>
        ${escrowSectionHtml(tc)}
      </div>` : `
      <div class="empty-box">No title company linked yet.${canWrite()
        ? ` <button class="linkish" style="font-size:13.5px;font-weight:700" data-action="edit-builder" data-id="${b.id}">Link one</button>`
        : ''}
      </div>`}
  </div>`;
}

function renderTitleCo(main, tc) {
  if (!tc) { state.sel = null; renderMain(); return; }
  const used = state.builders.filter(b => b.title_company_id === tc.id);
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div style="min-width:0">
        <div class="kicker">Title company</div>
        <h1>${esc(tc.name)}</h1>
      </div>
      <div class="page-head-actions">
        ${canWrite() ? `<button class="btn-ghost" data-action="edit-titleco" data-id="${tc.id}">Edit company</button>` : ''}
      </div>
    </div>
    <div class="usedby-row">
      <span class="kicker" style="font-size:10.5px">Used by</span>
      ${used.length
        ? used.map(b => `<button class="usedby-chip" data-action="select" data-type="b" data-id="${b.id}">${esc(b.name)}</button>`).join('')
        : '<span style="font-size:13px;color:oklch(0.55 0.02 235)">no builders linked yet</span>'}
    </div>
    <div class="card" style="margin-top:22px">${escrowSectionHtml(tc)}</div>
  </div>`;
}

// ------------------------------------------------------------------ modals
let currentGaps = [];

function closeModal() { $('#modal-root').innerHTML = ''; }

function modalShell(title, inner, opts = {}) {
  $('#modal-root').innerHTML = `
    <div class="modal-overlay" data-action="close-modal">
      <div class="modal${opts.narrow ? ' narrow' : ''}" data-stop="1">
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button class="modal-close" data-action="close-modal">✕</button>
        </div>
        ${inner}
      </div>
    </div>`;
}

function field(label, name, value, opts = {}) {
  const attrs = `data-f="${name}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''}`;
  if (opts.textarea) {
    return `<label class="form-field"><span class="form-label">${esc(label)}</span>
      <textarea ${attrs} rows="${opts.rows || 3}">${esc(value || '')}</textarea></label>`;
  }
  return `<label class="form-field"><span class="form-label">${esc(label)}</span>
    <input ${attrs} value="${esc(value || '')}"></label>`;
}

function actionsHtml(deleteLabel, saveAction) {
  return `
    <div class="modal-actions">
      ${deleteLabel ? `<button class="btn-danger-link" data-action="modal-delete">${esc(deleteLabel)}</button>` : ''}
      <div class="spacer"></div>
      <button class="btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn-solid" data-action="${saveAction}">Save</button>
    </div>`;
}

function openBuilderModal(id) {
  const b = id ? state.builders.find(x => x.id === id) : null;
  const opts = state.titleCompanies.map(x =>
    `<option value="${x.id}" ${b && b.title_company_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  modalShell(b ? 'Edit builder' : 'New builder', `
    <div data-form="builder" data-id="${id || ''}">
      ${field('Builder name', 'name', b && b.name, { ph: 'e.g. Cullers Homes' })}
      <label class="form-field"><span class="form-label">Title company</span>
        <select data-f="title_company_id">
          <option value="">— No title company yet —</option>${opts}
        </select></label>
      ${field('Dropbox link or folder path', 'dropbox', b && b.dropbox, { ph: 'https://... or DB > TRL Team > Builder > ...' })}
      <div class="form-grid-2">
        ${field('Concession amount / %', 'concession', b && b.concession, { ph: 'e.g. Up to 3%' })}
        ${field('Calculated from', 'calc_from', b && b.calc_from, { ph: 'e.g. Loan Amount' })}
      </div>
      ${field('Allowed uses & concession details', 'allowed_uses', b && b.allowed_uses, { textarea: true })}
      ${field('Special process & incentives', 'special_process', b && b.special_process, { textarea: true })}
      ${field('Communication rules (who to CC, etc.)', 'comm_rules', b && b.comm_rules, { textarea: true, rows: 2 })}
      ${field('General notes', 'notes', b && b.notes, { textarea: true, rows: 2 })}
      ${actionsHtml(b ? 'Delete builder' : null, 'save-builder')}
    </div>`);
}

function openContactModal(id, preset = {}) {
  const c = id ? state.contacts.find(x => x.id === id) : null;
  const builderId = c ? c.builder_id : preset.builderId || (state.builders[0] && state.builders[0].id) || '';
  const role = c ? c.role : preset.role || '';
  const bOpts = state.builders.map(b =>
    `<option value="${b.id}" ${b.id === builderId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  const rOpts = state.roles.map(r =>
    `<option value="${esc(r.name)}" ${r.name === role ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  modalShell(c ? 'Edit person' : 'Add person', `
    <div data-form="contact" data-id="${id || ''}">
      <div class="form-grid-2">
        <label class="form-field"><span class="form-label">Builder</span>
          <select data-f="builder_id">${bOpts}</select></label>
        <label class="form-field"><span class="form-label">Role</span>
          <select data-f="role"><option value="">Choose role...</option>${rOpts}</select>
          ${isAdmin() ? '<span class="roles-note"><button class="linkish" style="font-size:12px" data-action="roles">Edit the role list</button></span>' : ''}
        </label>
      </div>
      ${field('Name', 'name', c && c.name, { ph: 'Full name' })}
      <div class="form-grid-2">
        ${field('Phone', 'phone', c && c.phone, { ph: '915-...' })}
        ${field('Email', 'email', c && c.email, { ph: 'name@...' })}
      </div>
      ${field('What they handle / when to contact', 'handles', c && c.handles,
        { textarea: true, ph: 'e.g. POC for builder docs AND appraisals - always CC Yolanda' })}
      <div class="form-grid-3">
        ${field('Assistant name', 'asst_name', c && c.asst_name)}
        ${field('Asst. phone', 'asst_phone', c && c.asst_phone)}
        ${field('Asst. email', 'asst_email', c && c.asst_email)}
      </div>
      ${field('Notes', 'notes', c && c.notes, { textarea: true, rows: 2 })}
      ${actionsHtml(c ? 'Remove person' : null, 'save-contact')}
    </div>`);
}

function openTitleCoModal(id) {
  const x = id ? state.titleCompanies.find(v => v.id === id) : null;
  modalShell(x ? 'Edit title company' : 'New title company', `
    <div data-form="titleco" data-id="${id || ''}">
      ${field('Company name', 'name', x && x.name, { ph: 'e.g. Stewart Title - Mary Cherry' })}
      <div class="form-grid-3">
        ${field('Escrow agent', 'agent_name', x && x.agent_name, { ph: 'Name' })}
        ${field('Phone', 'agent_phone', x && x.agent_phone)}
        ${field('Email', 'agent_email', x && x.agent_email)}
      </div>
      <div class="form-grid-3">
        ${field('Escrow assistant', 'asst_name', x && x.asst_name, { ph: 'Name' })}
        ${field('Phone', 'asst_phone', x && x.asst_phone)}
        ${field('Email', 'asst_email', x && x.asst_email)}
      </div>
      <div class="form-grid-2">
        ${field('Team / group email', 'team_email', x && x.team_email)}
        ${field('Office phone', 'office_phone', x && x.office_phone)}
      </div>
      ${field('Office address', 'office_address', x && x.office_address)}
      ${field('Notes', 'notes', x && x.notes, { textarea: true, rows: 2 })}
      ${actionsHtml(x ? 'Delete company' : null, 'save-titleco')}
    </div>`);
}

function openHelpModal() {
  const steps = [
    ['Pick a builder', 'Everything on the page belongs to the builder selected on the left. Search finds builders, people, and title companies.'],
    ['Edit anything', 'Every card has an Edit button; "+ Add person" adds a contact. Changes save to the cloud instantly, so the whole team always sees the latest version.'],
    ['Amber chips are the gap report', "They list exactly what's still blank for a builder. Click a chip to jump straight to the right form; chips disappear as info gets filled in."],
    ['Title companies are shared', "Link a builder to a title company and its escrow team appears on the builder's page. Update the company once and every builder linked to it stays current."],
    ['Working a file?', 'Read the CC rules and Concessions before structuring or emailing. The people cards say exactly who handles builder docs, appraisals, and seller-signed items.'],
    ['Export to Excel', 'The Export button downloads the whole database as the team’s standard Excel workbook, dashboard and gap report included, in case you ever want a spreadsheet copy or an offline backup.'],
  ];
  modalShell('How this works', `
    <div class="help-body">
      ${steps.map(([title, d], i) => `
        <div class="help-step">
          <span class="help-num">0${i + 1}</span>
          <div><div class="t">${esc(title)}</div><div class="d">${esc(d)}</div></div>
        </div>`).join('')}
    </div>`);
}

function openTeamModal() {
  const me = state.session ? ci(state.session.user.email) : '';
  const levels = ['read', 'write', 'admin'];
  const accessSelect = (email, current) => `
    <select class="access-select" data-team-access data-email="${esc(email)}">
      ${levels.map(a => `<option value="${a}" ${a === current ? 'selected' : ''}>${a}</option>`).join('')}
    </select>`;
  modalShell('Team access', `
    <div data-form="team">
      <div class="team-hint">Everyone on this list can sign in and see the database.
        <strong>Read</strong> is view only. <strong>Write</strong> can edit builders, people,
        and title companies. <strong>Admin</strong> can also manage this list and the role list.
        To add a teammate: add their email, pick a level, then have them create an account with
        that exact email.</div>
      <div class="team-list">
        ${state.team.map(r => `
          <div class="team-row">
            <span class="email">${esc(r.email)}${ci(r.email) === me ? ' <span style="color:var(--text-muted)">(you)</span>' : ''}</span>
            <span class="team-controls">
              ${accessSelect(r.email, r.access)}
              <button class="edit-link" data-action="team-remove" data-email="${esc(r.email)}">Remove</button>
            </span>
          </div>`).join('')}
      </div>
      <div class="team-add">
        <input type="email" data-f="new_email" placeholder="teammate@company.com">
        <select class="access-select" data-f="new_access">
          ${levels.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
        <button class="btn-solid" data-action="team-add">Add</button>
      </div>
    </div>`, { narrow: true });
}

function openRolesModal() {
  modalShell('Roles', `
    <div data-form="roles">
      <div class="roles-note">These feed the Role dropdown on people. Renaming or removing a role
        does not change people already saved with it. The Excel export includes the first 9 roles.</div>
      <div class="team-list">
        ${state.roles.map((r, i) => `
          <div class="team-row">
            <span class="email">${esc(r.name)}</span>
            <span>
              <button class="edit-link" data-action="role-up" data-id="${r.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="edit-link" data-action="role-down" data-id="${r.id}" ${i === state.roles.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="edit-link" data-action="role-remove" data-id="${r.id}">Remove</button>
            </span>
          </div>`).join('')}
      </div>
      <div class="team-add">
        <input data-f="new_role" placeholder="New role name">
        <button class="btn-solid" data-action="role-add">Add</button>
      </div>
    </div>`, { narrow: true });
}

// ------------------------------------------------------------------ saves
function readForm(formEl) {
  const out = {};
  formEl.querySelectorAll('[data-f]').forEach(el => { out[el.dataset.f] = t(el.value); });
  return out;
}

async function saveRecord(table, id, values, label) {
  const query = id
    ? db.from(table).update(values).eq('id', id).select().single()
    : db.from(table).insert(values).select().single();
  const { data, error } = await query;
  if (error) { toast(friendlyError(error), true); return null; }
  toast(label + ' saved');
  return data;
}

async function handleSave(kind) {
  const formEl = $('#modal-root [data-form]');
  const id = formEl.dataset.id || null;
  const v = readForm(formEl);
  if (!v.name) { toast('Name is required.', true); return; }

  if (kind === 'builder') {
    v.title_company_id = v.title_company_id || null;
    const rec = await saveRecord('builders', id, v, 'Builder');
    if (!rec) return;
    closeModal();
    if (!id) state.sel = { type: 'b', id: rec.id };
    await refresh();
  }
  if (kind === 'contact') {
    if (!v.role) v.role = 'Other';
    if (!v.builder_id) { toast('Pick a builder.', true); return; }
    if (!(await saveRecord('contacts', id, v, 'Person'))) return;
    closeModal();
    await refresh();
  }
  if (kind === 'titleco') {
    if (!(await saveRecord('title_companies', id, v, 'Title company'))) return;
    closeModal();
    await refresh();
  }
}

async function handleModalDelete(btn) {
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Really delete? This cannot be undone. Click again to confirm.';
    return;
  }
  const formEl = $('#modal-root [data-form]');
  const kind = formEl.dataset.form;
  const id = formEl.dataset.id;
  const table = { builder: 'builders', contact: 'contacts', titleco: 'title_companies' }[kind];
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { toast(friendlyError(error), true); return; }
  toast('Deleted');
  closeModal();
  await refresh();
}

// ------------------------------------------------------------------ export
async function getSheetPaths(zip) {
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const wbDoc = parse(await zip.file('xl/workbook.xml').async('string'));
  const relDoc = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
  const rels = {};
  for (const r of relDoc.getElementsByTagName('Relationship')) {
    rels[r.getAttribute('Id')] = r.getAttribute('Target');
  }
  const paths = {};
  for (const s of wbDoc.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid];
    if (target.startsWith('/')) target = target.slice(1); else target = 'xl/' + target;
    paths[s.getAttribute('name')] = target;
  }
  return paths;
}

const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const colToNum = (col) => col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function setSheetCells(doc, cells) {
  const sheetData = doc.getElementsByTagNameNS(SS_NS, 'sheetData')[0];
  const rows = {};
  for (const r of Array.from(sheetData.getElementsByTagNameNS(SS_NS, 'row'))) {
    rows[r.getAttribute('r')] = r;
  }
  for (const [ref, value] of Object.entries(cells)) {
    if (value === '' || value == null) continue;
    const m = ref.match(/^([A-Z]+)([0-9]+)$/);
    const colN = colToNum(m[1]);
    let row = rows[m[2]];
    if (!row) {
      row = doc.createElementNS(SS_NS, 'row');
      row.setAttribute('r', m[2]);
      let after = null;
      for (const r of Array.from(sheetData.getElementsByTagNameNS(SS_NS, 'row'))) {
        if (Number(r.getAttribute('r')) > Number(m[2])) { after = r; break; }
      }
      sheetData.insertBefore(row, after);
      rows[m[2]] = row;
    }
    let cell = null, before = null;
    for (const c of Array.from(row.getElementsByTagNameNS(SS_NS, 'c'))) {
      const cRef = c.getAttribute('r');
      if (cRef === ref) { cell = c; break; }
      if (!before && colToNum(cRef.match(/^[A-Z]+/)[0]) > colN) before = c;
    }
    if (!cell) {
      cell = doc.createElementNS(SS_NS, 'c');
      cell.setAttribute('r', ref);
      row.insertBefore(cell, before);
    }
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
  toast('Building the Excel workbook...');
  try {
    const resp = await fetch('template_v5.xlsx');
    if (!resp.ok) throw new Error('Could not load the Excel template.');
    const zip = await JSZip.loadAsync(await resp.arrayBuffer());
    const paths = await getSheetPaths(zip);

    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const tcs = [...state.titleCompanies].sort(byName);
    const builders = [...state.builders].sort(byName);
    const tcName = (id) => { const x = tcById(id); return x ? x.name : ''; };

    const CAP = { builders: 200, contacts: 500, tcs: 100, roles: 9 };
    const clipped = [];
    if (builders.length > CAP.builders) clipped.push(`builders (first ${CAP.builders} of ${builders.length})`);
    if (state.contacts.length > CAP.contacts) clipped.push(`contacts (first ${CAP.contacts} of ${state.contacts.length})`);
    if (tcs.length > CAP.tcs) clipped.push(`title companies (first ${CAP.tcs} of ${tcs.length})`);
    if (state.roles.length > CAP.roles) clipped.push(`roles (first ${CAP.roles} of ${state.roles.length})`);

    const sheets = {
      'Builders': {}, 'Contacts': {}, 'Title Companies': {}, 'Lists': {}, 'Dashboard': {},
    };
    const bCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    builders.slice(0, CAP.builders).forEach((b, i) => {
      const vals = [b.name, tcName(b.title_company_id), b.dropbox, b.concession, b.calc_from,
        b.allowed_uses, b.special_process, b.comm_rules, b.notes];
      vals.forEach((v, j) => { sheets['Builders'][bCols[j] + (i + 2)] = v; });
    });
    const cCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    let cRow = 2;
    for (const b of builders) {
      for (const p of contactsOf(b.id)) {
        if (cRow > CAP.contacts + 1) break;
        const vals = [b.name, p.role, p.name, p.phone, p.email, p.handles,
          p.asst_name, p.asst_phone, p.asst_email, p.notes];
        vals.forEach((v, j) => { sheets['Contacts'][cCols[j] + cRow] = v; });
        cRow++;
      }
    }
    const tCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    tcs.slice(0, CAP.tcs).forEach((x, i) => {
      const vals = [x.name, x.agent_name, x.agent_phone, x.agent_email, x.asst_name,
        x.asst_phone, x.asst_email, x.team_email, x.office_phone, x.office_address, x.notes];
      vals.forEach((v, j) => { sheets['Title Companies'][tCols[j] + (i + 2)] = v; });
    });
    state.roles.slice(0, CAP.roles).forEach((r, i) => { sheets['Lists']['A' + (i + 2)] = r.name; });
    if (builders.length) sheets['Dashboard']['B4'] = builders[0].name;

    for (const [name, cells] of Object.entries(sheets)) {
      const path = paths[name];
      const doc = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
      setSheetCells(doc, cells);
      let xml = new XMLSerializer().serializeToString(doc);
      if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
      zip.file(path, xml);
    }

    const blob = await zip.generateAsync({
      type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Builder_Database_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(clipped.length ? 'Exported, but clipped: ' + clipped.join('; ') : 'Excel workbook downloaded');
  } catch (err) {
    toast('Export failed: ' + err.message, true);
  }
}

// ------------------------------------------------------------------ team & roles actions
async function teamAdd() {
  const email = ci(t($('#modal-root [data-f="new_email"]').value));
  const access = $('#modal-root [data-f="new_access"]').value;
  if (!email || !email.includes('@')) { toast('Enter an email address.', true); return; }
  const { error } = await db.from('allowed_users').insert({ email, access });
  if (error) { toast(friendlyError(error), true); return; }
  state.team.push({ email, access });
  state.team.sort((a, b) => a.email.localeCompare(b.email));
  openTeamModal();
}

async function teamRemove(email, btn) {
  const me = state.session ? ci(state.session.user.email) : '';
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = ci(email) === me ? 'This locks YOU out. Click again.' : 'Click again to confirm';
    return;
  }
  const { data, error } = await db.from('allowed_users').delete().eq('email', email).select();
  if (error) { toast(friendlyError(error), true); openTeamModal(); return; }
  if (!data.length) { toast('Not allowed.', true); openTeamModal(); return; }
  state.team = state.team.filter(r => r.email !== email);
  if (ci(email) === me) { state.allowed = false; state.myAccess = null; closeModal(); renderAuth(); return; }
  openTeamModal();
}

async function teamSetAccess(sel) {
  const email = sel.dataset.email;
  const { data, error } = await db.from('allowed_users')
    .update({ access: sel.value }).eq('email', email).select();
  if (error || !data.length) {
    toast(error ? friendlyError(error) : 'Not allowed.', true);
    openTeamModal();
    return;
  }
  const row = state.team.find(r => r.email === email);
  if (row) row.access = sel.value;
  toast('Access updated');
  if (state.session && ci(email) === ci(state.session.user.email)) {
    state.myAccess = sel.value;
    if (!isAdmin()) closeModal();
    render();
  }
}

async function roleAdd() {
  const input = $('#modal-root [data-f="new_role"]');
  const name = t(input.value);
  if (!name) return;
  const { error } = await db.from('roles')
    .insert({ name, position: state.roles.length });
  if (error) { toast(friendlyError(error), true); return; }
  await loadAll();
  openRolesModal();
}

async function roleRemove(id, btn) {
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Sure?'; return; }
  const { error } = await db.from('roles').delete().eq('id', id);
  if (error) { toast(friendlyError(error), true); return; }
  await loadAll();
  openRolesModal();
}

async function roleMove(id, dir) {
  const i = state.roles.findIndex(r => r.id === id);
  const j = i + dir;
  if (j < 0 || j >= state.roles.length) return;
  const a = state.roles[i], b = state.roles[j];
  const r1 = await db.from('roles').update({ position: j }).eq('id', a.id);
  const r2 = await db.from('roles').update({ position: i }).eq('id', b.id);
  if (r1.error || r2.error) { toast(friendlyError(r1.error || r2.error), true); return; }
  await loadAll();
  openRolesModal();
}

// ------------------------------------------------------------------ events
document.addEventListener('click', async (e) => {
  const authBtn = e.target.closest('[data-auth]');
  if (authBtn) { handleAuth(authBtn.dataset.auth); return; }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;

  if (a === 'close-modal') {
    if (e.target.closest('[data-stop]') && !e.target.closest('.modal-close')
        && !e.target.closest('.btn-ghost')) return;
    closeModal(); return;
  }
  if (e.target.closest('.modal-overlay') && !e.target.closest('[data-stop]')) { closeModal(); return; }

  if (a === 'select') { state.sel = { type: el.dataset.type, id: el.dataset.id }; render(); }
  if (a === 'new-builder') openBuilderModal(null);
  if (a === 'new-titleco') openTitleCoModal(null);
  if (a === 'new-contact') openContactModal(null, { builderId: el.dataset.builder });
  if (a === 'edit-builder') openBuilderModal(el.dataset.id);
  if (a === 'edit-contact') openContactModal(el.dataset.id);
  if (a === 'edit-titleco') openTitleCoModal(el.dataset.id);
  if (a === 'gap') {
    const b = state.sel && state.builders.find(x => x.id === state.sel.id);
    if (!b) return;
    const g = gapsFor(b)[Number(el.dataset.idx)];
    if (!g) return;
    if (g.go.kind === 'builder') openBuilderModal(g.go.id);
    if (g.go.kind === 'contact') openContactModal(null, { builderId: g.go.builderId, role: g.go.role });
    if (g.go.kind === 'titleco') openTitleCoModal(g.go.id);
  }
  if (a === 'save-builder') handleSave('builder');
  if (a === 'save-contact') handleSave('contact');
  if (a === 'save-titleco') handleSave('titleco');
  if (a === 'modal-delete') handleModalDelete(el);
  if (a === 'help') openHelpModal();
  if (a === 'team') openTeamModal();
  if (a === 'roles') openRolesModal();
  if (a === 'export') exportExcel();
  if (a === 'signout') db.auth.signOut();
  if (a === 'team-add') teamAdd();
  if (a === 'team-remove') teamRemove(el.dataset.email, el);
  if (a === 'role-add') roleAdd();
  if (a === 'role-remove') roleRemove(el.dataset.id, el);
  if (a === 'role-up') roleMove(el.dataset.id, -1);
  if (a === 'role-down') roleMove(el.dataset.id, 1);
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-team-access]');
  if (sel) teamSetAccess(sel);
});

$('#search').addEventListener('input', (e) => {
  state.q = e.target.value;
  renderSidebar();
});

window.addEventListener('focus', () => {
  if (state.session && state.allowed) refresh();
});

boot();
