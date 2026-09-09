/* TRL Contacts. Plain JavaScript, no build step.
   This file: constants, state, helpers, sign in, data loading, routing, search, events.
   views.js renders the screen, forms.js edits records, export.js builds the Excel file.
   All four share one global scope, so every function name lives in exactly one file. */

'use strict';

// Bump on every deploy, and update the ?v= numbers in index.html to match.
const APP_VERSION = '11';

const SUPABASE_URL = 'https://rqmuaeuqiqkhsnmashab.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Vrs-KYaeRnKCXlhAvq_w1w_8JqcBtJq';

const PHONE_LABELS = ['Mobile', 'Office', 'Direct', 'Fax', 'Other'];
const EMAIL_LABELS = ['Work', 'Personal', 'Other'];
// Suggestions for roles at a title company. Free text is allowed too.
// Keep in step with TITLE_ROLES in build_v5.py.
const TITLE_ROLE_SUGGESTIONS = ['Escrow Agent', 'Escrow Assistant', 'Closer', 'Title Officer', 'Processor', 'Post Closer'];

// Demo mode: `?demo=1` on localhost renders made-up data without signing in.
// Used to check layouts; it never touches the real database.
const DEMO = /[?&]demo=1/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

// ------------------------------------------------------------------ state
const state = {
  session: null,
  allowed: null,            // null = unknown, true/false after the team check
  myAccess: null,           // 'read' | 'write' | 'admin'
  authView: 'signin',
  authMsg: null,
  people: [], affiliations: [], builders: [], titleCompanies: [], roles: [], team: [],
  ix: null,                 // indexes built by reindex()
  route: { section: 'builders', id: null, sub: null, subId: null },
  q: '',                    // list search text
  searchCursor: -1,
  filters: { role: '', where: '' },
  form: null,               // {kind, id, preset, linkPersonId, force, busy} while editing
  panel: null,              // 'team' | 'roles' | 'help' | null
  inspOpen: false,          // mid/phone layouts: is the inspector drawer showing
  expanded: {},             // "id:field" -> true after "Show more"
  menu: null,               // 'account' | 'row:<id>' | 'more' | null
  recent: [],
  scroll: {},
};

const canWrite = () => state.myAccess === 'write' || state.myAccess === 'admin';
const isAdmin = () => state.myAccess === 'admin';

// ------------------------------------------------------------------ small helpers
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const t = (s) => (s == null ? '' : String(s)).trim();
const ci = (s) => t(s).toLowerCase();
const digitsOf = (s) => t(s).replace(/\D/g, '');
const byName = (a, b) => ci(a.name).localeCompare(ci(b.name));
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/* Phone numbers display as 915-555-0100, with an extension as " x123". Anything that
   is not a plain US number is shown as typed. */
