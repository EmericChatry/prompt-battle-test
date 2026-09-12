const SUPABASE_URL = 'https://cmaikgqdyjqyrtkcwhkz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aGRxie9hlojGMP1Sttz9hg_dn4XbLc-';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const ROUND_SECONDS = 330;
const challenges = [
  {
    title: "Le mail impossible",
    situation: "Vous devez annoncer un changement de planning qui entraîne des changements de poste pour plusieurs professionnels. La décision est nécessaire, mais elle risque de générer de la tension et un sentiment d’injustice.",
    mission: "Construisez un prompt RCTF permettant à votre IA de rédiger un message clair qui explique la décision, limite les tensions et préserve la confiance de l’équipe."
  },
  {
    title: "Le briefing d’équipe",
    situation: "Des tensions apparaissent dans l’équipe autour de la charge de travail et de la répartition des tâches. Plusieurs professionnels disent ne pas se sentir entendus.",
    mission: "Demandez à l’IA de préparer votre prochain briefing : objectifs, déroulé, questions à poser, points de vigilance et manière de faire émerger des solutions avec l’équipe."
  },
  {
    title: "Le boss final",
    situation: "Vous devez préparer un entretien avec un professionnel compétent et apprécié, mais dont les retards répétés ont désormais un impact sur l’organisation du service.",
    mission: "Obtenez une préparation d’entretien comprenant les objectifs, une formulation pour aborder le problème, des questions ouvertes, les réactions défensives possibles, vos réponses de manager et les pièges à éviter."
  }
];

const teamColors = ["#183f59", "#f36f32", "#f2c94c", "#a94c58", "#2f7d68", "#6c63a8", "#557785", "#d98f4e"];
const state = {
  userId: null,
  participantSession: null,
  trainerSession: null,
  teams: [],
  submissions: [],
  evaluations: [],
  reviewRound: 1,
  selectedSubmissionId: null,
  team: 1,
  teamId: null,
  currentSubmissionId: null,
  participantChannel: null,
  trainerChannel: null,
  timerInterval: null,
  lastParticipantRound: null
};

const screens = [...document.querySelectorAll('.screen')];
function showScreen(id) {
  screens.forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => showScreen(btn.dataset.go)));

function setConnectionStatus(text, mode = '') {
  const el = document.getElementById('connectionStatus');
  el.textContent = text;
  el.classList.remove('connection-ok', 'connection-error');
  if (mode === 'ok') el.classList.add('connection-ok');
  if (mode === 'error') el.classList.add('connection-error');
}

async function ensureAnonymousAuth() {
  const { data: sessionData } = await db.auth.getSession();
  if (sessionData.session?.user) {
    state.userId = sessionData.session.user.id;
    setConnectionStatus('Supabase connecté', 'ok');
    return state.userId;
  }
  const { data, error } = await db.auth.signInAnonymously();
  if (error) throw error;
  state.userId = data.user.id;
  setConnectionStatus('Supabase connecté', 'ok');
  return state.userId;
}

function makeSessionCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function displayRoundNumber(session) {
  return Math.min(3, Math.max(1, session?.current_round || 1));
}

function formatTime(totalSeconds) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timerInfo(session) {
  if (!session) return { remaining: ROUND_SECONDS, delay: 0, expired: false };
  const duration = Number(session.round_duration_seconds || ROUND_SECONDS);
  if (session.status === 'running' && session.round_started_at) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(session.round_started_at).getTime()) / 1000));
    const raw = duration - elapsed;
    return { remaining: Math.max(0, raw), delay: Math.max(0, -raw), expired: raw <= 0 };
  }
  return { remaining: Math.max(0, duration), delay: 0, expired: false };
}

function clearTimerLoop() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
}

function startTimerLoop() {
  clearTimerLoop();
  updateAllTimers();
  state.timerInterval = setInterval(updateAllTimers, 500);
}

function updateAllTimers() {
  if (state.participantSession) renderParticipantTimer();
  if (state.trainerSession) renderTrainerTimer();
}

