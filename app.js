'use strict';
const $ = s => document.querySelector(s);
const KEY = 'pt_v1';

/* ---------- state ---------- */
let state = load();
function load(){
  try{
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.log) return s;
  }catch(e){}
  return { profile:null, log:[], customFoods:[] };
}
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

const allFoods = () => FOODS.concat(state.customFoods);
const logFoods = () => allFoods().filter(f => !f.raw); // raw ingredients exist only for recipes
const foodById = id => allFoods().find(f => f.id === id);

/* ---------- target algorithm ----------
   g/kg bodyweight, scaled by activity + goal. Bodyweight basis is capped at a
   BMI-25 equivalent so protein isn't scaled off fat mass on high-BMI profiles. */
const FACTORS = {
  sedentary:{ maintain:1.0, cut:1.4, bulk:1.6 },
  light:    { maintain:1.2, cut:1.6, bulk:1.8 },
  moderate: { maintain:1.4, cut:1.8, bulk:1.9 },
  active:   { maintain:1.6, cut:2.0, bulk:2.0 },
  athlete:  { maintain:1.8, cut:2.2, bulk:2.2 }
};
function computeTarget(p){
  const m = p.height / 100;
  const bmi = p.weight / (m * m);
  const basis = bmi > 30 ? m * m * 25 : p.weight;
  let f = FACTORS[p.activity][p.goal];
  if (p.age >= 65) f = Math.max(f, 1.2);
  return { target: Math.round(basis * f), factor: f, basis: Math.round(basis), bmi: bmi };
}
const target = () => state.profile ? state.profile.target : 0;

/* ---------- dates ---------- */
// local calendar date — toISOString() would shift the day in any timezone east of UTC
const dayKey = d => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
};
const today = () => dayKey(new Date());
function weekDays(){
  const now = new Date(); now.setHours(0,0,0,0);
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
  return Array.from({length:7}, (_,i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d; });
}
const proteinOn = k => state.log.filter(e => e.day === k).reduce((s,e) => s + e.protein, 0);

/* the day being viewed and logged into — not necessarily today */
let viewDay = today();
const parseDay = k => new Date(k + 'T00:00:00');
function dayLabel(k){
  if (k === today()) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (k === dayKey(y)) return 'Yesterday';
  const d = parseDay(k);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] + ' ' + fmtDate(d);
}
function shiftDay(n){
  const d = parseDay(viewDay);
  d.setDate(d.getDate() + n);
  if (dayKey(d) > today()) return;    // can't log into the future
  viewDay = dayKey(d);
  renderHome();
}

/* ---------- logging ---------- */
function addEntry(food, qty, grams){
  const g = grams || qty * food.gramsPerUnit;
  state.log.push({
    id: Date.now() + '' + Math.random().toString(36).slice(2,6),
    ts: Date.now(), day: viewDay,
    foodId: food.id, name: food.name, emoji: food.emoji || '🍽',
    qty: qty, unit: food.unit, weighed: !!grams,
    grams: Math.round(g), protein: Math.round(g * food.protein / 100 * 10) / 10
  });
  save(); renderAll();
}
/* straight from a label: no food, no weight, just the protein number */
function addProtein(p, label){
  state.log.push({
    id: Date.now() + '' + Math.random().toString(36).slice(2,6),
    ts: Date.now(), day: viewDay,
    foodId: '_direct', name: label || 'Protein', emoji: '💪',
    qty: 1, unit: null, direct: true, weighed: false, grams: 0, protein: r1(p)
  });
  save(); renderAll();
}
function removeEntry(id){
  state.log = state.log.filter(e => e.id !== id);
  save(); renderAll();
}

/* ---------- natural language: "paneer burji around 100g" ---------- */
const FILLER = ['i','ate','eat','had','have','has','eaten','took','take','drank','drink','ka','ki',
  'around','about','approx','approximately','roughly','nearly','maybe','like','some','of','a','an',
  'the','today','just','my','one-two','plus','and','with','&','was','were','it','then','also'];
const NUMWORDS = { half:0.5, quarter:0.25, one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
                   eight:8, nine:9, ten:10, twelve:12, couple:2, dozen:12, ek:1, do:2, teen:3, char:4 };