/* "915-555-0100 x123", "915-555-0100 ext. 123" and "915-555-0100 extension 123" all split into the number and "123". */
function splitExt(raw) {
  const s = t(raw);
  const m = s.match(/^(.*?)(?:\s*(?:ext\.?|x|extension)\s*(\d+))?$/i);
  return { number: m ? t(m[1]) : s, ext: m && m[2] ? m[2] : '' };
}
function fmtPhone(raw) {
  const s = t(raw);
  if (!s) return '';
  const { number, ext } = splitExt(s);
  let d = digitsOf(number);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return s;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}${ext ? ' x' + ext : ''}`;
}
function telHref(raw) {
  const { number, ext } = splitExt(raw);
  let d = digitsOf(number);
  if (d.length === 10) d = '1' + d;
  const intl = d.length === 11 && d[0] === '1';       // only a full North American number gets the +1 prefix
  return 'tel:' + (intl ? '+' : '') + d + (ext ? ';ext=' + ext : '');
}
function fmtAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${plural(h, 'hour')} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString();
}
const who = (email) => (email ? String(email).split('@')[0] : '');

let toastTimer = null;
function toast(text, isErr) {
  const el = $('#toast');
  el.textContent = text;
  el.className = isErr ? 'err' : '';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 6000 : 3000);
}
function announce(text) {
  const el = $('#live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}
function friendlyError(error) {
  const m = (error && error.message) || 'Something went wrong.';
  if (/affiliations_person_(builder|title)_key/.test(m)) return 'Already linked there.';
  if (/duplicate key|unique/i.test(m)) return 'That name is already in use.';
  if (/row-level security/i.test(m)) return 'Your access does not allow that change.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the database. Check your connection.';
  return m;
}
async function copyText(value, btn) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (e) {
    toast('Could not copy. Select the text and press Cmd+C.', true);
    return;
  }
  announce('Copied ' + value);
  if (btn) {
    btn.classList.add('done');
    btn.innerHTML = icon('check') + '<span class="tip">Copied</span>';
    setTimeout(() => {
      btn.classList.remove('done');
      btn.innerHTML = icon('copy');
    }, 1500);
  }
}

// One small stroke icon set, 16px grid.
const ICONS = {
  search: '<circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5 14 14"></path>',
  plus: '<path d="M8 3v10M3 8h10"></path>',
  x: '<path d="M4 4l8 8M12 4l-8 8"></path>',
  back: '<path d="M10 3 5 8l5 5"></path>',
  down: '<path d="M4 6l4 4 4-4"></path>',
  check: '<path d="M3 8.5l3.2 3L13 4.5"></path>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"></rect><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"></path>',
  external: '<path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9"></path>',
  mail: '<rect x="2" y="3.5" width="12" height="9" rx="1.2"></rect><path d="m2.5 4.5 5.5 4 5.5-4"></path>',
  phone: '<path d="M3 2.5h2.4l1.6 4-2 1.2a6.5 6.5 0 0 0 3.3 3.3l1.2-2 4 1.6v2.4a1 1 0 0 1-1 1A10.5 10.5 0 0 1 2 3.5a1 1 0 0 1 1-1z"></path>',
  more: '<circle cx="3.5" cy="8" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="12.5" cy="8" r="1.3" fill="currentColor" stroke="none"></circle>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"></path>',
  pencil: '<path d="M11.5 2.5 13.5 4.5 5.5 12.5 2.5 13.5 3.5 10.5z"></path><path d="M10 4l2 2"></path>',
  info: '<circle cx="8" cy="8" r="6.25"></circle><path d="M8 7.5v3.5M8 5.2v.1"></path>',
  builders: '<path d="M2.5 13.5V6.5l5.5-4 5.5 4v7"></path><path d="M6.5 13.5v-4h3v4"></path><path d="M2.5 13.5h11"></path>',
  people: '<circle cx="8" cy="5.5" r="2.8"></circle><path d="M2.8 13.5c0-2.6 2.3-4.4 5.2-4.4s5.2 1.8 5.2 4.4"></path>',
  title: '<path d="M3 6.5h10M3 6.5l5-3.3 5 3.3M4 6.5v5.5M7 6.5v5.5M9 6.5v5.5M12 6.5v5.5M2.5 12h11v1.5h-11z"></path>',
};
function icon(name, size) {
  const s = size || 16;
  return `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ------------------------------------------------------------------ database access
/* Everything the app asks of the database goes through `api`, so demo mode can swap in
   an in-memory copy without touching the rest of the code. */
const supa = DEMO ? null : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const supabaseApi = {
  async select(table, order) {
    let q = supa.from(table).select(table === 'allowed_users' ? 'email, access' : '*');
    if (order) q = q.order(order);
    return q;
  },
  insert: (table, values) => supa.from(table).insert(values).select().single(),
  update: (table, id, values) => supa.from(table).update(values).eq('id', id).select().single(),
  delete: (table, id) => supa.from(table).delete().eq('id', id),
};

const demoStore = {};
const demoApi = {
  async select(table) { return { data: (demoStore[table] || []).map(r => ({ ...r })), error: null }; },
  async insert(table, values) {
    const row = { id: 'demo-' + Math.random().toString(36).slice(2, 9), created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), updated_by: 'you', ...values };
    (demoStore[table] = demoStore[table] || []).push(row);
    return { data: { ...row }, error: null };
  },
  async update(table, id, values) {
    const row = (demoStore[table] || []).find(r => r.id === id);
    if (!row) return { data: null, error: { message: 'Not found' } };
    Object.assign(row, values, { updated_at: new Date().toISOString(), updated_by: 'you' });
    return { data: { ...row }, error: null };
  },
  async delete(table, id) {
    demoStore[table] = (demoStore[table] || []).filter(r => r.id !== id);
    return { error: null };
  },
};
const api = DEMO ? demoApi : supabaseApi;

// ------------------------------------------------------------------ sign in
async function boot() {
  window.addEventListener('hashchange', onHashChange);
  if (DEMO) {
    seedDemo();
    state.session = { user: { email: 'you@example.com' } };
    state.allowed = true;
    state.myAccess = 'admin';
    await loadAll();
    enterApp();
    return;
  }
  const { data } = await supa.auth.getSession();
  state.session = data.session;
  supa.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') { state.authView = 'recovery'; state.allowed = null; renderAuth(); return; }
    if (event === 'SIGNED_OUT') { state.allowed = null; state.authView = 'signin'; state.authMsg = null; renderAuth(); return; }
    if (event === 'SIGNED_IN' && state.allowed === null) enter();
  });
  if (state.session) enter(); else renderAuth();
}

async function enter() {
  const { data, error } = await api.select('allowed_users', 'email');
  if (error) {
    state.authView = 'signin';
    state.authMsg = { text: 'Could not reach the database: ' + friendlyError(error), err: true };
    renderAuth();
    return;
  }
  applyTeam(data);
  state.allowed = data.length > 0;
  if (!state.allowed) { renderAuth(); return; }
  const ok = await loadAll();
  if (!ok) return;
  enterApp();
}

