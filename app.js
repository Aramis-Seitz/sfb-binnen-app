/* ==========================================================
   SBF Binnen Trainer – Programmcode
   Wird von index.html nach questions.js geladen.
   Abschnitte (siehe die großen Überschriften unten):
   EINSTELLUNGEN, HILFSFUNKTIONEN, LERNFORTSCHRITT,
   ZUSTAND DER AKTUELLEN SITZUNG (Üben und Prüfung),
   ANSICHTEN (Start, Frage, Auswertung), KLICKS, START
   ========================================================== */

/* ==========================================================
   EINSTELLUNGEN
   ========================================================== */

const SEGELN = 'Spezifische Fragen Segeln';
const CATS   = ['Basisfragen', 'Spezifische Fragen Binnen', SEGELN];

// Prüfungsarten. Hier kannst du Fragenzahl, Zeit und Bestehensgrenze ändern.
//   minutes: Zeit in Minuten
//   passPct: Prozent der Fragen, die insgesamt richtig sein müssen
//   parts:   Aus welchen Kategorien (cats) wie viele Fragen (n) gezogen werden
const EXAMS = {
  schnell: {
    label: 'Schnelle Prüfung',
    minutes: 17,
    passPct: 80,
    parts: [
      { name: 'Basis- & Binnenfragen', cats: ['Basisfragen', 'Spezifische Fragen Binnen'], n: 9 },
      { name: 'Segelfragen',           cats: [SEGELN],                                     n: 3 }
    ]
  },
  voll: {
    label: 'Vollständige Prüfung',
    minutes: 35,
    passPct: 80,
    parts: [
      { name: 'Basis- & Binnenfragen', cats: ['Basisfragen', 'Spezifische Fragen Binnen'], n: 18 },
      { name: 'Segelfragen',           cats: [SEGELN],                                     n: 7  }
    ]
  }
};
const LETTERS = 'ABCD';
const STORAGE_KEY = 'sbf-binnen-v1';


/* ==========================================================
   HILFSFUNKTIONEN
   ========================================================== */

const app = document.getElementById('app');

// Text für HTML absichern
const esc = s => s.replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]));

// Liste zufällig mischen
function shuffle(list) {
  list = list.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Millisekunden als mm:ss
function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return mm + ':' + ss;
}

// Abbildungen vergrößern (kleine Tafelzeichen 2,5x, größere 1,5x)
function scaleImg(img) {
  const factor = img.naturalWidth < 100 ? 2.5 : 1.5;
  const width  = Math.min(img.naturalWidth * factor, img.parentNode.clientWidth);
  img.style.width = width + 'px';
}


/* ==========================================================
   LERNFORTSCHRITT (wird im Browser gespeichert)
   Pro Frage: r = Anzahl richtig, w = Anzahl falsch,
              l = letztes Ergebnis ('r' oder 'w')
   ========================================================== */

let progress = {};
try {
  progress = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
} catch (e) {}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (e) {}
}

// Ergebnis einer Frage festhalten
function recordResult(questionId, correct) {
  const s = progress[questionId] || { r: 0, w: 0 };
  if (correct) s.r++; else s.w++;
  s.l = correct ? 'r' : 'w';
  progress[questionId] = s;
}

const lastResult = q => progress[q.id] && progress[q.id].l;

// Sortierwert für den Übungsmodus: Falsche und neue Fragen zuerst
const priority = q => (!progress[q.id] || lastResult(q) === 'w') ? 0 : 1;


/* ==========================================================
   ZUSTAND DER AKTUELLEN SITZUNG
   S = null          -> Startseite
   S = { mode, items, i, done, ... }
   mode: 'ueben' oder 'pruefung'
   Nur Prüfung: exam (Einstellungen), deadline (Ablaufzeit),
                timedOut (Zeit abgelaufen?), timerId
   ========================================================== */

let S = null;

// Auswahl der Fragen für die Prüfung (Haken auf der Startseite).
// Beide aus = alle Fragen wie bisher. wrong = nur falsch beantwortete,
// open = nur unbeantwortete. Beide an = falsche und unbeantwortete zusammen.
const examFilter = { wrong: false, open: false };

const isFiltered = () => examFilter.wrong || examFilter.open;

function filterText() {
  if (examFilter.wrong && examFilter.open) return 'Nur falsch beantwortete und unbeantwortete Fragen';
  if (examFilter.wrong) return 'Nur falsch beantwortete Fragen';
  if (examFilter.open)  return 'Nur unbeantwortete Fragen';
  return '';
}

// Passt eine Frage zur gewählten Auswahl?
function matchesFilter(q) {
  if (!isFiltered()) return true;
  return (examFilter.wrong && lastResult(q) === 'w') ||
         (examFilter.open  && !progress[q.id]);
}