const UNITWORDS = ['katori','katoris','bowl','bowls','plate','plates','piece','pieces','scoop','scoops',
  'glass','glasses','slice','slices','cup','cups','tbsp','tsp','spoon','spoons','handful','bar','bars',
  'pack','packs','serving','servings','roti','rotis','egg','eggs','chilla','chillas','dosa','idli','idlis',
  'samosa','banana','apple','paratha','parathas','poori','pooris','vada','sandwich','burger','omelette'];

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9. ]+/g,' ').replace(/\s+/g,' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);

function lev(a,b){
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({length:a.length+1}, (_,i) => [i].concat(Array(b.length).fill(0)));
  for (let j=0;j<=b.length;j++) d[0][j]=j;
  for (let i=1;i<=a.length;i++) for (let j=1;j<=b.length;j++)
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}

// score how well a set of query words names a food; 3 = exact word hit.
// A food's real name outranks its aliases, so "curd" picks Curd/dahi over Tofu ("bean curd").
function scoreFood(qw, f){
  const name = words(f.name), alias = words(f.alias || '');
  let total = 0;
  qw.forEach(a => {
    let best = 0;
    const hit = (b, w) => {
      if (a === b) best = Math.max(best, 3 * w);
      else if (a.length > 2 && (b.startsWith(a) || a.startsWith(b))) best = Math.max(best, 2.2 * w);
      else if (a.length > 3 && lev(a,b) <= 1) best = Math.max(best, 2 * w);
    };
    name.forEach(b => hit(b, 1));
    alias.forEach(b => hit(b, 0.85));
    total += best;
  });
  return total / qw.length;
}

function rankFoods(q){
  const qw = words(q).filter(w => !FILLER.includes(w));
  if (!qw.length) return [];
  return logFoods().map(f => ({ f:f, s:scoreFood(qw,f) }))
    .filter(x => x.s >= 1.2).sort((a,b) => b.s - a.s);
}

/* "2 katori dal" / "paneer burji around 100g" / "3 eggs" -> what to log */
function parseSaid(text){
  let s = norm(String(text).replace(/1\/2|½/g,' half ').replace(/1\/4|¼/g,' quarter '));
  let grams = 0, qty = 0;

  const gm = s.match(/(\d+(?:\.\d+)?)\s*(kgs?|gms?|grams?|mls?|g|l)\b/);
  if (gm){
    grams = +gm[1] * (/^(kgs?|l)$/.test(gm[2]) ? 1000 : 1);
    s = s.replace(gm[0], ' ');
  }

  const qm = s.match(/\d+(?:\.\d+)?/);
  if (qm && +qm[0] > 0 && +qm[0] < 100){ qty = +qm[0]; s = s.replace(qm[0], ' '); }

  words(s).forEach(w => {
    if (!qty && NUMWORDS[w] != null){ qty = NUMWORDS[w]; s = s.replace(w, ' '); }
  });

  const kept = words(s).filter(w => !FILLER.includes(w));

  // "30g protein" / "protein 25" — a bare number, no food to look up
  if (kept.length && kept.every(w => /^(protein|protien|proteins|g|gm|grams?)$/.test(w))){
    const amount = grams || qty;
    if (amount > 0) return { text:text, food:null, direct:amount, q:'protein' };
  }

  // drop "katori"/"bowl" so they don't dilute the match — but "3 eggs" is a unit word
  // that IS the food, so fall back to the unstripped words if stripping finds nothing
  const noUnits = kept.filter(w => !UNITWORDS.includes(w));
  let ranked = noUnits.length ? rankFoods(noUnits.join(' ')) : [];
  if (!ranked.length) ranked = rankFoods(kept.join(' '));

  const q = (noUnits.length ? noUnits : kept).join(' ');
  if (!ranked.length) return { text:text, food:null, q:q, leftover:kept.join(' ') };
  return { text:text, food:ranked[0].f, qty: qty || 1, grams:grams, q:q,
           confident: ranked[0].s >= 2 };
}

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- onboarding ---------- */
let obIdx = 0, draft = {};
function startOnboarding(){
  draft = state.profile ? Object.assign({}, state.profile) : {};
  obIdx = 0;
  if (draft.weight){ $('#fWeight').value = draft.weight; $('#fHeight').value = draft.height; $('#fAge').value = draft.age; }
  ['#fSex','#fActivity','#fGoal'].forEach(sel => {
    document.querySelectorAll(sel + ' .choice').forEach(b => b.classList.remove('on'));
  });
  if (draft.sex) markOn('#fSex', draft.sex);
  if (draft.activity) markOn('#fActivity', draft.activity);
  if (draft.goal) markOn('#fGoal', draft.goal);
  $('#app').classList.add('hidden');
  $('#onboarding').classList.remove('hidden');
  paintOb();
}
const markOn = (sel,val) => {
  const b = document.querySelector(sel + ' .choice[data-val="' + val + '"]');
  if (b) b.classList.add('on');
};
const OB_TEXT = [
  ['Let\'s set your target', 'A few numbers and we\'ll work out how much protein you actually need.'],
  ['Sex', 'Used only to sanity-check your body composition estimate.'],
  ['How active are you?', 'Training load is the biggest driver of protein needs.'],
  ['What\'s the goal?', 'Cutting and building both need more than maintaining.']
];
function paintOb(){
  document.querySelectorAll('.ob-pane').forEach((p,i) => p.classList.toggle('hidden', i !== obIdx));
  $('#obStep').textContent = obIdx + 1;
  $('#obTitle').textContent = OB_TEXT[obIdx][0];
  $('#obSub').textContent = OB_TEXT[obIdx][1];
  $('#obBack').classList.toggle('hidden', obIdx === 0);
  $('#obNext').textContent = obIdx === 3 ? 'Calculate my target' : 'Continue';
}
document.querySelectorAll('#fSex .choice, #fActivity .choice, #fGoal .choice').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.parentElement;
    group.querySelectorAll('.choice').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    draft[group.id === 'fSex' ? 'sex' : group.id === 'fActivity' ? 'activity' : 'goal'] = btn.dataset.val;
  });
});
$('#obBack').onclick = () => { obIdx--; paintOb(); };
$('#obNext').onclick = () => {
  if (obIdx === 0){
    const w = +$('#fWeight').value, h = +$('#fHeight').value, a = +$('#fAge').value;
    if (!(w > 20 && w < 400)) return toast('Enter a weight in kg');
    if (!(h > 100 && h < 250)) return toast('Enter a height in cm');
    if (!(a > 10 && a < 110)) return toast('Enter your age');
    Object.assign(draft, { weight:w, height:h, age:a });
  }
  if (obIdx === 1 && !draft.sex) return toast('Pick one');
  if (obIdx === 2 && !draft.activity) return toast('Pick your activity level');
  if (obIdx === 3){
    if (!draft.goal) return toast('Pick a goal');
    const r = computeTarget(draft);
    state.profile = Object.assign(draft, r);
    save();
    $('#onboarding').classList.add('hidden');
    $('#app').classList.remove('hidden');
    go('home'); renderAll();
    return toast('Your target: ' + r.target + 'g of protein a day');
  }
  obIdx++; paintOb();
};