function enterApp() {
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  state.recent = loadRecent();
  state.route = parseHash();
  ensureRecord();
  remember();
  state.inspOpen = Boolean(state.route.sub);   // a deep link to a person opens the panel on smaller screens too
  render();
}

function applyTeam(rows) {
  state.team = rows;
  const me = state.session ? ci(state.session.user.email) : '';
  const mine = rows.find(r => ci(r.email) === me);
  state.myAccess = mine ? mine.access : null;
}

async function handleAuth(action) {
  const email = $('#auth-email') ? t($('#auth-email').value) : '';
  const pass = $('#auth-pass') ? $('#auth-pass').value : '';
  state.authMsg = null;
  if (action === 'view-signin') { state.authView = 'signin'; return renderAuth(); }
  if (action === 'view-signup') { state.authView = 'signup'; return renderAuth(); }
  if (action === 'view-forgot') { state.authView = 'forgot'; return renderAuth(); }
  if (action === 'signout') { await supa.auth.signOut(); return; }
  if (action === 'retry') { state.allowed = null; return enter(); }
  if (action === 'signin') {
    const { error } = await supa.auth.signInWithPassword({ email, password: pass });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; return renderAuth(); }
    return;
  }
  if (action === 'signup') {
    const { data, error } = await supa.auth.signUp({ email, password: pass });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; return renderAuth(); }
    if (data.session) return;
    state.authView = 'pending';
    return renderAuth();
  }
  if (action === 'forgot') {
    const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    state.authMsg = error ? { text: friendlyError(error), err: true } : { text: 'If that email has an account, a reset link is on its way.' };
    return renderAuth();
  }
  if (action === 'setpass') {
    const { error } = await supa.auth.updateUser({ password: pass });
    if (error) { state.authMsg = { text: friendlyError(error), err: true }; return renderAuth(); }
    state.authView = 'signin';
    state.allowed = null;
    return enter();
  }
}

// ------------------------------------------------------------------ data
async function loadAll() {
  const [p, a, b, tc, r, team] = await Promise.all([
    api.select('people', 'name'),
    api.select('affiliations'),
    api.select('builders', 'name'),
    api.select('title_companies', 'name'),
    api.select('roles', 'position'),
    api.select('allowed_users', 'email'),
  ]);
  const failed = [p, a, b, tc, r, team].find(res => res.error);
  if (failed) {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    renderFatal('Could not load the database: ' + friendlyError(failed.error));
    return false;
  }
  if (!DEMO && team.data.length === 0) {     // access was revoked while signed in
    state.allowed = false;
    state.myAccess = null;
    renderAuth();
    return false;
  }
  if (!DEMO) applyTeam(team.data); else state.team = team.data;
  state.people = p.data;
  state.affiliations = a.data;
  state.builders = b.data;
  state.titleCompanies = tc.data;
  state.roles = r.data;
  state.lastLoad = Date.now();
  reindex();
  return true;
}

/* Builds the lookups every render uses. Call after any change to the arrays above. */
function reindex() {
  const ix = {
    person: new Map(state.people.map(x => [x.id, x])),
    builder: new Map(state.builders.map(x => [x.id, x])),
    tc: new Map(state.titleCompanies.map(x => [x.id, x])),
    affsByPerson: new Map(), affsByBuilder: new Map(), affsByTc: new Map(),
    buildersByTc: new Map(),
    roleRank: new Map(),
  };
  state.roles.forEach((r, i) => ix.roleRank.set(ci(r.name), i));
  TITLE_ROLE_SUGGESTIONS.forEach((r, i) => { if (!ix.roleRank.has(ci(r))) ix.roleRank.set(ci(r), 100 + i); });
  const push = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };
  for (const a of state.affiliations) {
    push(ix.affsByPerson, a.person_id, a);
    if (a.builder_id) push(ix.affsByBuilder, a.builder_id, a);
    if (a.title_company_id) push(ix.affsByTc, a.title_company_id, a);
  }
  for (const b of state.builders) if (b.title_company_id) push(ix.buildersByTc, b.title_company_id, b);
  const personName = (a) => { const p = ix.person.get(a.person_id); return p ? ci(p.name) : ''; };
  const sortAffs = (list) => list.sort((a, b) => rankRole(a.role, ix) - rankRole(b.role, ix) || personName(a).localeCompare(personName(b)));
  for (const m of [ix.affsByPerson, ix.affsByBuilder, ix.affsByTc]) for (const list of m.values()) sortAffs(list);
  for (const list of ix.buildersByTc.values()) list.sort(byName);
  ix.unlinked = state.people.filter(p => !ix.affsByPerson.has(p.id)).sort(byName);
  state.ix = ix;
  buildDocs();
}
function rankRole(role, ix) {
  const r = (ix || state.ix).roleRank.get(ci(role));
  return r === undefined ? 999 : r;
}
const person = (id) => (state.ix && state.ix.person.get(id)) || null;
const builder = (id) => (state.ix && state.ix.builder.get(id)) || null;
const titleCo = (id) => (state.ix && state.ix.tc.get(id)) || null;
const affsOfPerson = (id) => (state.ix && state.ix.affsByPerson.get(id)) || [];
const affsOfBuilder = (id) => (state.ix && state.ix.affsByBuilder.get(id)) || [];
const affsOfTc = (id) => (state.ix && state.ix.affsByTc.get(id)) || [];
const buildersOfTc = (id) => (state.ix && state.ix.buildersByTc.get(id)) || [];
const affById = (id) => state.affiliations.find(a => a.id === id) || null;
function parentOf(a) {
  if (!a) return null;
  if (a.builder_id) { const b = builder(a.builder_id); return b ? { kind: 'b', rec: b, name: b.name } : null; }
  const c = titleCo(a.title_company_id);
  return c ? { kind: 't', rec: c, name: c.name } : null;
}
const parentName = (a) => { const p = parentOf(a); return p ? p.name : ''; };
const list = (arr) => (Array.isArray(arr) ? arr : []);
const primary = (arr) => { const v = list(arr).find(x => t(x && x.value)); return v ? t(v.value) : ''; };
const rest = (arr) => list(arr).slice(1).filter(x => t(x && x.value)).map(x => (t(x.label) ? t(x.label) + ' ' : '') + t(x.value)).join('; ');
const TABLE_OF = { people: 'people', affiliations: 'affiliations', builders: 'builders', title_companies: 'titleCompanies', roles: 'roles' };