// Plant eine Prüfung: Wie viele Fragen gibt es wirklich, und wie viel Zeit?
// Gibt es weniger passende Fragen als vorgesehen, werden Fragenzahl und Zeit
// entsprechend verkürzt (Zeit anteilig, aufgerundet).
function planExam(key) {
  const exam = EXAMS[key];
  const parts = exam.parts.map(part => {
    const pool = Q.filter(q => part.cats.includes(q.k) && matchesFilter(q));
    return { part, pool, n: Math.min(part.n, pool.length) };
  });
  const count = parts.reduce((sum, p) => sum + p.n, 0);
  const regular = exam.parts.reduce((sum, p) => sum + p.n, 0);
  const minutes = count === regular
    ? exam.minutes
    : Math.max(1, Math.ceil(exam.minutes * count / regular));
  return { exam, parts, count, regular, minutes };
}

// Eine Frage mit zufälliger Antwortreihenfolge vorbereiten.
// order[k] = Index der Antwort an Position k (Index 0 ist die richtige).
// part = Name des Prüfungsteils (nur in der Prüfung gesetzt).
function makeItem(q, part) {
  return { q, part, order: shuffle([0, 1, 2, 3]), pick: null };
}

const isCorrect = item => item.pick !== null && item.order[item.pick] === 0;

function startPractice(pool) {
  const list = shuffle(pool).sort((a, b) => priority(a) - priority(b));
  S = { mode: 'ueben', items: list.map(makeItem), i: 0 };
  render();
}

function startExam(key) {
  const plan = planExam(key);
  if (plan.count === 0) return;

  const items = [];
  plan.parts.forEach(({ part, pool, n }) => {
    shuffle(pool).slice(0, n).forEach(q => items.push(makeItem(q, part.name)));
  });

  S = {
    mode: 'pruefung',
    exam: { ...plan.exam, minutes: plan.minutes },
    filterNote: filterText(),
    items,
    i: 0,
    startedAt: Date.now(),
    deadline: Date.now() + plan.minutes * 60000
  };
  startTimer();
  render();
}

// ----- Countdown für die Prüfung -----
// Die Restzeit wird aus der Ablaufzeit berechnet, daher stimmt sie auch,
// wenn der Tab zwischendurch im Hintergrund war.
function startTimer() {
  stopTimer();
  S.timerId = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (S && S.timerId) {
    clearInterval(S.timerId);
    S.timerId = null;
  }
}

function updateTimer() {
  if (!S || S.done || !S.deadline) return;
  const left = S.deadline - Date.now();

  const el = document.getElementById('timer');
  if (el) {
    el.textContent = formatTime(left);
    el.classList.toggle('warn', left <= 2 * 60000);   // letzte 2 Minuten rot
  }

  if (left <= 0) {            // Zeit abgelaufen: Prüfung automatisch abgeben
    S.timedOut = true;
    finish();
  }
}

function answer(position) {
  const item = S.items[S.i];
  if (item.pick !== null) return;          // schon beantwortet
  item.pick = position;

  if (S.mode === 'ueben') {
    recordResult(item.q.id, isCorrect(item));
    saveProgress();
  }

  // Prüfung: direkt weiter, kein Feedback
  if (S.mode === 'pruefung') next(); else render();
}

function next() {
  if (S.i < S.items.length - 1) {
    S.i++;
    render();
  } else {
    finish();
  }
}

function finish() {
  stopTimer();
  S.finishedAt = Date.now();

  // Prüfung: Ergebnisse erst jetzt in den Lernfortschritt übernehmen
  if (S.mode === 'pruefung') {
    S.items.forEach(item => {
      if (item.pick !== null) recordResult(item.q.id, isCorrect(item));
    });
  }
  saveProgress();
  S.done = true;
  render();
}


/* ==========================================================
   ANSICHTEN
   ========================================================== */