/* ---------- nav ---------- */
function go(name){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.dataset.screen !== name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === name));
  window.scrollTo(0,0);
}
document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => go(b.dataset.go));
$('#goProfileTop').onclick = () => go('profile');

/* ---------- render ---------- */
function renderAll(){ renderHome(); renderWeek(); renderFoods(); renderProfile(); }

function renderHome(){
  const t = target(), have = Math.round(proteinOn(viewDay)), isNow = viewDay === today();
  const pct = t ? Math.min(have / t, 1) : 0;
  $('#ringFg').style.strokeDashoffset = 527.8 * (1 - pct);
  $('#todayVal').textContent = have + 'g';
  $('#todayTarget').textContent = 'of ' + t + 'g';
  const left = t - have;
  $('#ringNote').textContent = have === 0 ? 'Nothing logged ' + (isNow ? 'yet today.' : 'this day.')
    : left > 0 ? left + 'g ' + (isNow ? 'to go — about ' + Math.max(1, Math.round(left / 20)) + ' more servings.' : 'short of target.')
    : 'Target hit. ' + Math.abs(left) + 'g over.';

  $('#dayLabel').textContent = dayLabel(viewDay);
  $('#dayNext').disabled = isNow;
  $('#loggedTitle').textContent = 'Logged ' + (isNow ? 'today' : dayLabel(viewDay).toLowerCase());
  $('#backdate').classList.toggle('hidden', isNow);
  $('#backdate').textContent = '↩ You\'re adding to ' + dayLabel(viewDay) + ' — tap to return to today';

  // quick chips: most-logged foods, else a sensible starter set
  const counts = {};
  state.log.forEach(e => counts[e.foodId] = (counts[e.foodId] || 0) + 1);
  let ids = Object.keys(counts).sort((a,b) => counts[b] - counts[a]).slice(0,8);
  if (ids.length < 8) ids = ids.concat(['whey','egg','paneer','dal','curd','chicken','roti','peanutbtr'].filter(i => !ids.includes(i))).slice(0,8);
  $('#quickChips').innerHTML = ids.map(id => {
    const f = foodById(id); if (!f) return '';
    return '<button class="chip" data-quick="' + f.id + '">' + (f.emoji||'🍽') + ' ' + f.name +
           ' <em>+' + Math.round(f.gramsPerUnit * f.protein / 100) + 'g</em></button>';
  }).join('');
  document.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => {
    const f = foodById(b.dataset.quick);
    addEntry(f, 1, 0);
    toast('Logged 1 ' + f.unit + ' ' + f.name);
  });

  const list = state.log.filter(e => e.day === viewDay).sort((a,b) => b.ts - a.ts);
  $('#entryCount').textContent = list.length ? list.length + ' item' + (list.length>1?'s':'') : '';
  $('#entries').innerHTML = list.length ? list.map(e =>
    '<li><button class="e-tap" data-edit-entry="' + e.id + '">' +
    '<span class="e-emoji">' + e.emoji + '</span>' +
    '<span class="e-main"><b>' + esc(e.name) + '</b><span>' + esc(entryLabel(e)) + '</span></span>' +
    '<span class="e-val">' + e.protein + 'g</span><span class="e-chev">›</span></button></li>').join('')
    : '<p class="empty">Tap ＋ or a quick-add chip to log something.</p>';
  document.querySelectorAll('[data-edit-entry]').forEach(b =>
    b.onclick = () => openEditEntry(b.dataset.editEntry));
}