function putLocal(table, row) {
  const arr = state[TABLE_OF[table]];
  const i = arr.findIndex(x => x.id === row.id);
  if (i >= 0) arr[i] = row; else arr.push(row);
  if (table !== 'affiliations' && table !== 'roles') arr.sort(byName);
  if (table === 'roles') arr.sort((a, b) => a.position - b.position);
  reindex();
}
function dropLocal(table, id) {
  state[TABLE_OF[table]] = state[TABLE_OF[table]].filter(x => x.id !== id);
  if (table === 'people') state.affiliations = state.affiliations.filter(a => a.person_id !== id);
  if (table === 'builders') state.affiliations = state.affiliations.filter(a => a.builder_id !== id);
  if (table === 'title_companies') {
    state.affiliations = state.affiliations.filter(a => a.title_company_id !== id);
    for (const b of state.builders) if (b.title_company_id === id) b.title_company_id = null;
  }
  reindex();
}
async function saveRow(table, id, values) {
  const { data, error } = id ? await api.update(table, id, values) : await api.insert(table, values);
  if (error) { toast(friendlyError(error), true); return null; }
  putLocal(table, data);
  return data;
}
async function deleteRow(table, id) {
  const { error } = await api.delete(table, id);
  if (error) { toast(friendlyError(error), true); return false; }
  dropLocal(table, id);
  return true;
}
/* Pulls fresh data when the window regains focus, at most every 30 seconds, and never
   while someone is in the middle of a form. */
async function refresh() {
  if (state.form || Date.now() - state.lastLoad < 30000) return;
  if (await loadAll()) { ensureRecord(); render(); }
}

// ------------------------------------------------------------------ routing
/* Routes: #/builders, #/builders/:id, #/builders/:id/person/:pid,
           #/people, #/people/:id, #/people/:id/at/:affId,
           #/title, #/title/:id, #/title/:id/person/:pid  */
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const section = ['builders', 'people', 'title'].includes(parts[0]) ? parts[0] : 'builders';
  return { section, id: parts[1] || null, sub: parts[2] || null, subId: parts[3] || null };
}
function routeHash(r) {
  let h = '#/' + r.section;
  if (r.id) h += '/' + r.id;
  if (r.id && r.sub && r.subId) h += '/' + r.sub + '/' + r.subId;
  return h;
}
function navigate(hash, replace) {
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) onHashChange();
}
function onHashChange() {
  const prev = state.route;
  state.route = parseHash();
  if (state.form && !isDirty()) state.form = null;
  if (prev.section !== state.route.section) { state.q = ''; state.searchCursor = -1; state.filters = { role: '', where: '' }; }
  state.menu = null;
  if (state.route.sub) state.panel = null;              // picking a person replaces an open help/team panel
  state.inspOpen = Boolean(state.route.sub || state.form || state.panel);
  ensureRecord();
  remember();
  render();
  if (prev.id !== state.route.id) {
    const main = $('#record');
    if (main) { main.scrollTop = 0; main.focus({ preventScroll: true }); }
  }
}
/* On wide layouts an empty section shows its first record; on phones it shows the list. */
/* Drops ids that no longer exist. Nothing is selected on the user's behalf: a section opens as its list
   and the record pane stays empty until a row is picked. */