// ----- Startseite -----
function renderHome() {
  const total = Q.length;
  const good  = Q.filter(q => lastResult(q) === 'r').length;
  const bad   = Q.filter(q => lastResult(q) === 'w').length;
  const open  = total - good - bad;
  const countIn = k => Q.filter(q => q.k === k).length;
  const plans = Object.keys(EXAMS).map(key => ({ key, ...planExam(key) }));

  app.innerHTML = `
    <h1>Sportbootführerschein Binnen</h1>
    <p class="sub">Fragenkatalog ab 01.08.2023, ${total} Fragen</p>

    <div class="bar" role="img"
         aria-label="${good} richtig, ${bad} falsch, ${open} offen">
      <i class="g" style="width:${good / total * 100}%"></i>
      <i class="r" style="width:${bad / total * 100}%"></i>
    </div>
    <p class="legend">
      <span>${good} sicher</span>
      <span>${bad} zu wiederholen</span>
      <span>${open} offen</span>
    </p>

    <fieldset class="filter">
      <legend>Fragen für die Prüfung</legend>
      <label>
        <input type="checkbox" data-f="wrong" ${examFilter.wrong ? 'checked' : ''}>
        <span>Nur falsch beantwortete</span><small>${bad}</small>
      </label>
      <label>
        <input type="checkbox" data-f="open" ${examFilter.open ? 'checked' : ''}>
        <span>Nur unbeantwortete</span><small>${open}</small>
      </label>
      <p class="hint">Ohne Haken werden alle Fragen verwendet. Mit beiden Haken kommen
        falsche und unbeantwortete Fragen zusammen.</p>
    </fieldset>

    <div class="exams">
      ${plans.map(plan => `
        <button class="primary" data-a="exam" data-k="${plan.key}" ${plan.count ? '' : 'disabled'}>
          <span>${plan.exam.label}</span>
          <small>${plan.count ? `${plan.count} Fragen, ${plan.minutes} Minuten` : 'Keine passenden Fragen'}</small>
        </button>`).join('')}
    </div>
    ${isFiltered() && plans.some(p => p.count && p.count < p.regular) ? `
      <p class="hint">Es gibt weniger passende Fragen als vorgesehen. Fragenzahl und
        Zeit werden entsprechend verkürzt.</p>` : ''}

    <h2>Üben mit sofortiger Auswertung</h2>

    <button class="row" data-a="practice" data-k="*">
      <span>Alle Fragen</span><small>${total}</small>
    </button>

    ${CATS.map(k => `
      <button class="row" data-a="practice" data-k="${k}">
        <span>${k}</span><small>${countIn(k)}</small>
      </button>`).join('')}

    <button class="row" data-a="practice" data-k="!" ${bad ? '' : 'disabled'}>
      <span>Fehler wiederholen</span><small>${bad}</small>
    </button>

    <p class="reset">
      <button class="ghost" data-a="reset">Fortschritt zurücksetzen</button>
    </p>`;
}

// ----- Frage -----
function renderQuestion() {
  const item   = S.items[S.i];
  const q      = item.q;
  const count  = S.items.length;
  const reveal = item.pick !== null && S.mode === 'ueben';   // Feedback zeigen?

  const images = q.img.length ? `
    <div class="imgs">
      ${q.img.map(src => `
        <img src="${src}" alt="Abbildung zur Frage" onload="scaleImg(this)">`).join('')}
    </div>` : '';

  const answers = item.order.map((origIndex, pos) => {
    let cls = 'ans';
    if (reveal) {
      if (origIndex === 0)     cls += ' ok';    // richtige Antwort
      else if (pos === item.pick) cls += ' bad'; // falsch gewählt
    }
    return `
      <button class="${cls}" data-a="ans" data-o="${pos}" ${reveal ? 'disabled' : ''}>
        <b>${LETTERS[pos]}</b>
        <span>${esc(q.a[origIndex])}</span>
      </button>`;
  }).join('');

  const nextButton = reveal ? `
    <button class="primary" data-a="next">
      ${S.i < count - 1 ? 'Weiter' : 'Auswertung'}
    </button>` : '';

  const timer = S.deadline ? `
      <span id="timer" class="timer ${S.deadline - Date.now() <= 2 * 60000 ? 'warn' : ''}">
        ${formatTime(S.deadline - Date.now())}
      </span>` : '';

  app.innerHTML = `
    <div class="top">
      <span>Frage ${S.i + 1} von ${count} (Nr. ${q.id})</span>
      ${timer}
      <button class="ghost" data-a="stop">
        ${S.mode === 'pruefung' ? 'Abgeben' : 'Beenden'}
      </button>
    </div>

    <div class="prog">
      <i style="width:${(S.i + (reveal ? 1 : 0)) / count * 100}%"></i>
    </div>

    <p class="q">${esc(q.q)}</p>
    ${images}
    ${answers}
    ${nextButton}`;

  if (!reveal) window.scrollTo(0, 0);
}

// ----- Auswertung: Fragenlisten zum Nachschauen -----

// Abbildungen einer Frage (wie in der Fragen-Ansicht)
function reviewImages(q) {
  if (!q.img.length) return '';
  return `<div class="imgs">${q.img.map(src =>
    `<img src="${src}" alt="Abbildung zur Frage" onload="scaleImg(this)">`).join('')}</div>`;
}