function renderWeek(){
  const t = target(), days = weekDays(), vals = days.map(d => Math.round(proteinOn(dayKey(d))));
  const upto = days.filter(d => dayKey(d) <= today()).length;
  const done = vals.slice(0, upto);
  const avg = done.length ? Math.round(done.reduce((a,b)=>a+b,0) / done.length) : 0;
  const max = Math.max(t, ...vals, 1);
  const L = ['M','T','W','T','F','S','S'];

  $('#weekAvg').textContent = avg;
  $('#legendTarget').textContent = t + 'g';
  $('#weekRange').textContent = fmtDate(days[0]) + ' – ' + fmtDate(days[6]);
  $('#bars').innerHTML =
    (t ? '<div class="tline" style="bottom:' + (t / max * 100) + '%"></div>' : '') +
    days.map((d,i) => {
      const v = vals[i], hit = t && v >= t, isToday = dayKey(d) === today();
      return '<div class="bar' + (hit ? '' : ' miss') + (isToday ? ' today' : '') + '">' +
             '<i style="height:' + Math.max(3, v / max * 100) + '%"></i></div>';
    }).join('');
  $('#barLabels').innerHTML = days.map((d,i) =>
    '<u class="' + (dayKey(d) === today() ? 'on' : '') + '">' + L[i] + '</u>').join('');

  $('#stHit').textContent = vals.filter(v => t && v >= t).length;
  $('#stTotal').textContent = vals.reduce((a,b)=>a+b,0) + 'g';
  $('#stBest').textContent = Math.max(...vals, 0) + 'g';
  const gaps = done.map(v => Math.max(0, t - v));
  $('#stGap').textContent = (gaps.length ? Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length) : 0) + 'g';

  const keys = days.map(dayKey);
  const by = {};
  state.log.filter(e => keys.includes(e.day)).forEach(e => {
    by[e.name] = (by[e.name] || { p:0, emoji:e.emoji });
    by[e.name].p += e.protein;
  });
  const top = Object.entries(by).sort((a,b) => b[1].p - a[1].p).slice(0,5);
  const tot = top.reduce((s,x) => s + x[1].p, 0) || 1;
  $('#sources').innerHTML = top.length ? top.map(([n,o]) =>
    '<div><span>' + o.emoji + '</span><span class="track"><i style="width:' + (o.p/tot*100) + '%"></i></span>' +
    '<span class="v">' + Math.round(o.p) + 'g</span></div>').join('')
    : '<p class="empty">No data this week yet.</p>';
}

function renderFoods(){
  const q = ($('#foodSearch').value || '').toLowerCase();
  $('#foodList').innerHTML = logFoods()
    .filter(f => f.name.toLowerCase().includes(q))
    .sort((a,b) => isCustom(b) - isCustom(a))
    .map(f => foodRow(f, 'pick', true)).join('');
  document.querySelectorAll('#foodList [data-pick]').forEach(b => b.onclick = () => openQty(b.dataset.pick));
  document.querySelectorAll('#foodList [data-edit]').forEach(b => b.onclick = () => openFoodForm(b.dataset.edit));
}
const isCustom = f => f.id.slice(0,2) === 'c_';
const foodRow = (f, attr, editable) =>
  '<div class="food-row">' +
    '<button class="fr-tap" data-' + attr + '="' + f.id + '">' +
      '<span class="e-emoji">' + (f.emoji||'🍽') + '</span>' +
      '<span class="fr-main"><b>' + esc(f.name) + (isCustom(f) ? '<i class="tag">yours</i>' : '') +
        '</b><span>1 ' + esc(f.unit) + ' = ' + f.gramsPerUnit + 'g</span></span>' +
      '<span class="fr-p">' + Math.round(f.gramsPerUnit * f.protein / 100) + 'g</span>' +
    '</button>' +
    (editable && isCustom(f) ? '<button class="fr-edit" data-edit="' + f.id + '">✎</button>' : '') +
  '</div>';

function renderProfile(){
  const p = state.profile; if (!p) return;
  $('#pTarget').textContent = p.target;
  $('#pFormula').textContent = p.basis + 'kg × ' + p.factor + 'g/kg — ' + p.activity + ', ' + p.goal +
    (p.bmi > 30 ? ' (weight basis capped at BMI 25 so the target tracks lean mass, not fat mass)' : '');
  $('#pWeight').textContent = p.weight + 'kg';
  $('#pHeight').textContent = p.height + 'cm';
  $('#pBmi').textContent = p.bmi.toFixed(1);
  $('#pGoal').textContent = p.goal;
  const base = location.origin + location.pathname;
  $('#shortcutUrl').textContent = base + '?say=[Dictated Text]';
  $('#shortcutUrl2').textContent = base + '?log=whey&qty=1';
}