async function createTrainerSession() {
  const button = document.getElementById('createSessionButton');
  button.disabled = true;
  button.textContent = 'Création…';
  try {
    await ensureAnonymousAuth();
    let created = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const code = makeSessionCode();
      const { data, error } = await db
        .from('sessions')
        .insert({
          session_code: code,
          created_by: state.userId,
          current_round: 0,
          status: 'waiting',
          round_duration_seconds: ROUND_SECONDS,
          round_started_at: null
        })
        .select()
        .single();
      if (!error) created = data;
      else if (error.code !== '23505') throw error;
    }
    if (!created) throw new Error('Impossible de générer un code de session unique.');
    state.trainerSession = created;
    state.reviewRound = 1;
    state.selectedSubmissionId = null;
    renderTrainerSession();
    await refreshTrainerData();
    subscribeTrainer(created.id);
    startTimerLoop();
  } catch (error) {
    console.error(error);
    alert(`Impossible de créer la session : ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Créer une nouvelle session';
  }
}

function renderTrainerSession() {
  if (!state.trainerSession) return;
  document.getElementById('trainerSessionTitle').textContent = 'Session active';
  document.getElementById('trainerSessionHelp').textContent = 'Affichez ce code aux participants. Vous gardez la main sur les manches et le chrono commun.';
  document.getElementById('trainerSessionCode').textContent = state.trainerSession.session_code;
  document.getElementById('sessionCodeCard').classList.remove('hidden');
  renderTrainerControls();
}

async function joinSessionByCode() {
  const input = document.getElementById('sessionCodeInput');
  const feedback = document.getElementById('joinFeedback');
  const code = input.value.trim().toUpperCase();
  input.value = code;
  feedback.className = 'form-feedback';
  if (code.length !== 6) {
    feedback.textContent = 'Saisissez le code à 6 caractères affiché par le formateur.';
    feedback.classList.add('error');
    return;
  }
  try {
    await ensureAnonymousAuth();
    const { data, error } = await db.from('sessions').select('*').eq('session_code', code).maybeSingle();
    if (error) throw error;
    if (!data) {
      feedback.textContent = 'Aucune session ne correspond à ce code.';
      feedback.classList.add('error');
      document.getElementById('teamSelectionBlock').classList.add('hidden');
      return;
    }
    state.participantSession = data;
    state.lastParticipantRound = data.current_round;
    document.getElementById('participantSessionCode').textContent = data.session_code;
    renderParticipantRankingAvailability();
    feedback.textContent = 'Session trouvée. Choisissez maintenant votre équipe.';
    feedback.classList.add('success');
    document.getElementById('teamSelectionBlock').classList.remove('hidden');
    await loadParticipantTeams();
    subscribeParticipant(data.id);
    startTimerLoop();
  } catch (error) {
    console.error(error);
    feedback.textContent = `Connexion impossible : ${error.message}`;
    feedback.classList.add('error');
  }
}

async function fetchTeams(sessionId) {
  const { data, error } = await db.from('teams').select('*').eq('session_id', sessionId).order('team_slot');
  if (error) throw error;
  return data || [];
}

async function fetchSubmissions(sessionId) {
  const { data, error } = await db.from('submissions').select('*').eq('session_id', sessionId).order('created_at');
  if (error) throw error;
  return data || [];
}

async function fetchEvaluations(sessionId) {
  const { data, error } = await db.from('trainer_evaluations').select('*').eq('session_id', sessionId).order('round_number').order('evaluated_at');
  if (error) throw error;
  return data || [];
}

async function loadParticipantTeams() {
  if (!state.participantSession) return;
  state.teams = await fetchTeams(state.participantSession.id);
  const mine = state.teams.find(t => t.owner_user_id === state.userId);
  if (mine) {
    state.team = mine.team_slot;
    state.teamId = mine.id;
  }
  buildParticipantTeams();
}

async function refreshTrainerData() {
  if (!state.trainerSession) return;
  const [teams, submissions, evaluations] = await Promise.all([
    fetchTeams(state.trainerSession.id),
    fetchSubmissions(state.trainerSession.id),
    fetchEvaluations(state.trainerSession.id)
  ]);
  state.teams = teams;
  state.submissions = submissions;
  state.evaluations = evaluations;
  if (!state.reviewRound) state.reviewRound = displayRoundNumber(state.trainerSession);
  buildTrainerTeams();
  renderReviewList();
  renderLeaderboard();
  renderRankingPublicationState();
  renderTrainerControls();
}

function buildParticipantTeams() {
  const grid = document.getElementById('teamGrid');
  grid.innerHTML = '';
  for (let i = 1; i <= 8; i++) {
    const existing = state.teams.find(t => t.team_slot === i);
    const isMine = existing?.owner_user_id === state.userId;
    const occupied = Boolean(existing) && !isMine;
    const btn = document.createElement('button');
    btn.className = `team-card${occupied ? ' occupied' : ''}${isMine ? ' mine' : ''}`;
    btn.type = 'button';
    btn.disabled = occupied;
    btn.style.setProperty('--team-color', teamColors[i - 1]);
    const hint = isMine ? 'Votre équipe — ouvrir' : occupied ? 'Déjà occupée' : 'Appuyez pour rejoindre';
    const statusClass = isMine ? 'mine' : occupied ? 'taken' : 'free';
    btn.innerHTML = `
      <div class="team-main"><span class="team-dot"></span><strong>Équipe ${i}</strong></div>
      <small class="team-hint">${hint}</small>
      <span class="team-status ${statusClass}">${isMine ? '✓ Réservée pour vous' : occupied ? 'Indisponible' : 'Libre'}</span>`;
    btn.addEventListener('click', () => reserveTeam(i, existing));
    grid.appendChild(btn);
  }
}

async function reserveTeam(slot, existing) {
  if (!state.participantSession) return;
  if (existing?.owner_user_id === state.userId) {
    state.team = slot;
    state.teamId = existing.id;
    await openBattle();
    return;
  }
  const alreadyMine = state.teams.find(t => t.owner_user_id === state.userId);
  if (alreadyMine) {
    alert(`Vous avez déjà rejoint l’Équipe ${alreadyMine.team_slot}.`);
    return;
  }
  try {
    const { data, error } = await db.from('teams').insert({
      session_id: state.participantSession.id,
      team_slot: slot,
      team_name: `Équipe ${slot}`,
      team_color: teamColors[slot - 1],
      owner_user_id: state.userId
    }).select().single();
    if (error) {
      if (error.code === '23505') {
        alert('Cette équipe vient d’être prise par un autre participant. Choisissez-en une autre.');
        await loadParticipantTeams();
        return;
      }
      throw error;
    }
    state.team = slot;
    state.teamId = data.id;
    await loadParticipantTeams();
    await openBattle();
  } catch (error) {
    console.error(error);
    alert(`Impossible de rejoindre l’équipe : ${error.message}`);
  }
}

async function openBattle() {
  document.getElementById('currentTeamBadge').textContent = `Équipe ${state.team}`;
  await loadParticipantRound();
  showScreen('battle');
}

async function refreshParticipantSession() {
  if (!state.participantSession) return;
  const { data, error } = await db.from('sessions').select('*').eq('id', state.participantSession.id).single();
  if (error) throw error;
  const previousRound = state.participantSession.current_round;
  state.participantSession = data;
  if (state.teamId && previousRound !== data.current_round) {
    await loadParticipantRound(true);
    showScreen('battle');
  } else {
    renderParticipantRoundState();
  }
}

async function loadParticipantRound(force = false) {
  if (!state.participantSession || !state.teamId) return;
  const roundNumber = displayRoundNumber(state.participantSession);
  const index = roundNumber - 1;
  const c = challenges[index];
  document.getElementById('roundLabel').textContent = `MANCHE ${roundNumber} / 3`;
  document.getElementById('challengeTitle').textContent = c.title;
  document.getElementById('challengeSituation').textContent = c.situation;
  document.getElementById('challengeMission').textContent = c.mission;

  const { data, error } = await db
    .from('submissions')
    .select('*')
    .eq('session_id', state.participantSession.id)
    .eq('team_id', state.teamId)
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (error) throw error;

  state.currentSubmissionId = data?.id || null;
  if (force || document.getElementById('activeRoundNumber').value !== String(roundNumber)) {
    document.getElementById('promptInput').value = data?.prompt_text || '';
    document.getElementById('resultInput').value = data?.ai_response_text || '';
  }
  document.getElementById('activeRoundNumber').value = String(roundNumber);
  document.getElementById('saveState').textContent = data?.submitted_at ? submissionStatusText(data) : 'Non soumis';
  renderParticipantRoundState(data);
}

function renderParticipantRoundState(existingSubmission = null) {
  if (!state.participantSession) return;
  const session = state.participantSession;
  const roundNumber = displayRoundNumber(session);
  const isBeforeFirstLaunch = session.current_round === 0;
  const waiting = session.status === 'waiting';
  const paused = session.status === 'paused';
  const finished = session.status === 'finished';
  const running = session.status === 'running';

  const statusBox = document.getElementById('participantRoundStatus');
  const promptInput = document.getElementById('promptInput');
  const resultInput = document.getElementById('resultInput');
  const submit = document.getElementById('submitRound');

  if (finished) {
    statusBox.className = 'round-status finished';
    statusBox.textContent = 'Battle terminée — le formateur peut maintenant lancer le débrief.';
    promptInput.disabled = true;
    resultInput.disabled = true;
    submit.disabled = true;
    submit.textContent = 'Battle terminée';
    renderParticipantRankingAvailability();
    return;
  }

  if (isBeforeFirstLaunch || waiting) {
    statusBox.className = 'round-status waiting';
    statusBox.textContent = `Manche ${roundNumber} prête. Attendez le lancement du formateur.`;
    promptInput.disabled = true;
    resultInput.disabled = true;
    submit.disabled = true;
    submit.textContent = 'En attente du lancement';
  } else if (paused) {
    statusBox.className = 'round-status paused';
    statusBox.textContent = 'Chrono en pause par le formateur. Vous pouvez continuer à préparer votre réponse.';
    promptInput.disabled = false;
    resultInput.disabled = false;
    submit.disabled = false;
    submit.textContent = 'Soumettre la manche';
  } else if (running) {
    statusBox.className = 'round-status running';
    statusBox.textContent = 'Manche en cours — le chrono est commun à toutes les équipes.';
    promptInput.disabled = false;
    resultInput.disabled = false;
    submit.disabled = false;
  }
  renderParticipantTimer();
}

function renderParticipantTimer() {
  if (!state.participantSession) return;
  const info = timerInfo(state.participantSession);
  const timer = document.getElementById('timer');
  const message = document.getElementById('timerMessage');
  const submit = document.getElementById('submitRound');
  timer.textContent = formatTime(info.remaining);
  timer.parentElement.classList.toggle('expired', info.expired);

  if (state.participantSession.status === 'running') {
    if (info.expired) {
      message.textContent = `Temps écoulé · +${formatTime(info.delay)}`;
      if (!submit.disabled) submit.textContent = 'Soumettre hors délai';
    } else {
      message.textContent = 'Chrono lancé par le formateur.';
      if (!submit.disabled) submit.textContent = 'Soumettre la manche';
    }
  } else if (state.participantSession.status === 'paused') {
    message.textContent = 'Chrono en pause.';
  } else if (state.participantSession.status === 'finished') {
    message.textContent = 'Battle terminée.';
  } else {
    message.textContent = 'Le formateur lancera le chrono.';
  }
}

function submissionStatusText(submission) {
  if (!submission?.submitted_at) return 'Non soumis';
  const delay = Number(submission.delay_seconds || 0);
  return delay > 0 ? `✓ Soumis hors délai (+${formatTime(delay)})` : '✓ Soumis dans le temps';
}

async function submitCurrentRound() {
  if (!state.participantSession || !state.teamId) return;
  const prompt = document.getElementById('promptInput').value.trim();
  const aiResponse = document.getElementById('resultInput').value.trim();
  if (!prompt) {
    alert('Ajoutez au moins votre prompt avant de soumettre la manche.');
    return;
  }
  if (!['running', 'paused'].includes(state.participantSession.status)) {
    alert('La manche n’est pas encore ouverte par le formateur.');
    return;
  }

  const roundNumber = displayRoundNumber(state.participantSession);
  const info = timerInfo(state.participantSession);
  const delaySeconds = state.participantSession.status === 'running' ? info.delay : 0;
  const payload = {
    session_id: state.participantSession.id,
    team_id: state.teamId,
    round_number: roundNumber,
    prompt_text: prompt,
    ai_response_text: aiResponse,
    submitted_at: new Date().toISOString(),
    delay_seconds: delaySeconds
  };

  const button = document.getElementById('submitRound');
  button.disabled = true;
  button.textContent = 'Envoi…';
  try {
    let result;
    if (state.currentSubmissionId) {
      result = await db.from('submissions').update(payload).eq('id', state.currentSubmissionId).select().single();
    } else {
      result = await db.from('submissions').insert(payload).select().single();
    }
    if (result.error) throw result.error;
    state.currentSubmissionId = result.data.id;
    document.getElementById('saveState').textContent = submissionStatusText(result.data);
    buildScores(result.data.self_score);
    showScreen('selfcheck');
  } catch (error) {
    console.error(error);
    alert(`Impossible d’enregistrer la réponse : ${error.message}`);
  } finally {
    button.disabled = false;
    renderParticipantRoundState();
  }
}

const scoreItems = [
  ["Pertinence", "Le résultat répond-il réellement au problème posé ?"],
  ["Précision", "La demande limite-t-elle les réponses vagues ou génériques ?"],
  ["Contexte", "Les informations données permettent-elles une réponse adaptée ?"],
  ["Utilité managériale", "Pourriez-vous réellement vous appuyer sur ce résultat ?"]
];

function buildScores(existingTotal = null) {
  const grid = document.getElementById('scoreGrid');
  const defaults = existingTotal ? distributeScore(existingTotal) : [3,3,3,3];
  grid.innerHTML = scoreItems.map((item, index) => `
    <article class="score-card">
      <h3>${item[0]}</h3><p>${item[1]}</p>
      <select class="score-select" aria-label="${item[0]}">
        ${[1,2,3,4,5].map(n => `<option value="${n}" ${n === defaults[index] ? 'selected' : ''}>${n} / 5</option>`).join('')}
      </select>
    </article>`).join('');
  document.querySelectorAll('.score-select').forEach(s => s.addEventListener('change', updateTotal));
  updateTotal();
}

function distributeScore(total) {
  const target = Math.min(20, Math.max(4, Number(total)));
  const arr = [1,1,1,1];
  let remaining = target - 4;
  let i = 0;
  while (remaining > 0) {
    if (arr[i] < 5) { arr[i]++; remaining--; }
    i = (i + 1) % 4;
  }
  return arr;
}

function updateTotal() {
  const total = [...document.querySelectorAll('.score-select')].reduce((sum, el) => sum + Number(el.value), 0);
  document.getElementById('selfTotal').textContent = total;
}

async function saveSelfScore() {
  if (!state.currentSubmissionId) return;
  const total = [...document.querySelectorAll('.score-select')].reduce((sum, el) => sum + Number(el.value), 0);
  const button = document.getElementById('nextRound');
  button.disabled = true;
  button.textContent = 'Enregistrement…';
  try {
    const { error } = await db.from('submissions').update({ self_score: total }).eq('id', state.currentSubmissionId);
    if (error) throw error;
    document.getElementById('selfcheckWaiting').classList.remove('hidden');
    button.textContent = 'Autoévaluation enregistrée ✓';
    showScreen('battle');
    document.getElementById('saveState').textContent = `✓ Soumis · autoévaluation ${total}/20`;
  } catch (error) {
    console.error(error);
    alert(`Impossible d’enregistrer l’autoévaluation : ${error.message}`);
    button.disabled = false;
    button.textContent = 'Valider mon autoévaluation';
  }
}

function buildTrainerTeams() {
  const trainer = document.getElementById('trainerTeams');
  trainer.innerHTML = '';
  const teams = state.trainerSession ? state.teams : [];
  const roundNumber = state.trainerSession ? displayRoundNumber(state.trainerSession) : 1;

  for (let i = 1; i <= 8; i++) {
    const existing = teams.find(t => t.team_slot === i);
    const submission = existing ? state.submissions.find(s => s.team_id === existing.id && s.round_number === roundNumber) : null;
    const evaluation = submission ? state.evaluations.find(e => e.submission_id === submission.id) : null;
    const row = document.createElement('div');
    row.className = 'trainer-team';
    let statusText = existing ? 'Connectée · en cours' : 'En attente';
    let statusClass = existing ? 'state-live' : 'state-wait';
    if (submission?.submitted_at) {
      const delay = Number(submission.delay_seconds || 0);
      statusText = delay > 0 ? `Soumis · +${formatTime(delay)}` : 'Soumis ✓';
      statusClass = delay > 0 ? 'state-late' : 'state-done';
      if (evaluation) statusText += ` · ${evaluation.total}/20`;
    }
    const actions = submission?.submitted_at
      ? `<div class="team-actions"><span class="${statusClass}">${statusText}</span><button class="tiny review-button" type="button" data-review-submission="${submission.id}">Voir / noter</button></div>`
      : `<span class="${statusClass}">${statusText}</span>`;
    row.innerHTML = `<span><i class="team-dot" style="background:${teamColors[i - 1]}"></i>Équipe ${i}</span>${actions}`;
    trainer.appendChild(row);
  }

  trainer.querySelectorAll('[data-review-submission]').forEach(btn => btn.addEventListener('click', () => {
    const submission = state.submissions.find(s => s.id === btn.dataset.reviewSubmission);
    if (!submission) return;
    state.reviewRound = submission.round_number;
    state.selectedSubmissionId = submission.id;
    syncReviewTabs();
    renderReviewList();
    renderReviewDetail(submission.id);
    document.querySelector('.review-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  document.getElementById('connectedTeamsCount').textContent = teams.length;
  document.getElementById('connectedTeamsLabel').textContent = state.trainerSession ? 'connectées à cette session' : 'en attente d’une session';
  const submittedCount = state.submissions.filter(s => s.round_number === roundNumber && s.submitted_at).length;
  document.getElementById('submittedTeamsCount').textContent = submittedCount;
}

function syncReviewTabs() {
  document.querySelectorAll('[data-review-round]').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.reviewRound) === Number(state.reviewRound));
  });
}

function renderReviewList() {
  const list = document.getElementById('reviewSubmissionList');
  if (!list) return;
  syncReviewTabs();
  const round = Number(state.reviewRound || 1);
  const submissions = state.submissions
    .filter(s => s.round_number === round && s.submitted_at)
    .sort((a, b) => {
      const ta = state.teams.find(t => t.id === a.team_id)?.team_slot || 99;
      const tb = state.teams.find(t => t.id === b.team_id)?.team_slot || 99;
      return ta - tb;
    });
  if (!submissions.length) {
    list.innerHTML = '<p class="muted">Aucune production soumise pour cette manche.</p>';
    if (!state.selectedSubmissionId || !state.submissions.some(s => s.id === state.selectedSubmissionId && s.round_number === round)) {
      state.selectedSubmissionId = null;
      renderReviewDetail(null);
    }
    return;
  }
  list.innerHTML = submissions.map(sub => {
    const team = state.teams.find(t => t.id === sub.team_id);
    const evaluation = state.evaluations.find(e => e.submission_id === sub.id);
    const delay = Number(sub.delay_seconds || 0);
    return `<button class="review-list-item ${state.selectedSubmissionId === sub.id ? 'active' : ''}" type="button" data-review-id="${sub.id}">
      <span><span class="review-team-name"><i class="team-dot" style="background:${teamColors[(team?.team_slot || 1) - 1]}"></i>${team?.team_name || 'Équipe'}</span><small>${delay > 0 ? `Hors délai +${formatTime(delay)}` : 'Dans le temps'} · autoéval. ${sub.self_score ?? '—'}/20</small></span>
      <span class="review-score-chip">${evaluation ? `${evaluation.total}/20` : 'À noter'}</span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-review-id]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedSubmissionId = btn.dataset.reviewId;
    renderReviewList();
    renderReviewDetail(btn.dataset.reviewId);
  }));
  if (state.selectedSubmissionId && submissions.some(s => s.id === state.selectedSubmissionId)) renderReviewDetail(state.selectedSubmissionId);
}