function ensureRecord() {
  const r = state.route;
  const rows = sectionRows(r.section);
  if (r.id && !rows.some(x => x.id === r.id)) { r.missing = r.id; r.id = null; r.sub = null; r.subId = null; }
  if (r.sub === 'person' && r.subId && !person(r.subId)) { r.sub = null; r.subId = null; }
  if (r.sub === 'at' && r.subId && !affById(r.subId)) { r.sub = null; r.subId = null; }
}
function sectionRows(section) {
  if (section === 'people') return state.people;
  if (section === 'title') return state.titleCompanies;
  return state.builders;
}
function currentRecord() {
  const r = state.route;
  if (!r.id) return null;
  if (r.section === 'people') { const p = person(r.id); return p ? { kind: 'person', rec: p } : null; }
  if (r.section === 'title') { const c = titleCo(r.id); return c ? { kind: 'tc', rec: c } : null; }
  const b = builder(r.id);
  return b ? { kind: 'builder', rec: b } : null;
}
function loadRecent() {
  try { return JSON.parse(localStorage.getItem('trl-recent') || '[]'); } catch (e) { return []; }
}
function remember() {
  const r = state.route;
  if (!r.id) return;
  const key = r.section + ':' + r.id;
  state.recent = [key, ...state.recent.filter(k => k !== key)].slice(0, 8);
  try { localStorage.setItem('trl-recent', JSON.stringify(state.recent)); } catch (e) { /* private mode */ }
}