/* ---------- log sheet ---------- */
let pick = null, qty = 1;
function openSheet(){
  $('#sheet').classList.remove('hidden');
  $('#sheetPick').classList.remove('hidden');
  $('#sheetQty').classList.add('hidden');
  $('#sheetDirect').classList.add('hidden');
  $('#sheetSearch').value = '';
  renderSheetList();
}
function openDirect(preset){
  $('#sheet').classList.remove('hidden');
  $('#sheetPick').classList.add('hidden');
  $('#sheetQty').classList.add('hidden');
  $('#sheetDirect').classList.remove('hidden');
  $('#dGrams').value = preset || '';
  $('#dLabel').value = '';
  document.querySelectorAll('#dQuick button').forEach(b => b.classList.toggle('on', +b.dataset.p === +preset));
}
$('#openDirect').onclick = () => openDirect();
$('#dBack').onclick = openSheet;
document.querySelectorAll('#dQuick button').forEach(b => b.onclick = () => {
  $('#dGrams').value = b.dataset.p;
  document.querySelectorAll('#dQuick button').forEach(x => x.classList.toggle('on', x === b));
});
$('#dGrams').oninput = () => document.querySelectorAll('#dQuick button')
  .forEach(b => b.classList.toggle('on', +b.dataset.p === +$('#dGrams').value));
$('#dSave').onclick = () => {
  const p = +$('#dGrams').value;
  if (!(p > 0 && p <= 500)) return toast('Enter the protein in grams');
  addProtein(p, $('#dLabel').value.trim());
  closeSheets();
  toast('Logged ' + r1(p) + 'g — ' + totalMsg());
};
let said = null;
function renderSheetList(){
  const typed = $('#sheetSearch').value.trim();
  said = typed ? parseSaid(typed) : null;
  const list = typed ? rankFoods(said.q).map(x => x.f) : logFoods();

  if (said && said.direct){
    $('#saidBox').innerHTML =
      '<div class="said-main"><b>💪 Protein</b><span>no food, just the number → <i>' +
      r1(said.direct) + 'g protein</i></span></div>' +
      '<button class="btn primary" id="saidLog">Log it</button>';
    $('#saidBox').classList.remove('hidden');
    $('#saidLog').onclick = () => {
      addProtein(said.direct, '');
      closeSheets();
      toast('Logged ' + r1(said.direct) + 'g — ' + totalMsg());
    };
  } else if (said && said.food){
    const f = said.food, g = said.grams || said.qty * f.gramsPerUnit;
    $('#saidBox').innerHTML =
      '<div class="said-main"><b>' + f.emoji + ' ' + esc(f.name) + '</b>' +
      '<span>' + (said.grams ? Math.round(g) + 'g' : fmtQty(said.qty) + ' ' + esc(f.unit) + ' · ' + Math.round(g) + 'g') +
      ' → <i>' + r1(g * f.protein / 100) + 'g protein</i></span></div>' +
      '<button class="btn primary" id="saidLog">Log it</button>';
    $('#saidBox').classList.remove('hidden');
    $('#saidLog').onclick = () => {
      addEntry(f, said.qty, said.grams);
      closeSheets();
      toast('Logged ' + f.name + ' — ' + totalMsg());
    };
  } else $('#saidBox').classList.add('hidden');

  $('#sheetList').innerHTML =
    list.map(f => foodRow(f,'sel',false)).join('') +
    '<button class="add-new" id="sheetAddNew">＋ Add ' +
      (typed ? '“' + esc((said && said.q) || typed) + '”' : 'a food that isn\'t here') + '</button>';
  document.querySelectorAll('#sheetList [data-sel]').forEach(b => b.onclick = () => openQty(b.dataset.sel));
  $('#sheetAddNew').onclick = () => { logAfterSave = true; openFoodForm(null, said ? said.q : ''); };
}
function openQty(id){
  pick = foodById(id); qty = 1;
  $('#sheet').classList.remove('hidden');
  $('#sheetPick').classList.add('hidden');
  $('#sheetQty').classList.remove('hidden');
  $('#qtyName').textContent = pick.emoji + ' ' + pick.name;
  $('#qtyUnit').textContent = '1 ' + pick.unit + ' = ' + pick.gramsPerUnit + 'g · ' + pick.protein + 'g protein per 100g';
  $('#qGrams').value = '';
  paintQty();
}
function paintQty(){
  $('#qVal').textContent = fmtQty(qty);
  const g = +$('#qGrams').value || qty * pick.gramsPerUnit;
  $('#qtyOut').textContent = (Math.round(g * pick.protein / 100 * 10)/10) + 'g protein · ' + Math.round(g) + 'g';
  document.querySelectorAll('#sheetQty .quick-qty button').forEach(b => b.classList.toggle('on', +b.dataset.q === qty));
}
$('#qMinus').onclick = () => { qty = Math.max(.5, Math.round((qty - .5)*2)/2); paintQty(); };
$('#qPlus').onclick  = () => { qty = Math.round((qty + .5)*2)/2; paintQty(); };
document.querySelectorAll('#sheetQty .quick-qty button').forEach(b => b.onclick = () => { qty = +b.dataset.q; paintQty(); });
$('#qGrams').oninput = paintQty;
$('#qBack').onclick = openSheet;
$('#qSave').onclick = () => {
  addEntry(pick, qty, +$('#qGrams').value || 0);
  closeSheets();
  toast('Logged ' + pick.name);
};
$('#sheetSearch').oninput = renderSheetList;
$('#fab').onclick = openSheet;
$('#openAll').onclick = openSheet;
$('#foodSearch').oninput = renderFoods;