// Eine Frage mit Antwort(en)
function reviewCard(item, isRight) {
  const q = item.q;
  const yours = isRight ? '' : (item.pick !== null
    ? `<p class="w">Deine Antwort: ${esc(q.a[item.order[item.pick]])}</p>`
    : '<p class="w">Nicht beantwortet</p>');
  return `
    <div class="rev ${isRight ? 'good' : 'wrong'}">
      <p><b>${q.id}.</b> ${esc(q.q)}</p>
      ${reviewImages(q)}
      ${yours}
      <p class="c">Richtig: ${esc(q.a[0])}</p>
    </div>`;
}

// Einklappbarer Abschnitt, standardmäßig offen
function reviewSection(title, items, isRight) {
  if (!items.length) return '';
  return `
    <details class="review" open>
      <summary>${title} (${items.length})</summary>
      ${items.map(item => reviewCard(item, isRight)).join('')}
    </details>`;
}

// ----- Auswertung -----
function renderResult() {
  // Prüfung: alle Fragen zählen. Üben: nur die beantworteten.
  const counted = S.mode === 'pruefung'
    ? S.items
    : S.items.filter(i => i.pick !== null);
  const correct = counted.filter(isCorrect).length;
  const wrong   = counted.filter(i => !isCorrect(i));

  let html = `
    <h1>${S.mode === 'pruefung' ? S.exam.label : 'Auswertung'}</h1>
    ${S.filterNote ? `<p class="sub">${S.filterNote}</p>` : ''}
    <div class="big">${correct} von ${counted.length} richtig</div>`;

  // Prüfung: Bestanden oder nicht, plus Aufschlüsselung je Teil
  if (S.mode === 'pruefung') {
    const exam     = S.exam;
    const total    = S.items.length;
    const needed   = Math.ceil(total * exam.passPct / 100);
    const passed   = correct * 100 >= exam.passPct * total;
    const used     = formatTime(Math.min(S.finishedAt, S.deadline) - S.startedAt);

    const rows = exam.parts.map(part => {
      const items = S.items.filter(i => i.part === part.name);
      if (!items.length) return '';
      return `<p>${part.name}: <b>${items.filter(isCorrect).length} von ${items.length}</b></p>`;
    }).join('');

    html += `
      <p class="${passed ? 'pass' : 'fail'}">
        <b>${passed ? 'Bestanden' : 'Nicht bestanden'}</b>
        (Zum Bestehen: mindestens ${needed} richtig, ${exam.passPct} %)
      </p>
      ${S.timedOut ? '<p class="fail">Zeit abgelaufen. Offene Fragen zählen als falsch.</p>' : ''}
      <p class="sub">Benötigte Zeit: ${used} von ${exam.minutes}:00 Minuten</p>
      ${rows}`;
  }

  // Listen zum Nachschauen: erst die falschen, dann die richtigen Fragen
  const right = counted.filter(isCorrect);

  if (!wrong.length) html += '<p class="pass">Alles richtig.</p>';

  html += reviewSection('Falsch beantwortet', wrong, false);
  html += reviewSection('Richtig beantwortet', right, true);

  html += '<button class="primary" data-a="home">Zur Übersicht</button>';
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

// Passende Ansicht anzeigen
function render() {
  if (!S)           renderHome();
  else if (S.done)  renderResult();
  else              renderQuestion();
}


/* ==========================================================
   KLICKS (alle Buttons laufen hier zusammen, Aktion steht in data-a)
   ========================================================== */

app.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button || button.disabled) return;

  const action = button.dataset.a;

  if (action === 'exam') {
    startExam(button.dataset.k);

  } else if (action === 'practice') {
    const k = button.dataset.k;
    let pool;
    if (k === '*')      pool = Q;                                           // alle
    else if (k === '!') pool = Q.filter(q => lastResult(q) === 'w');        // Fehler
    else                pool = Q.filter(q => q.k === k);                    // Kategorie
    startPractice(pool);

  } else if (action === 'ans') {
    answer(Number(button.dataset.o));

  } else if (action === 'next') {
    next();

  } else if (action === 'stop') {
    const msg = S.mode === 'pruefung'
      ? 'Prüfung jetzt abgeben? Offene Fragen zählen als falsch.'
      : 'Übung beenden?';
    if (confirm(msg)) finish();

  } else if (action === 'home') {
    S = null;
    render();

  } else if (action === 'reset') {
    if (confirm('Gesamten Lernfortschritt löschen?')) {
      progress = {};
      saveProgress();
      render();
    }
  }
});


// Haken der Fragenauswahl (Checkboxen lösen "change" aus, nicht "click")
app.addEventListener('change', e => {
  const key = e.target.dataset && e.target.dataset.f;
  if (!key) return;
  examFilter[key] = e.target.checked;
  render();
  const again = app.querySelector && app.querySelector(`[data-f="${key}"]`);
  if (again) again.focus();                 // Tastatur-Fokus behalten
});


/* ==========================================================
   START
   ========================================================== */

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