// ------------------------------------------------------------------ search
function buildDocs() {
  const docs = [];
  for (const p of state.people) {
    const affs = affsOfPerson(p.id);
    const fields = [['Company', p.company], ['Notes', p.notes]];
    for (const a of affs) fields.push([parentName(a), [a.role, a.handles].filter(t).join(': ')]);
    for (const x of list(p.phones)) fields.push([t(x.label) || 'Phone', fmtPhone(x.value)]);
    for (const x of list(p.emails)) fields.push([t(x.label) || 'Email', t(x.value)]);
    docs.push({
      type: 'person', id: p.id, name: p.name, fields,
      sub: affs.map(a => `${a.role || 'Contact'} · ${parentName(a)}`).join(', ') || (t(p.company) || 'Not linked anywhere'),
      text: ci([p.name, ...fields.map(f => f[1])].join(' ')),
      digits: list(p.phones).map(x => digitsOf(x.value)).join(' '),
    });
  }
  for (const b of state.builders) {
    const tc = titleCo(b.title_company_id);
    const fields = [['Title company', tc ? tc.name : ''], ['Concession', b.concession], ['Allowed uses', b.allowed_uses],
      ['Special process', b.special_process], ['CC rules', b.comm_rules], ['Notes', b.notes], ['Dropbox', b.dropbox]];
    docs.push({ type: 'builder', id: b.id, name: b.name, fields,
      sub: [plural(affsOfBuilder(b.id).length, 'person', 'people'), tc && tc.name].filter(Boolean).join(' · '),
      text: ci([b.name, ...fields.map(f => f[1])].join(' ')), digits: '' });
  }
  for (const c of state.titleCompanies) {
    const fields = [['Team email', c.team_email], ['Office phone', fmtPhone(c.office_phone)], ['Office address', c.office_address], ['Notes', c.notes]];
    docs.push({ type: 'tc', id: c.id, name: c.name, fields,
      sub: `${plural(buildersOfTc(c.id).length, 'builder')} · ${plural(affsOfTc(c.id).length, 'person', 'people')}`,
      text: ci([c.name, ...fields.map(f => f[1])].join(' ')), digits: digitsOf(c.office_phone) });
  }
  state.ix.docs = docs;
}
const tokenize = (q) => ci(q).split(/\s+/).filter(Boolean);
function searchAll(q) {
  const tokens = tokenize(q);
  const out = { people: [], builders: [], tcs: [] };
  if (!tokens.length) return out;
  for (const d of state.ix.docs) {
    const ok = tokens.every(tok => {
      if (d.text.includes(tok)) return true;
      const dg = digitsOf(tok);
      return dg.length >= 3 && d.digits.includes(dg);
    });
    if (!ok) continue;
    const nameHit = tokens.some(tok => ci(d.name).includes(tok));
    const match = nameHit ? null : d.fields.find(f => tokens.some(tok => ci(f[1]).includes(tok) || (digitsOf(tok).length >= 3 && digitsOf(f[1]).includes(digitsOf(tok)))));
    const item = { ...d, nameHit, match };
    (d.type === 'person' ? out.people : d.type === 'builder' ? out.builders : out.tcs).push(item);
  }
  const rank = (a, b) => (b.nameHit - a.nameHit) || ci(a.name).localeCompare(ci(b.name));
  out.people.sort(rank); out.builders.sort(rank); out.tcs.sort(rank);
  return out;
}
/* Wraps matched fragments in <mark>, escaping the text first, never regexing over HTML. */
function hl(text, tokens) {
  const s = String(text == null ? '' : text);
  const low = s.toLowerCase();
  const ranges = [];
  for (const tok of tokens) {
    if (!tok) continue;
    let i = low.indexOf(tok);
    while (i >= 0) { ranges.push([i, i + tok.length]); i = low.indexOf(tok, i + tok.length); }
  }
  if (!ranges.length) return esc(s);
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    out += esc(s.slice(pos, a)) + '<mark>' + esc(s.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + esc(s.slice(pos));
}

// ------------------------------------------------------------------ layout
function layoutMode() {
  if (window.matchMedia('(max-width: 959px)').matches) return 'phone';
  if (window.matchMedia('(max-width: 1439px)').matches) return 'mid';
  return 'wide';
}
function applyLayout() {
  const mode = layoutMode();
  const app = $('#app');
  app.classList.toggle('has-record', Boolean(state.route.id));
  const open = mode === 'wide' || state.inspOpen;
  $('#insp').classList.toggle('open', open && mode !== 'wide');
  $('#insp').hidden = !open;
  $('#scrim').hidden = !(open && mode !== 'wide');
}
function openInsp() { state.inspOpen = true; }
function closeInsp() {
  if (state.form) { if (!closeForm()) return; }
  state.panel = null;
  state.inspOpen = false;
  if (state.route.sub) { navigate(routeHash({ ...state.route, sub: null, subId: null })); return; }
  render();
}

// ------------------------------------------------------------------ demo data (layout checks only)
function seedDemo() {
  const now = new Date().toISOString();
  const id = (p, i) => `${p}${i}`;
  const tcs = ['Stewart Title - Mary Cherry', 'Weststar Title - Diane Rodriguez', 'El Paso Title'].map((name, i) => ({
    id: id('t', i), name, team_email: i === 0 ? 'stcelpcullersteam@stewart.com' : '', office_phone: i === 0 ? '9155550200' : '',
    office_address: i === 0 ? '6006 N Mesa St, Suite 201\nEl Paso, TX 79912' : '', notes: i === 0 ? "Always include Mary's assistant and the team email on correspondence." : '',
    created_at: now, updated_at: now, updated_by: 'jenn@closewithjenn.com' }));
  const bn = ['Bella Vista Homes', 'Cullers Homes', 'Desert View Homes', 'Edwards Homes', 'Edwards Homes - NM', 'El Paso Homes', 'Hakes Brothers', 'Icon Custom Homes', 'Pointe Homes', 'RS Homes', 'Savannah Homes', 'Saratoga Homes'];
  const builders = bn.map((name, i) => ({ id: id('b', i), name, title_company_id: i === 1 ? 't0' : i === 3 ? 't1' : i === 5 ? 't2' : null,
    dropbox: i % 2 ? 'https://www.dropbox.com/scl/fo/' + name.toLowerCase().replace(/\W+/g, '-') : '',
    concession: i === 1 ? 'Up to 3%' : i === 6 ? 'Up to $10,000' : '', calc_from: i === 1 ? 'Loan amount' : i === 6 ? 'Sales price' : '',
    allowed_uses: i === 1 ? 'Closing costs, prepaids and rate buydown. Not toward down payment. Must be on the contract before submission; any change after underwriting needs an addendum signed by both parties and a revised CD. Builder pays title policy when their preferred title company is used, otherwise the buyer covers it. Ask the builder rep before quoting anything over 3% on FHA files.' : '',
    special_process: '', comm_rules: i === 1 ? 'Always CC Yolanda and the team inbox on anything involving builder docs or the appraisal.\nSeller-signed items go to Gina first.' : '',
    notes: '', created_at: now, updated_at: now, updated_by: 'jenn@closewithjenn.com' }));
  const ppl = [
    ['Dennis Estep', 'b1', 'Owner', 'Final say on concessions', false, ['9155550101'], ['dennis@cullershomes.com']],
    ['Yolanda Perez', 'b1', 'Builder Rep', 'POC for builder docs and appraisals', true, ['9155550102', '9155550199'], ['yolanda@cullershomes.com']],
    ['Gina Zamora', 'b1', 'Builder Docs POC', 'Seller-signed items, addenda', true, ['9155550103'], ['gina@cullershomes.com']],
    ['Marco Ruiz', 'b1', 'Appraisal POC', 'Schedules appraisal access', false, ['9155550104'], ['marco@cullershomes.com']],
    ['Karen Mills', 'b1', 'Listing Agent', '', false, ['9155550105'], ['karen@realtyone.com']],
    ['Adolfo Alvarez', 'b1', 'Realtor', 'Also works RS Homes', false, ['9155550106'], ['adolfo@realtyone.com']],
    ['Tina Brooks', 'b1', 'Sales', '', false, [], ['tina@cullershomes.com']],
    ['Celeste Fernandez', 'b1', 'Transaction Coordinator', 'Sends the contract package', false, ['915-555-0108 ext 12'], ['celeste@cullershomes.com']],
    ['Roxana Breceda', 'b1', 'Other', '', false, [], ['roxana@cullershomes.com']],
    ['Brianna Cole', 'b6', 'Builder Rep', 'Docs and appraisals', false, ['5755550301'], ['brianna@hakesbrothers.com']],
    ['Sam Ortiz', 'b6', 'Sales', '', false, ['5755550302'], ['sam@hakesbrothers.com']],
    ['Luis Ochoa', 'b2', 'Builder Rep', 'Docs, appraisals, anything on the file', false, ['9155550401'], ['luis@desertviewhomes.com']],
    ['Mary Cherry', 't0', 'Escrow Agent', '', false, ['9155550201'], ['mary.cherry@stewart.com']],
    ['Cheryl Hughes', 't0', 'Escrow Assistant', 'Covers when Mary is out', false, ['9155550202'], ['cheryl.hughes@stewart.com']],
    ['Gina General', null, '', '', false, ['9155554444', '9155555555'], ['gina@ins.com']],
  ];
  const people = [], affs = [];
  ppl.forEach((row, i) => {
    const [name, parent, role, handles, cc, phones, emails] = row;
    people.push({ id: id('p', i), name, company: parent ? '' : 'Insurance Co', notes: i === 1 ? 'Out Fridays. Prefers text for anything urgent.' : '',
      phones: phones.map((v, j) => ({ label: j === 0 ? 'Mobile' : 'Office', value: v })), emails: emails.map(v => ({ label: 'Work', value: v })),
      created_at: now, updated_at: now, updated_by: 'jenn@closewithjenn.com' });
    if (parent) affs.push({ id: id('a', i), person_id: id('p', i), builder_id: parent[0] === 'b' ? parent : null,
      title_company_id: parent[0] === 't' ? parent : null, role, handles, always_cc: cc, created_at: now, updated_at: now, updated_by: 'jenn@closewithjenn.com' });
  });
  affs.push({ id: 'a99', person_id: 'p1', builder_id: 'b3', title_company_id: null, role: 'Builder Rep', handles: '', always_cc: false, created_at: now, updated_at: now, updated_by: '' });
  affs.push({ id: 'a98', person_id: 'p5', builder_id: 'b9', title_company_id: null, role: 'Realtor', handles: '', always_cc: true, created_at: now, updated_at: now, updated_by: '' });
  demoStore.people = people; demoStore.affiliations = affs; demoStore.builders = builders; demoStore.title_companies = tcs;
  demoStore.roles = ['Owner', 'Listing Agent', 'Builder Rep', 'Builder Docs POC', 'Appraisal POC', 'Realtor', 'Sales', 'Transaction Coordinator', 'Closing Coordinator', 'Other'].map((name, i) => ({ id: id('r', i), name, position: i }));
  demoStore.allowed_users = [{ email: 'you@example.com', access: 'admin' }];
}

// ------------------------------------------------------------------ events
document.addEventListener('click', async (e) => {
  const authBtn = e.target.closest('[data-auth]');
  if (authBtn) { handleAuth(authBtn.dataset.auth); return; }

  if (e.target.closest('#scrim')) { closeInsp(); return; }
  // Whole table rows act as links to the record they name.
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a, button, input, select')) { location.hash = tr.dataset.href; return; }
  if (state.menu && !e.target.closest('.menu, .row-menu, [data-action="menu"], [data-action="row-menu"]')) {
    state.menu = null; render();
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const d = el.dataset;

  // Rows and results are real links; the router handles them. Nothing to do here.
  if (a === 'menu') { state.menu = state.menu === 'account' ? null : 'account'; render(); return; }
  if (a === 'row-menu') { e.preventDefault(); const key = 'row:' + d.id; state.menu = state.menu === key ? null : key; render(); return; }
  if (a === 'more') { state.menu = state.menu === 'more' ? null : 'more'; render(); return; }
  if (a === 'copy') { e.preventDefault(); copyText(d.copy, el); return; }
  if (a === 'copy-cc') { copyText(ccEmails(builder(d.id)).join('; '), el); return; }
  if (a === 'show-more') { state.expanded[d.key] = !state.expanded[d.key]; render(); return; }
  if (a === 'close-insp') { closeInsp(); return; }
  if (a === 'details') { state.panel = null; state.inspOpen = true; render(); return; }
  if (a === 'back') { navigate('#/' + state.route.section); return; }
  if (a === 'reload') { location.reload(); return; }
  if (a === 'signout') { state.menu = null; if (DEMO) { toast('Demo mode has no sign in.'); return; } supa.auth.signOut(); return; }
  if (a === 'export') { state.menu = null; render(); exportExcel(); return; }
  if (a === 'panel') { state.menu = null; state.form = null; state.panel = d.panel; state.inspOpen = true; render(); return; }

  // Editing
  if (a === 'new-builder') { openForm('builder', {}); return; }
  if (a === 'new-titleco') { openForm('titleco', {}); return; }
  if (a === 'edit-builder') { openForm('builder', { id: d.id }); return; }
  if (a === 'edit-titleco') { openForm('titleco', { id: d.id }); return; }
  if (a === 'new-person') { openForm('person', { parentKind: d.kind, parentId: d.parent }); return; }
  if (a === 'new-person-free') { openForm('person', {}); return; }
  if (a === 'edit-person') { openForm('person', { id: d.id, affId: d.aff || null }); return; }
  if (a === 'new-aff') { openForm('aff', { personId: d.person }); return; }
  if (a === 'edit-aff') { openForm('aff', { id: d.id }); return; }
  if (a === 'link-titleco') { openForm('linkTitleCo', { builderId: d.id }); return; }
  if (a === 'delete') { deleteFromForm(el); return; }
  if (a === 'remove-aff') { removeAffiliation(d.id, el); return; }
  if (a === 'cancel') { closeForm(); return; }
  if (a === 'discard') { state.form.confirmDiscard = true; state.form.dirty = false; closeForm(); return; }
  if (a === 'keep') { keepEditing(); return; }
  if (a === 'ta-pick') { typeaheadPick(d.id); return; }
  if (a === 'ta-create') { typeaheadCreate(); return; }
  if (a === 'add-row') { addRow(d.kind); return; }
  if (a === 'del-row') { delRow(el); return; }
  if (a === 'force-create') { state.form.force = true; $('#insp form') && $('#insp form').requestSubmit(); return; }
  if (a === 'link-existing') { typeaheadPick(d.id); return; }

  // Team and roles (admin)
  if (a === 'team-add') { teamAdd(); return; }
  if (a === 'team-remove') { teamRemove(d.email, el); return; }
  if (a === 'role-add') { roleAdd(); return; }
  if (a === 'role-remove') { roleRemove(d.id, el); return; }
  if (a === 'role-up') { roleMove(d.id, -1); return; }
  if (a === 'role-down') { roleMove(d.id, 1); return; }
});

document.addEventListener('submit', (e) => {
  const auth = e.target.closest('form[data-auth-form]');
  if (auth) { e.preventDefault(); handleAuth(auth.dataset.authForm); return; }
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  handleSubmit(form, e.submitter);
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-team-access]');
  if (sel) { teamSetAccess(sel); return; }
  const f = e.target.closest('[data-filter]');
  if (f) { state.filters[f.dataset.filter] = f.value; renderList(); return; }
  if (e.target.closest('#insp form')) {
    markDirty();
    if (e.target.matches('[data-rerender]')) {   // a choice that changes which fields show
      state.form.draft = readForm(e.target.closest('form'));
      renderInsp();
    }
  }
});

let searchTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value; state.searchCursor = -1; renderList(); }, 120);
    return;
  }
  if (e.target.matches('[data-ta]')) { markDirty(); clearFieldError(e.target); typeaheadInput(e.target); return; }
  if (e.target.closest('#insp form')) { markDirty(); clearFieldError(e.target); }
});