/* ---------- edit a logged entry ---------- */
let edEntry = null, edQty = 1;
function openEditEntry(id){
  const e = state.log.find(x => x.id === id); if (!e) return;
  edEntry = e; edQty = e.qty || 1;
  const f = foodById(e.foodId);
  $('#edName').textContent = e.emoji + ' ' + e.name;
  $('#edUnitWrap').classList.toggle('hidden', !!e.direct);
  $('#edHint').textContent = e.direct ? 'Logged as a plain protein amount.'
    : f ? '1 ' + f.unit + ' = ' + f.gramsPerUnit + 'g · ' + f.protein + 'g protein per 100g'
        : 'This food was deleted — edit the grams or protein directly.';
  $('#edGrams').value = e.grams || '';
  $('#edProt').value = e.protein;
  $('#edDate').value = e.day;
  $('#edDate').max = today();
  $('#edQtyVal').textContent = fmtQty(edQty);
  $('#editSheet').classList.remove('hidden');
}
// qty drives grams drives protein, but a hand-typed protein always wins
function edFromQty(){
  const f = foodById(edEntry.foodId); if (!f) return;
  const g = edQty * f.gramsPerUnit;
  $('#edQtyVal').textContent = fmtQty(edQty);
  $('#edGrams').value = Math.round(g);
  $('#edProt').value = r1(g * f.protein / 100);
}
$('#edMinus').onclick = () => { edQty = Math.max(.5, Math.round((edQty - .5)*2)/2); edFromQty(); };
$('#edPlus').onclick  = () => { edQty = Math.round((edQty + .5)*2)/2; edFromQty(); };
$('#edGrams').oninput = () => {
  const f = foodById(edEntry.foodId), g = +$('#edGrams').value;
  if (f && g > 0){ edQty = r1(g / f.gramsPerUnit); $('#edQtyVal').textContent = fmtQty(edQty);
                   $('#edProt').value = r1(g * f.protein / 100); }
};
$('#edSave').onclick = () => {
  const p = +$('#edProt').value, g = +$('#edGrams').value, d = $('#edDate').value;
  if (!(p >= 0 && p <= 500)) return toast('Protein must be between 0 and 500g');
  if (!d || d > today()) return toast('Pick a date up to today');
  edEntry.protein = r1(p);
  edEntry.day = d;
  if (!edEntry.direct){
    const f = foodById(edEntry.foodId);
    edEntry.grams = Math.round(g);
    edEntry.qty = edQty;
    // still a clean unit count? keep showing it as "4 eggs", not "200g weighed"
    edEntry.weighed = !f || Math.abs(g - edQty * f.gramsPerUnit) > 0.5;
  }
  save();
  viewDay = d;                       // follow the entry if it moved days
  closeSheets(); renderAll();
  toast('Updated — ' + Math.round(proteinOn(d)) + 'g on ' + dayLabel(d).toLowerCase());
};
$('#edDelete').onclick = () => {
  if (!confirm('Delete this entry?')) return;
  removeEntry(edEntry.id);
  closeSheets();
  toast('Entry deleted');
};

/* ---------- day navigation ---------- */
$('#dayPrev').onclick = () => shiftDay(-1);
$('#dayNext').onclick = () => shiftDay(1);
$('#backdate').onclick = () => { viewDay = today(); renderHome(); };

function closeSheets(){
  logAfterSave = false;
  $('#sheet').classList.add('hidden');
  $('#newFood').classList.add('hidden');
  $('#editSheet').classList.add('hidden');
}
document.querySelectorAll('[data-close]').forEach(el => el.onclick = closeSheets);

/* ---------- custom food ---------- */
let editingId = null, logAfterSave = false, nfMode = 'simple', ings = [];