function evaluationTotalFromInputs() {
  return [...document.querySelectorAll('.trainer-eval-select')].reduce((sum, el) => sum + Number(el.value), 0);
}

function updateTrainerEvalTotal() {
  const el = document.getElementById('trainerEvalTotal');
  if (el) el.textContent = evaluationTotalFromInputs();
}

function renderReviewDetail(submissionId) {
  const detail = document.getElementById('reviewDetail');
  if (!detail) return;
  const sub = state.submissions.find(s => s.id === submissionId);
  if (!sub) {
    detail.innerHTML = '<div class="empty-review"><strong>Sélectionnez une équipe</strong><span>Vous pourrez lire son prompt, sa réponse IA et attribuer une note sur 20.</span></div>';
    return;
  }
  const team = state.teams.find(t => t.id === sub.team_id);
  const evaluation = state.evaluations.find(e => e.submission_id === sub.id);
  const values = evaluation ? [evaluation.pertinence, evaluation.precision, evaluation.context_score, evaluation.utility] : [3,3,3,3];
  const criteria = [
    ['Pertinence', 'Le résultat répond-il réellement au problème posé ?'],
    ['Précision', 'Le résultat est-il suffisamment ciblé, concret et peu générique ?'],
    ['Contexte', 'Le résultat exploite-t-il correctement les éléments de contexte fournis ?'],
    ['Utilité managériale', 'Le manager pourrait-il réellement utiliser ou adapter cette production ?']
  ];
  const delay = Number(sub.delay_seconds || 0);
  detail.innerHTML = `<div class="review-production">
    <div class="review-meta"><div><p class="panel-label">MANCHE ${sub.round_number} · ${challenges[sub.round_number - 1].title.toUpperCase()}</p><h3>${team?.team_name || 'Équipe'}</h3></div><span class="review-self">Autoévaluation : ${sub.self_score ?? '—'}/20 · ${delay > 0 ? `+${formatTime(delay)}` : 'dans le temps'}</span></div>
    <div class="production-block"><p class="panel-label">PROMPT</p><p>${escapeHtml(sub.prompt_text || '—')}</p></div>
    <div class="production-block"><p class="panel-label">RÉSULTAT IA</p><p>${escapeHtml(sub.ai_response_text || 'Aucun résultat IA déposé.')}</p></div>
    <div class="evaluation-grid">
      ${criteria.map((c, i) => `<div class="eval-card"><label>${c[0]}</label><small>${c[1]}</small><select class="trainer-eval-select" data-criterion="${i}">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === Number(values[i]) ? 'selected' : ''}>${n} / 5</option>`).join('')}</select></div>`).join('')}
    </div>
    <div class="evaluation-footer"><div class="trainer-score-total"><span>Note formateur</span><strong id="trainerEvalTotal">${values.reduce((a,b)=>a+Number(b),0)}</strong><small>/20</small></div><div class="eval-actions"><button class="secondary" type="button" id="projectSubmissionButton">Afficher en grand</button><button class="primary" type="button" id="saveTrainerEvaluation">${evaluation ? 'Mettre à jour la note' : 'Enregistrer la note'}</button></div></div>
  </div>`;
  detail.querySelectorAll('.trainer-eval-select').forEach(el => el.addEventListener('change', updateTrainerEvalTotal));
  document.getElementById('saveTrainerEvaluation').addEventListener('click', () => saveTrainerEvaluation(sub.id));
  document.getElementById('projectSubmissionButton').addEventListener('click', () => showProjection(sub.id));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

async function saveTrainerEvaluation(submissionId) {
  const sub = state.submissions.find(s => s.id === submissionId);
  if (!sub || !state.trainerSession) return;
  const values = [...document.querySelectorAll('.trainer-eval-select')].map(el => Number(el.value));
  if (values.length !== 4) return;
  const payload = {
    session_id: state.trainerSession.id,
    submission_id: sub.id,
    team_id: sub.team_id,
    round_number: sub.round_number,
    pertinence: values[0],
    precision: values[1],
    context_score: values[2],
    utility: values[3],
    evaluated_by: state.userId,
    evaluated_at: new Date().toISOString()
  };
  const button = document.getElementById('saveTrainerEvaluation');
  button.disabled = true;
  button.textContent = 'Enregistrement…';
  try {
    const existing = state.evaluations.find(e => e.submission_id === sub.id);
    const result = existing
      ? await db.from('trainer_evaluations').update(payload).eq('id', existing.id).select().single()
      : await db.from('trainer_evaluations').insert(payload).select().single();
    if (result.error) throw result.error;
    await refreshTrainerData();
    state.selectedSubmissionId = sub.id;
    renderReviewList();
    renderReviewDetail(sub.id);
  } catch (error) {
    console.error(error);
    alert(`Impossible d’enregistrer la note : ${error.message}`);
    button.disabled = false;
    button.textContent = 'Enregistrer la note';
  }
}

function cumulativeRanking() {
  return state.teams.map(team => {
    const evals = state.evaluations.filter(e => e.team_id === team.id);
    const total = evals.reduce((sum, e) => sum + Number(e.total || 0), 0);
    const rounds = evals.length;
    return { team, total, rounds };
  }).filter(item => item.rounds > 0).sort((a, b) => b.total - a.total || b.rounds - a.rounds || a.team.team_slot - b.team.team_slot);
}

function renderLeaderboard() {
  const board = document.getElementById('leaderboard');
  if (!board) return;
  const ranking = cumulativeRanking();
  if (!ranking.length) {
    board.innerHTML = '<p class="muted">Le classement apparaîtra dès qu’une première production sera notée.</p>';
    return;
  }
  board.innerHTML = ranking.map((item, index) => `<div class="leader-row"><strong>${index + 1}</strong><span>${escapeHtml(item.team.team_name)}<span class="leader-detail">${item.rounds}/3 manche${item.rounds > 1 ? 's' : ''} notée${item.rounds > 1 ? 's' : ''}</span></span><span>${item.total}/${item.rounds * 20}</span></div>`).join('');
}

function renderRankingPublicationState() {
  const button = document.getElementById('publishRanking');
  const note = document.getElementById('rankingPublicationNote');
  if (!button || !state.trainerSession) return;
  const published = Boolean(state.trainerSession.ranking_published);
  button.textContent = published ? 'Masquer' : 'Publier';
  button.classList.toggle('published', published);
  if (note) note.textContent = published ? 'Classement publié : les participants peuvent désormais le consulter.' : 'Le classement est visible uniquement par le formateur tant qu’il n’est pas publié.';
}

async function toggleRankingPublication() {
  if (!state.trainerSession) return;
  try {
    await updateTrainerSession({ ranking_published: !Boolean(state.trainerSession.ranking_published) });
  } catch (error) {
    console.error(error);
    alert(`Impossible de modifier la publication : ${error.message}`);
  }
}

function showProjection(submissionId) {
  const sub = state.submissions.find(s => s.id === submissionId);
  if (!sub) return;
  const team = state.teams.find(t => t.id === sub.team_id);
  const evaluation = state.evaluations.find(e => e.submission_id === sub.id);
  document.getElementById('projectionRoundLabel').textContent = `MANCHE ${sub.round_number} · ${challenges[sub.round_number - 1].title}`;
  document.getElementById('projectionTeamTitle').textContent = team?.team_name || 'Production';
  document.getElementById('projectionPrompt').textContent = sub.prompt_text || '—';
  document.getElementById('projectionResponse').textContent = sub.ai_response_text || 'Aucun résultat IA déposé.';
  document.getElementById('projectionScore').innerHTML = evaluation
    ? `<span>Évaluation formateur · Pertinence ${evaluation.pertinence}/5 · Précision ${evaluation.precision}/5 · Contexte ${evaluation.context_score}/5 · Utilité ${evaluation.utility}/5</span><strong>${evaluation.total}/20</strong>`
    : '<span>Production non encore notée.</span><strong>—/20</strong>';
  showScreen('projection');
}

function renderTrainerControls() {
  const session = state.trainerSession;
  const startButton = document.getElementById('startRoundButton');
  const pauseButton = document.getElementById('pauseRoundButton');
  const nextButton = document.getElementById('nextTrainerRoundButton');
  if (!session) {
    startButton.disabled = pauseButton.disabled = nextButton.disabled = true;
    return;
  }

  const roundNumber = displayRoundNumber(session);
  document.getElementById('trainerRound').textContent = `${roundNumber}/3`;
  document.getElementById('trainerRoundName').textContent = challenges[roundNumber - 1].title;
  document.getElementById('trainerControlTitle').textContent = `Manche ${roundNumber} — ${challenges[roundNumber - 1].title}`;

  if (session.status === 'running') {
    startButton.disabled = true;
    startButton.textContent = 'Manche en cours';
    pauseButton.disabled = false;
    pauseButton.textContent = '⏸ Mettre en pause';
  } else if (session.status === 'paused') {
    startButton.disabled = false;
    startButton.textContent = '▶ Reprendre';
    pauseButton.disabled = true;
  } else if (session.status === 'finished') {
    startButton.disabled = true;
    pauseButton.disabled = true;
    nextButton.disabled = true;
    startButton.textContent = 'Battle terminée';
  } else {
    startButton.disabled = false;
    startButton.textContent = `▶ Lancer la manche ${roundNumber}`;
    pauseButton.disabled = true;
  }

  nextButton.disabled = session.status === 'finished';
  nextButton.textContent = roundNumber >= 3 ? 'Terminer la battle' : `Préparer la manche ${roundNumber + 1} →`;
  renderTrainerTimer();
}

function renderTrainerTimer() {
  if (!state.trainerSession) return;
  const info = timerInfo(state.trainerSession);
  const timerText = document.getElementById('trainerTimerText');
  const statusText = document.getElementById('trainerTimerStatus');
  timerText.textContent = formatTime(info.remaining);
  document.getElementById('trainerTimerStat').textContent = formatTime(info.remaining);
  timerText.classList.toggle('late-timer', info.expired);

  if (state.trainerSession.status === 'running') {
    statusText.textContent = info.expired ? `Temps écoulé · retard +${formatTime(info.delay)}` : 'Chrono en cours sur tous les appareils';
  } else if (state.trainerSession.status === 'paused') {
    statusText.textContent = 'Chrono en pause';
  } else if (state.trainerSession.status === 'finished') {
    statusText.textContent = 'Battle terminée';
  } else {
    statusText.textContent = 'Prête à être lancée';
  }
}

async function updateTrainerSession(patch) {
  if (!state.trainerSession) return;
  const { data, error } = await db.from('sessions').update(patch).eq('id', state.trainerSession.id).select().single();
  if (error) throw error;
  state.trainerSession = data;
  renderTrainerSession();
  await refreshTrainerData();
}

async function startOrResumeRound() {
  if (!state.trainerSession) return;
  try {
    const session = state.trainerSession;
    if (session.status === 'paused') {
      await updateTrainerSession({ status: 'running', round_started_at: new Date().toISOString() });
    } else {
      const roundNumber = displayRoundNumber(session);
      await updateTrainerSession({
        current_round: roundNumber,
        status: 'running',
        round_started_at: new Date().toISOString(),
        round_duration_seconds: ROUND_SECONDS
      });
    }
  } catch (error) {
    console.error(error);
    alert(`Impossible de lancer la manche : ${error.message}`);
  }
}

async function pauseRound() {
  if (!state.trainerSession || state.trainerSession.status !== 'running') return;
  try {
    const info = timerInfo(state.trainerSession);
    await updateTrainerSession({
      status: 'paused',
      round_started_at: null,
      round_duration_seconds: info.remaining
    });
  } catch (error) {
    console.error(error);
    alert(`Impossible de mettre en pause : ${error.message}`);
  }
}

async function prepareNextRound() {
  if (!state.trainerSession) return;
  const current = displayRoundNumber(state.trainerSession);
  const confirmed = window.confirm(current >= 3
    ? 'Terminer la Prompt Battle ? Les participants verront que la battle est terminée.'
    : `Préparer la manche ${current + 1} ? Le chrono sera remis à 05:30 et les participants basculeront sur le prochain briefing.`);
  if (!confirmed) return;
  try {
    if (current >= 3) {
      await updateTrainerSession({ status: 'finished', round_started_at: null, round_duration_seconds: 0 });
    } else {
      await updateTrainerSession({
        current_round: current + 1,
        status: 'waiting',
        round_started_at: null,
        round_duration_seconds: ROUND_SECONDS
      });
    }
  } catch (error) {
    console.error(error);
    alert(`Impossible de changer de manche : ${error.message}`);
  }
}

async function openPublicRanking() {
  if (!state.participantSession?.ranking_published) {
    alert('Le classement n’est pas encore publié par le formateur.');
    return;
  }
  try {
    const [teams, evaluations] = await Promise.all([
      fetchTeams(state.participantSession.id),
      fetchEvaluations(state.participantSession.id)
    ]);
    const ranking = teams.map(team => {
      const evals = evaluations.filter(e => e.team_id === team.id);
      return { team, rounds: evals.length, total: evals.reduce((sum, e) => sum + Number(e.total || 0), 0) };
    }).filter(x => x.rounds > 0).sort((a,b) => b.total - a.total || b.rounds - a.rounds || a.team.team_slot - b.team.team_slot);
    const board = document.getElementById('publicLeaderboard');
    board.innerHTML = ranking.length ? ranking.map((item, index) => `<div class="leader-row"><strong>${index + 1}</strong><span>${escapeHtml(item.team.team_name)}<span class="leader-detail">${item.rounds}/3 manche${item.rounds > 1 ? 's' : ''} notée${item.rounds > 1 ? 's' : ''}</span></span><span>${item.total}/${item.rounds * 20}</span></div>`).join('') : '<p class="muted">Aucune note n’a encore été publiée.</p>';
    showScreen('ranking');
  } catch (error) {
    console.error(error);
    alert(`Impossible de charger le classement : ${error.message}`);
  }
}

function renderParticipantRankingAvailability() {
  const banner = document.getElementById('rankingBanner');
  if (!banner) return;
  banner.classList.toggle('hidden', !Boolean(state.participantSession?.ranking_published));
}

function subscribeParticipant(sessionId) {
  if (state.participantChannel) db.removeChannel(state.participantChannel);
  state.participantChannel = db
    .channel(`participant-${sessionId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `session_id=eq.${sessionId}` }, loadParticipantTeams)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, async payload => {
      const previousRound = state.participantSession?.current_round;
      state.participantSession = payload.new;
      renderParticipantRankingAvailability();
      if (state.teamId && previousRound !== payload.new.current_round) {
        await loadParticipantRound(true);
        showScreen('battle');
      } else {
        renderParticipantRoundState();
      }
    })
    .subscribe();
}