document.addEventListener('keydown', (e) => {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.key === '/' && !inField) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    const s = $('#search');
    if (s) { e.preventDefault(); s.focus(); s.select(); }
    return;
  }
  if (e.key === 'Escape') {
    if (state.menu) { state.menu = null; render(); return; }
    if (e.target.id === 'search' && state.q) { state.q = ''; e.target.value = ''; renderList(); return; }
    if (e.target.matches('[data-ta]') && state.form && state.form.taOpen) { state.form.taOpen = false; const d = $('#ta-drop'); if (d) d.remove(); return; }
    if (state.form || state.panel || (state.inspOpen && layoutMode() !== 'wide')) { closeInsp(); return; }
    return;
  }
  if (e.target.id === 'search') {
    const hits = $$('#list .rows a.row');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      state.searchCursor = Math.max(0, Math.min(hits.length - 1, state.searchCursor + (e.key === 'ArrowDown' ? 1 : -1)));
      hits.forEach((h, i) => h.classList.toggle('on', i === state.searchCursor));
      hits[state.searchCursor].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      const pick = hits[state.searchCursor >= 0 ? state.searchCursor : 0];
      if (pick) { location.hash = pick.getAttribute('href'); state.q = ''; e.target.value = ''; }
    }
    return;
  }
  if (e.target.matches('[data-ta]')) typeaheadKey(e);
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.target.closest('#insp form')) {
    e.preventDefault();
    e.target.closest('form').requestSubmit();
  }
});

window.addEventListener('focus', () => { if (state.session && state.allowed) refresh(); });
window.addEventListener('resize', () => { if (state.allowed) applyLayout(); });

boot();