function setMode(m){
  nfMode = m;
  document.querySelectorAll('.mt').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#nfSimple').classList.toggle('hidden', m !== 'simple');
  $('#nfRecipe').classList.toggle('hidden', m !== 'recipe');
  if (m === 'recipe') renderIngs();
}
document.querySelectorAll('.mt').forEach(b => b.onclick = () => setMode(b.dataset.mode));

function renderIngs(){
  const opts = allFoods().filter(f => f.id !== editingId)
    .map(f => '<option value="' + f.id + '">' + esc(f.name) + '</option>').join('');
  $('#ingList').innerHTML = ings.map((r,i) =>
    '<div class="ing">' +
      '<select data-ing="' + i + '"><option value="">Pick an ingredient…</option>' + opts + '</select>' +
      '<div class="input-row ing-g"><input type="number" inputmode="decimal" placeholder="0" data-ig="' + i + '"><em>g</em></div>' +
      '<button class="ing-x" data-ix="' + i + '">✕</button>' +
    '</div>').join('');
  ings.forEach((r,i) => { $('[data-ing="'+i+'"]').value = r.id; $('[data-ig="'+i+'"]').value = r.g; });
  document.querySelectorAll('[data-ing]').forEach(s => s.onchange = () => { ings[+s.dataset.ing].id = s.value; calcRecipe(); });
  document.querySelectorAll('[data-ig]').forEach(s => s.oninput  = () => { ings[+s.dataset.ig].g  = s.value; calcRecipe(); });
  document.querySelectorAll('[data-ix]').forEach(s => s.onclick  = () => {
    ings.splice(+s.dataset.ix, 1);
    if (!ings.length) ings.push({ id:'', g:'' });
    renderIngs();
  });
  calcRecipe();
}
$('#addIng').onclick = () => { ings.push({ id:'', g:'' }); renderIngs(); };

/* Totals are computed on raw ingredient weight. Water cooking off makes per-100g
   read low, but per-unit protein (P/N) stays exact — and units are what you log. */
function calcRecipe(){
  let W = 0, P = 0;
  ings.forEach(r => {
    const f = r.id && foodById(r.id), g = +r.g;
    if (f && g > 0){ W += g; P += g * f.protein / 100; }
  });
  const N = Math.max(1, Math.round(+$('#nfServes').value) || 1);
  const unit = $('#nfUnit').value.trim() || 'serving';
  $('#unitEcho').textContent = unit + 's';
  if (!W){ $('#recipeOut').textContent = ''; return { W:0 }; }
  $('#recipeOut').innerHTML =
    '<span>' + Math.round(W) + 'g mix · ' + r1(P) + 'g protein total</span>' +
    '1 ' + esc(unit) + ' ≈ ' + Math.round(W/N) + 'g · <b>' + r1(P/N) + 'g protein</b>';
  return { W:W, P:P, N:N, perUnitG:W/N, per100:P/W*100 };
}
$('#nfServes').oninput = calcRecipe;
$('#nfUnit').oninput = () => { if (nfMode === 'recipe') calcRecipe(); };

function openFoodForm(id, presetName){
  editingId = id || null;
  const f = id ? foodById(id) : null;
  $('#nfEmoji').value = f ? f.emoji : '';
  $('#nfName').value  = f ? f.name : (presetName || '');
  $('#nfUnit').value  = f ? f.unit : '';
  $('#nfGrams').value = f ? f.gramsPerUnit : '';
  $('#nfProt').value  = f ? f.protein : '';
  $('#nfServes').value = f && f.serves ? f.serves : '';
  ings = f && f.recipe ? f.recipe.map(r => ({ id:r.id, g:r.g })) : [{ id:'', g:'' }];
  $('#nfTitle').textContent = f ? 'Edit food' : 'New food';
  $('#nfHint').textContent = f
    ? 'Changes apply from now on — already-logged entries keep the numbers they were logged with.'
    : 'Read the protein off the packet, or build it from what you cooked with.';
  $('#nfDelete').classList.toggle('hidden', !f);
  setMode(f && f.recipe ? 'recipe' : 'simple');
  $('#newFood').classList.remove('hidden');
}
$('#addFoodBtn').onclick = () => { logAfterSave = false; openFoodForm(null); };