function subscribeTrainer(sessionId) {
  if (state.trainerChannel) db.removeChannel(state.trainerChannel);
  state.trainerChannel = db
    .channel(`trainer-${sessionId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `session_id=eq.${sessionId}` }, refreshTrainerData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `session_id=eq.${sessionId}` }, refreshTrainerData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trainer_evaluations', filter: `session_id=eq.${sessionId}` }, refreshTrainerData)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, async payload => {
      state.trainerSession = payload.new;
      renderTrainerSession();
      await refreshTrainerData();
    })
    .subscribe();
}

document.getElementById('rctfToggle').addEventListener('click', () => {
  const help = document.getElementById('rctfHelp');
  help.classList.toggle('hidden');
  document.getElementById('rctfToggle').textContent = help.classList.contains('hidden') ? 'Afficher le rappel RCTF' : 'Masquer le rappel RCTF';
});

document.getElementById('submitRound').addEventListener('click', submitCurrentRound);
document.getElementById('nextRound').addEventListener('click', saveSelfScore);
document.getElementById('startRoundButton').addEventListener('click', startOrResumeRound);
document.getElementById('pauseRoundButton').addEventListener('click', pauseRound);
document.getElementById('nextTrainerRoundButton').addEventListener('click', prepareNextRound);

document.getElementById('publishRanking').addEventListener('click', toggleRankingPublication);
document.querySelectorAll('[data-review-round]').forEach(btn => btn.addEventListener('click', () => {
  state.reviewRound = Number(btn.dataset.reviewRound);
  state.selectedSubmissionId = null;
  renderReviewList();
  renderReviewDetail(null);
}));
document.getElementById('openPublicRanking').addEventListener('click', openPublicRanking);

async function resetBattle() {
  if (!state.trainerSession) {
    alert('Aucune session active à réinitialiser.');
    return;
  }
  const confirmed = window.confirm('Réinitialiser cette session ?\n\nLes équipes et leurs productions seront supprimées, puis la session reviendra à la manche 1 en attente.');
  if (!confirmed) return;
  try {
    const { error: subError } = await db.from('submissions').delete().eq('session_id', state.trainerSession.id);
    if (subError) throw subError;
    const { error: teamError } = await db.from('teams').delete().eq('session_id', state.trainerSession.id);
    if (teamError) throw teamError;
    await updateTrainerSession({ current_round: 0, status: 'waiting', round_started_at: null, round_duration_seconds: ROUND_SECONDS, ranking_published: false });
    alert('Session remise à zéro. Le code de session reste identique.');
  } catch (error) {
    console.error(error);
    alert(`Impossible de réinitialiser la session : ${error.message}`);
  }
}

document.getElementById('resetBattle').addEventListener('click', resetBattle);
document.getElementById('createSessionButton').addEventListener('click', createTrainerSession);
document.getElementById('joinSessionButton').addEventListener('click', joinSessionByCode);
document.getElementById('sessionCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinSessionByCode(); });
document.getElementById('sessionCodeInput').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

async function init() {
  buildTrainerTeams();
  buildScores();
  startTimerLoop();
  try {
    await ensureAnonymousAuth();
  } catch (error) {
    console.error(error);
    setConnectionStatus('Connexion impossible', 'error');
  }
}

init();