$('#nfSave').onclick = () => {
  const relog = logAfterSave;
  const name = $('#nfName').value.trim(), unit = $('#nfUnit').value.trim() || 'serving';
  if (!name) return toast('Give it a name');
  const fields = { name: name, emoji: $('#nfEmoji').value.trim() || '🍽', unit: unit,
                   recipe: null, serves: null };

  if (nfMode === 'recipe'){
    const r = calcRecipe();
    if (!r.W) return toast('Add at least one ingredient with a weight');
    fields.gramsPerUnit = Math.round(r.perUnitG);
    fields.protein = r1(r.per100);
    fields.recipe = ings.filter(x => x.id && +x.g > 0).map(x => ({ id:x.id, g:+x.g }));
    fields.serves = r.N;
  } else {
    const grams = +$('#nfGrams').value, prot = +$('#nfProt').value;
    if (!(grams > 0)) return toast('How many grams is one ' + unit + '?');
    if (!(prot >= 0 && prot <= 100)) return toast('Protein per 100g must be between 0 and 100');
    fields.gramsPerUnit = grams; fields.protein = prot;
  }

  let id = editingId;
  if (id) Object.assign(foodById(id), fields);
  else {
    id = 'c_' + Date.now().toString(36);
    state.customFoods.push(Object.assign({ id: id }, fields));
  }
  save(); closeSheets(); renderAll();
  toast(name + (editingId ? ' updated' : ' added'));
  if (relog) openQty(id);
};

$('#nfDelete').onclick = () => {
  const f = foodById(editingId);
  if (!confirm('Delete ' + f.name + '? Entries you already logged with it stay in your history.')) return;
  state.customFoods = state.customFoods.filter(x => x.id !== editingId);
  save(); closeSheets(); renderAll(); toast(f.name + ' deleted');
};

/* ---------- profile actions ---------- */
$('#editStats').onclick = startOnboarding;
$('#copyUrl').onclick = () => {
  const txt = $('#shortcutUrl').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('URL copied'), () => toast(txt));
  else toast(txt);
};
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'protein-' + today() + '.json';
  a.click(); URL.revokeObjectURL(a.href);
};
$('#resetBtn').onclick = () => {
  if (!confirm('Delete your profile and every logged entry?')) return;
  localStorage.removeItem(KEY);
  state = { profile:null, log:[], customFoods:[] };
  startOnboarding();
};

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const r1 = n => Math.round(n * 10) / 10;
const totalMsg = () => Math.round(proteinOn(viewDay)) + 'g of ' + target() + 'g ' + dayLabel(viewDay).toLowerCase();
const fmtQty = q => q % 1 === 0 ? q : q.toFixed(1).replace('.5','½').replace('0½','½');
const entryLabel = e =>
  e.direct ? 'entered directly'
  : e.weighed || !e.unit ? e.grams + 'g weighed'
  : fmtQty(e.qty) + ' ' + (e.qty > 1 ? e.unit + 's' : e.unit) + ' · ' + e.grams + 'g';
const fmtDate = d => d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];

/* ---------- shortcut entry point: ?log=<foodId>&qty=1.5[&g=200] ---------- */
function handleUrl(){
  const p = new URLSearchParams(location.search);
  const id = p.get('log'), spoken = p.get('say'), direct = p.get('protein');
  if ((!id && !spoken && !direct) || !state.profile) return;
  try { history.replaceState(null, '', location.pathname); } catch(e) {} // file:// blocks this

  if (direct){
    const g = +direct;
    if (!(g > 0 && g <= 500)) return toast('Bad protein amount: ' + direct);
    addProtein(g, p.get('label') || '');
    return toast('✓ ' + r1(g) + 'g — ' + totalMsg());
  }

  if (spoken){                                   // "hey siri, log food" -> dictation
    const r = parseSaid(spoken);
    if (r.direct){
      addProtein(r.direct, '');
      return toast('✓ ' + r1(r.direct) + 'g — ' + totalMsg());
    }
    if (!r.food){
      openSheet(); $('#sheetSearch').value = spoken; renderSheetList();
      return toast('Couldn\'t place “' + spoken + '” — pick it below?');
    }
    addEntry(r.food, r.qty, r.grams);
    return toast('✓ ' + r.food.name + ' — ' + totalMsg());
  }

  const f = foodById(id) || allFoods().find(x => x.name.toLowerCase() === id.toLowerCase());
  if (!f) return toast('Unknown food: ' + id);
  const q = Math.max(.25, +p.get('qty') || 1);
  addEntry(f, q, +p.get('g') || 0);
  toast('✓ ' + fmtQty(q) + ' ' + f.name + ' — ' + totalMsg());
}

/* ---------- keyboard ----------
   iOS shrinks the visual viewport but leaves fixed elements where they were, so a
   bottom sheet ends up behind the keyboard. Track the gap and lift the sheet by it. */
if (window.visualViewport){
  const vv = window.visualViewport;
  const track = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb', kb > 80);
  };
  vv.addEventListener('resize', track);
  vv.addEventListener('scroll', track);
  track();
}
document.addEventListener('focusin', e => {
  if (e.target.matches('input, select, textarea') && e.target.closest('.sheet'))
    setTimeout(() => e.target.scrollIntoView({ block:'center', behavior:'smooth' }), 250);
});

/* ---------- boot ---------- */
if (!state.profile){
  startOnboarding();
} else {
  $('#app').classList.remove('hidden');
  renderAll();
  handleUrl();
}
