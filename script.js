const SUPABASE_URL = 'https://cmaikgqdyjqyrtkcwhkz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aGRxie9hlojGMP1Sttz9hg_dn4XbLc-';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Durée de repli si un paquet ne la fournit pas (les paquets valides la définissent pour chaque scénario).
const DEFAULT_ROUND_SECONDS = 900;
const RESTORE_WINDOW_HOURS = 10;
// Le moteur joue toujours 2 manches ; le contenu de chaque manche vient du paquet de la session (voir packs.js).
const ROUND_COUNT = PromptBattlePacks.PACK_ROUND_COUNT;
// Formation utilisée si une session ne précise pas de paquet.
const DEFAULT_PACK_ID = 'managers';

// 10 équipes maximum (groupes de 2 ou 3). La base accepte les emplacements 1 à 10 depuis supabase-v2.13.sql.
const TEAM_SLOTS = 10;
const teamColors = ["#183f59", "#f36f32", "#f2c94c", "#a94c58", "#2f7d68", "#6c63a8", "#557785", "#d98f4e", "#2e86c1", "#8d6e63"];

// Cases « Qu'avez-vous amélioré ? » de l'écran participant (clé enregistrée dans submissions.changes_made).
const CHANGE_OPTIONS = {
  role: 'Rôle précisé',
  context: 'Contexte ajouté',
  task: 'Tâche précisée',
  format: 'Format imposé',
  constraint: 'Contrainte ajoutée',
  other: 'Autre amélioration'
};
// Le moteur note toujours 4 critères de 1 à 5 par manche (colonnes de trainer_evaluations).
const CRITERIA_COUNT = 4;
// Au-delà de cette longueur, un « prompt » ressemble plus à une réponse d'IA collée par erreur.
const LONG_PROMPT_WARNING = 2500;

// ---------- Étoiles ----------

// Moyenne en étoiles (de 1 à 5) à partir du total de critères : 4 critères de 1 à 5 par manche notée.
function averageStars(total, rounds) {
  if (!rounds) return 0;
  return Number(total) / (rounds * CRITERIA_COUNT);
}

function formatStarValue(value) {
  return value.toFixed(1).replace('.', ',');
}

function starString(value) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function starsLabel(total, rounds) {
  const average = averageStars(total, rounds);
  return `${starString(average)} ${formatStarValue(average)}/5`;
}
const state = {
  userId: null,
  participantSession: null,
  trainerSession: null,
  teams: [],
  submissions: [],
  evaluations: [],
  feedback: [],
  reviewRound: 1,
  selectedSubmissionId: null,
  team: 1,
  teamId: null,
  currentSubmissionId: null,
  participantChannel: null,
  trainerChannel: null,
  timerInterval: null,
  participantSyncInterval: null,
  trainerSyncInterval: null,
  trainerSyncInProgress: false,
  trainerTransitionBusy: false,
  rankingOpenInProgress: false,
  lastParticipantRound: null,
  formRound: null,
  // Paquets de scénarios : un pour la session pilotée (formateur), un pour la session rejointe (participant).
  trainerPack: null,
  participantPack: null,
  packIndex: [],
  selectedPackId: null
};

// ---------- Paquets de scénarios ----------

function scenarioOf(pack, roundNumber) {
  return pack?.scenarios?.[roundNumber - 1] || null;
}

function scenarioTitleOf(pack, roundNumber) {
  return scenarioOf(pack, roundNumber)?.title || `Manche ${roundNumber}`;
}

function roundSecondsOf(pack, roundNumber) {
  return scenarioOf(pack, roundNumber)?.durationSeconds || DEFAULT_ROUND_SECONDS;
}

function packIdOfSession(session) {
  return session?.pack_id || DEFAULT_PACK_ID;
}

function setBrandSubtitle(pack) {
  const el = document.getElementById('brandSubtitle');
  if (el) el.textContent = pack?.title || 'Formation en santé';
}

// Affiche une erreur de paquet lisible (au lieu d'une page vide).
function showPackError(error) {
  const box = document.getElementById('packError');
  const text = document.getElementById('packErrorText');
  console.error('Erreur de paquet de scénarios', error);
  if (!box || !text) return;
  text.textContent = error?.message || String(error);
  box.classList.remove('hidden');
}

function clearPackError() {
  document.getElementById('packError')?.classList.add('hidden');
}

document.getElementById('packErrorClose')?.addEventListener('click', clearPackError);

// ---------- Choix de la formation à la création d'une session ----------

function updateCreateButton() {
  const button = document.getElementById('createSessionButton');
  if (!button) return;
  const hasChoice = Boolean(state.selectedPackId);
  button.disabled = !hasChoice;
  button.textContent = hasChoice
    ? (state.trainerSession ? 'Créer une nouvelle session' : 'Créer une session')
    : 'Choisissez d\'abord une formation';
}

function setPackPickerVisible(visible) {
  document.getElementById('packPicker')?.classList.toggle('hidden', !visible);
  if (visible) loadPackPicker();
}

function renderPackOptions() {
  const container = document.getElementById('packOptions');
  if (!container) return;
  container.innerHTML = state.packIndex.map(pack => {
    const selected = pack.id === state.selectedPackId;
    return `<button type="button" class="pack-option${selected ? ' selected' : ''}" role="radio" aria-checked="${selected}" data-pack-id="${escapeHtml(pack.id)}"><strong>${escapeHtml(pack.title)}</strong><small>${escapeHtml(pack.description)}</small></button>`;
  }).join('');
  container.querySelectorAll('[data-pack-id]').forEach(btn => btn.addEventListener('click', () => selectPack(btn.dataset.packId)));
}

async function loadPackPicker() {
  if (state.packIndex.length) {
    renderPackOptions();
    updateCreateButton();
    return;
  }
  const container = document.getElementById('packOptions');
  if (container) container.innerHTML = '<p class="muted">Chargement des formations…</p>';
  try {
    state.packIndex = await PromptBattlePacks.loadPackIndex();
    renderPackOptions();
  } catch (error) {
    if (container) container.innerHTML = '<p class="muted">Les formations ne peuvent pas être chargées.</p>';
    showPackError(error);
  }
  updateCreateButton();
}

// Le fichier du paquet est vérifié dès le choix : une erreur s'affiche tout de suite, avant toute création de session.
async function selectPack(packId) {
  state.selectedPackId = null;
  renderPackOptions();
  updateCreateButton();
  clearPackError();
  try {
    await PromptBattlePacks.loadPack(packId);
    state.selectedPackId = packId;
  } catch (error) {
    showPackError(error);
  }
  renderPackOptions();
  updateCreateButton();
}

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
  return Math.min(ROUND_COUNT, Math.max(1, session?.current_round || 1));
}

function formatTime(totalSeconds) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timerInfo(session) {
  if (!session) return { remaining: DEFAULT_ROUND_SECONDS, delay: 0, expired: false };
  const duration = Number(session.round_duration_seconds || DEFAULT_ROUND_SECONDS);
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
  if (!state.selectedPackId) {
    alert('Choisissez d\'abord la formation de cette session.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Création…';
  try {
    await ensureAnonymousAuth();
    // Le paquet est chargé et vérifié avant de créer la session : un fichier cassé ne crée rien.
    const pack = await PromptBattlePacks.loadPack(state.selectedPackId);
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
          pack_id: pack.id,
          round_duration_seconds: roundSecondsOf(pack, 1),
          round_started_at: null
        })
        .select()
        .single();
      if (!error) created = data;
      else if (error.code !== '23505') throw error;
    }
    if (!created) throw new Error('Impossible de générer un code de session unique.');
    state.trainerPack = pack;
    state.selectedPackId = null;
    state.trainerSession = created;
    state.reviewRound = 1;
    state.selectedSubmissionId = null;
    renderTrainerSession();
    await refreshTrainerData();
    subscribeTrainer(created.id);
    startTrainerSyncLoop();
    startTimerLoop();
  } catch (error) {
    if (error instanceof PromptBattlePacks.PackError) {
      showPackError(error);
    } else {
      console.error(error);
      alert(`Impossible de créer la session : ${error.message}`);
    }
  } finally {
    updateCreateButton();
  }
}

function buildParticipantJoinUrl(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('session', code);
  return url.toString();
}

function renderSessionQrCode() {
  if (!state.trainerSession) return;
  const target = document.getElementById('sessionQrCode');
  if (!target) return;
  target.innerHTML = '';
  const joinUrl = buildParticipantJoinUrl(state.trainerSession.session_code);
  if (window.QRCode) {
    new QRCode(target, {
      text: joinUrl,
      width: 190,
      height: 190,
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    target.innerHTML = '<p class="qr-error">QR code indisponible. Utilisez le code de session.</p>';
  }
}

function renderTrainerSession() {
  if (!state.trainerSession) return;
  const finished = state.trainerSession.status === 'finished';
  document.getElementById('trainerSessionTitle').textContent = finished ? 'Battle terminée' : 'Session active';
  document.getElementById('trainerSessionHelp').textContent = finished
    ? 'Cette session est terminée. Vous pouvez encore consulter ses résultats ci-dessous, ou créer une nouvelle session pour un prochain groupe.'
    : 'Envoyez le lien aux participants (idéal sur ordinateur) ou projetez le QR code : ils ouvrent directement la bonne session, puis choisissent leur équipe.';
  document.getElementById('trainerSessionCode').textContent = state.trainerSession.session_code;
  const linkInput = document.getElementById('joinLinkInput');
  if (linkInput) linkInput.value = buildParticipantJoinUrl(state.trainerSession.session_code);
  document.getElementById('sessionCodeCard').classList.remove('hidden');
  const packLine = document.getElementById('trainerSessionPack');
  if (packLine) {
    packLine.textContent = `Formation : ${state.trainerPack?.title || packIdOfSession(state.trainerSession)}`;
    packLine.classList.remove('hidden');
  }
  setBrandSubtitle(state.trainerPack);
  const createButton = document.getElementById('createSessionButton');
  createButton.classList.toggle('hidden', !finished);
  setPackPickerVisible(finished);
  updateCreateButton();
  renderSessionQrCode();
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
    const { data: rows, error } = await db.rpc('get_session_for_join', { p_code: code });
    if (error) throw error;
    const data = rows?.[0] || null;
    if (!data) {
      feedback.textContent = 'Aucune session ne correspond à ce code.';
      feedback.classList.add('error');
      document.getElementById('teamSelectionBlock').classList.add('hidden');
      return;
    }
    // Le contenu de la formation est chargé avant d'afficher le choix d'équipe.
    try {
      state.participantPack = await PromptBattlePacks.loadPack(packIdOfSession(data));
    } catch (packError) {
      if (!(packError instanceof PromptBattlePacks.PackError)) throw packError;
      showPackError(packError);
      feedback.textContent = 'Le contenu de cette formation ne peut pas être chargé. Prévenez le formateur.';
      feedback.classList.add('error');
      document.getElementById('teamSelectionBlock').classList.add('hidden');
      return;
    }
    setBrandSubtitle(state.participantPack);
    state.participantSession = data;
    state.lastParticipantRound = data.current_round;
    document.getElementById('participantSessionCode').textContent = data.session_code;
    renderParticipantRankingAvailability();
    feedback.textContent = 'Session trouvée. Choisissez maintenant votre équipe.';
    feedback.classList.add('success');
    document.getElementById('teamSelectionBlock').classList.remove('hidden');
    await loadParticipantTeams();
    subscribeParticipant(data.id);
    startParticipantSyncLoop();
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

async function fetchTeamsForJoin(sessionId) {
  const { data, error } = await db.rpc('list_teams_for_session', { p_session_id: sessionId });
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

// Retours écrits du formateur (table team_feedback). La base ne renvoie à un participant que le retour de son équipe,
// et seulement après la publication. Une erreur ne doit pas bloquer la notation : on renvoie alors une liste vide.
async function fetchFeedback(sessionId) {
  const { data, error } = await db.from('team_feedback').select('*').eq('session_id', sessionId);
  if (error) {
    console.debug('Retours indisponibles', error);
    return [];
  }
  return data || [];
}

async function loadParticipantTeams() {
  if (!state.participantSession) return;
  state.teams = await fetchTeamsForJoin(state.participantSession.id);
  const mine = state.teams.find(t => t.owner_user_id === state.userId);
  if (mine) {
    state.team = mine.team_slot;
    state.teamId = mine.id;
  }
  buildParticipantTeams();
}


async function refreshTrainerSessionState({ render = true } = {}) {
  if (!state.trainerSession?.id || state.trainerSyncInProgress) return state.trainerSession;
  state.trainerSyncInProgress = true;
  try {
    const { data, error } = await db
      .from('sessions')
      .select('*')
      .eq('id', state.trainerSession.id)
      .single();
    if (error) throw error;
    state.trainerSession = data;
    if (render) {
      renderTrainerControls();
      renderRankingPublicationState();
    }
    return data;
  } finally {
    state.trainerSyncInProgress = false;
  }
}

function stopTrainerSyncLoop() {
  if (state.trainerSyncInterval) clearInterval(state.trainerSyncInterval);
  state.trainerSyncInterval = null;
}

function startTrainerSyncLoop() {
  stopTrainerSyncLoop();
  if (!state.trainerSession?.id) return;
  state.trainerSyncInterval = setInterval(async () => {
    if (document.visibilityState !== 'visible' || state.trainerTransitionBusy) return;
    try {
      await refreshTrainerSessionState();
    } catch (error) {
      console.debug('Resynchronisation formateur différée', error);
    }
  }, 2000);
}

async function refreshTrainerData() {
  if (!state.trainerSession) return;
  const [teams, submissions, evaluations, feedback] = await Promise.all([
    fetchTeams(state.trainerSession.id),
    fetchSubmissions(state.trainerSession.id),
    fetchEvaluations(state.trainerSession.id),
    fetchFeedback(state.trainerSession.id)
  ]);
  state.teams = teams;
  state.submissions = submissions;
  state.evaluations = evaluations;
  state.feedback = feedback;
  if (!state.reviewRound) state.reviewRound = displayRoundNumber(state.trainerSession);
  buildTrainerTeams();
  renderReviewList();
  renderLeaderboard();
  renderDebriefSynthesis();
  renderRankingPublicationState();
  renderTrainerControls();
}

function buildParticipantTeams() {
  const grid = document.getElementById('teamGrid');
  grid.innerHTML = '';
  for (let i = 1; i <= TEAM_SLOTS; i++) {
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
    alert(`Vous avez déjà rejoint l\'Équipe ${alreadyMine.team_slot}.`);
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
        alert('Cette équipe vient d\'être prise par un autre participant. Choisissez-en une autre.');
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
    alert(`Impossible de rejoindre l\'équipe : ${error.message}`);
  }
}

async function openBattle() {
  document.getElementById('currentTeamBadge').textContent = `Équipe ${state.team}`;
  if (state.participantSession?.status === 'finished' || state.participantSession?.ranking_published) {
    await routeParticipantBySessionState();
    return;
  }
  await loadParticipantRound();
  showScreen('battle');
}

function clearParticipantSyncLoop() {
  if (state.participantSyncInterval) clearInterval(state.participantSyncInterval);
  state.participantSyncInterval = null;
}

function startParticipantSyncLoop() {
  clearParticipantSyncLoop();
  // Realtime reste le canal principal. En complément, le téléphone relit régulièrement
  // l'état de la session même si son état local pense encore que la manche est en cours.
  // Cela permet de récupérer une fin de battle ou une publication de classement ratée
  // après une mise en veille, un changement d'écran ou une coupure réseau mobile.
  state.participantSyncInterval = setInterval(async () => {
    if (!state.participantSession?.id || !state.teamId) return;
    try { await refreshParticipantSession(); } catch (error) { console.debug('Synchronisation participant différée', error); }
  }, 3000);
}

async function routeParticipantBySessionState({ autoOpenRanking = true } = {}) {
  if (!state.participantSession || !state.teamId) return;

  const finished = state.participantSession.status === 'finished';
  const published = Boolean(state.participantSession.ranking_published);

  renderParticipantRankingAvailability();

  if (published && autoOpenRanking) {
    await openPublicRanking(true);
    return;
  }

  if (finished) {
    const active = document.querySelector('.screen.active')?.id;
    if (active !== 'final' && active !== 'ranking') showScreen('final');
  }
}

async function refreshParticipantSession() {
  if (!state.participantSession) return;
  const { data, error } = await db.from('sessions').select('*').eq('id', state.participantSession.id).single();
  if (error) throw error;
  const previousRound = state.participantSession.current_round;
  state.participantSession = data;

  if (data.status === 'finished' || data.ranking_published) {
    await routeParticipantBySessionState();
    return;
  }

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
  const c = scenarioOf(state.participantPack, roundNumber);
  if (!c) {
    showPackError(new PromptBattlePacks.PackError(`Le scénario de la manche ${roundNumber} est introuvable. Rechargez la page ou prévenez le formateur.`));
    return;
  }
  document.getElementById('roundLabel').textContent = `MANCHE ${roundNumber} / ${ROUND_COUNT}`;
  document.getElementById('challengeTitle').textContent = c.title;
  document.getElementById('challengeSituation').textContent = c.situation;
  document.getElementById('challengeMission').textContent = c.mission;
  const materialPanel = document.getElementById('challengeMaterialPanel');
  if (materialPanel) {
    materialPanel.classList.toggle('hidden', !c.material);
    document.getElementById('challengeMaterialTitle').textContent = c.material?.title || '';
    document.getElementById('challengeMaterialText').textContent = c.material?.text || '';
  }

  const { data, error } = await db
    .from('submissions')
    .select('*')
    .eq('session_id', state.participantSession.id)
    .eq('team_id', state.teamId)
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (error) throw error;

  state.currentSubmissionId = data?.id || null;
  // Les champs sont remplis depuis la base à la première ouverture et à chaque changement de manche (pas pendant la frappe).
  if (force || state.formRound !== roundNumber) {
    document.getElementById('firstPromptInput').value = data?.first_prompt_text || '';
    document.getElementById('promptInput').value = data?.prompt_text || '';
    const savedChanges = Array.isArray(data?.changes_made) ? data.changes_made : [];
    document.querySelectorAll('#changeOptions input[type="checkbox"]').forEach(box => {
      box.checked = savedChanges.includes(box.value);
    });
    updatePromptCounters();
  }
  state.formRound = roundNumber;
  document.getElementById('activeRoundNumber').value = String(roundNumber);
  document.getElementById('saveState').textContent = data?.submitted_at ? submissionStatusText(data) : 'Non soumis';
  renderParticipantRoundState(data);
}

function setParticipantInputsDisabled(disabled) {
  document.getElementById('firstPromptInput').disabled = disabled;
  document.getElementById('promptInput').disabled = disabled;
  document.querySelectorAll('#changeOptions input[type="checkbox"]').forEach(box => { box.disabled = disabled; });
}

function updatePromptCounters() {
  [['firstPromptInput', 'firstPromptCount'], ['promptInput', 'promptCount']].forEach(([inputId, counterId]) => {
    const length = document.getElementById(inputId).value.length;
    const counter = document.getElementById(counterId);
    if (!counter) return;
    const tooLong = length > LONG_PROMPT_WARNING;
    counter.textContent = length === 0
      ? ''
      : tooLong
        ? `${length} caractères : c'est très long pour un prompt. Vérifiez que ce n'est pas la réponse de l'IA.`
        : `${length} caractères`;
    counter.classList.toggle('warning', tooLong);
  });
}

function selectedChanges() {
  return [...document.querySelectorAll('#changeOptions input[type="checkbox"]')]
    .filter(box => box.checked)
    .map(box => box.value);
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
  const submit = document.getElementById('submitRound');

  if (finished) {
    statusBox.className = 'round-status finished';
    statusBox.textContent = 'Battle terminée — le formateur peut maintenant lancer le débrief.';
    setParticipantInputsDisabled(true);
    submit.disabled = true;
    submit.textContent = 'Battle terminée';
    renderParticipantRankingAvailability();
    if (state.teamId && document.querySelector('.screen.active')?.id !== 'ranking') showScreen('final');
    return;
  }

  if (isBeforeFirstLaunch || waiting) {
    statusBox.className = 'round-status waiting';
    statusBox.textContent = `Manche ${roundNumber} prête. Attendez le lancement du formateur.`;
    setParticipantInputsDisabled(true);
    submit.disabled = true;
    submit.textContent = 'En attente du lancement';
  } else if (paused) {
    statusBox.className = 'round-status paused';
    statusBox.textContent = 'Chrono en pause par le formateur. Vous pouvez continuer à préparer votre réponse.';
    setParticipantInputsDisabled(false);
    submit.disabled = false;
    submit.textContent = 'Soumettre la manche';
  } else if (running) {
    statusBox.className = 'round-status running';
    statusBox.textContent = 'Manche en cours — le chrono est commun à toutes les équipes.';
    setParticipantInputsDisabled(false);
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
  const firstPrompt = document.getElementById('firstPromptInput').value.trim();
  const prompt = document.getElementById('promptInput').value.trim();
  if (!firstPrompt) {
    alert('Ajoutez votre premier prompt (étape 1). Si vous n\'avez écrit qu\'un seul prompt, collez-le dans les deux cases.');
    return;
  }
  if (!prompt) {
    alert('Ajoutez votre prompt final complet (étape 3) avant de soumettre la manche.');
    return;
  }
  if (!['running', 'paused'].includes(state.participantSession.status)) {
    alert('La manche n\'est pas encore ouverte par le formateur.');
    return;
  }
  if ((firstPrompt.length > LONG_PROMPT_WARNING || prompt.length > LONG_PROMPT_WARNING)
    && !window.confirm('Un de vos textes est très long pour un prompt. Avez-vous collé la réponse de l\'IA par erreur ?\n\nOK : envoyer quand même. Annuler : revenir corriger.')) {
    return;
  }

  const roundNumber = displayRoundNumber(state.participantSession);
  const info = timerInfo(state.participantSession);
  const delaySeconds = state.participantSession.status === 'running' ? info.delay : 0;
  const payload = {
    session_id: state.participantSession.id,
    team_id: state.teamId,
    round_number: roundNumber,
    first_prompt_text: firstPrompt,
    prompt_text: prompt,
    changes_made: selectedChanges(),
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
  } catch (error) {
    console.error(error);
    alert(`Impossible d\'enregistrer vos prompts : ${error.message}`);
  } finally {
    button.disabled = false;
    renderParticipantRoundState();
  }
}

function buildTrainerTeams() {
  const trainer = document.getElementById('trainerTeams');
  trainer.innerHTML = '';
  const teams = state.trainerSession ? state.teams : [];
  const roundNumber = state.trainerSession ? displayRoundNumber(state.trainerSession) : 1;

  for (let i = 1; i <= TEAM_SLOTS; i++) {
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
      if (evaluation) statusText += ` · ${formatStarValue(averageStars(evaluation.total, 1))} ★`;
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
  document.getElementById('connectedTeamsLabel').textContent = state.trainerSession ? 'connectées à cette session' : 'en attente d\'une session';
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
      <span><span class="review-team-name"><i class="team-dot" style="background:${teamColors[(team?.team_slot || 1) - 1]}"></i>${team?.team_name || 'Équipe'}</span><small>${delay > 0 ? `Hors délai +${formatTime(delay)}` : 'Dans le temps'}</small></span>
      <span class="review-score-chip">${evaluation ? `${formatStarValue(averageStars(evaluation.total, 1))} ★` : 'À noter'}</span>
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
  if (el) el.textContent = formatStarValue(averageStars(evaluationTotalFromInputs(), 1));
}

function starRatingHtml(index, value) {
  const current = Number(value);
  return `<div class="star-rating" role="radiogroup" aria-label="Étoiles du critère ${index + 1}">
    <input type="hidden" class="trainer-eval-select" data-criterion="${index}" value="${current}" />
    ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star-button ${n <= current ? 'on' : ''}" data-star="${n}" role="radio" aria-checked="${n === current}" aria-label="${n} étoile${n > 1 ? 's' : ''}">★</button>`).join('')}
  </div>`;
}

function changesChipsHtml(changes) {
  const list = Array.isArray(changes) ? changes : [];
  if (!list.length) return '<span class="muted">Aucune case cochée.</span>';
  return list.map(key => `<span class="change-chip">${escapeHtml(CHANGE_OPTIONS[key] || key)}</span>`).join('');
}

function feedbackFieldsHtml(className, items, count, placeholder) {
  const list = Array.isArray(items) ? items : [];
  return Array.from({ length: count }, (_, i) => `<textarea class="${className}" rows="2" maxlength="300" placeholder="${placeholder} ${i + 1}">${escapeHtml(list[i] || '')}</textarea>`).join('');
}

function renderReviewDetail(submissionId) {
  const detail = document.getElementById('reviewDetail');
  if (!detail) return;
  const sub = state.submissions.find(s => s.id === submissionId);
  if (!sub) {
    detail.innerHTML = '<div class="empty-review"><strong>Sélectionnez une équipe</strong><span>Vous pourrez lire son premier prompt et son prompt final, attribuer des étoiles et rédiger son retour.</span></div>';
    return;
  }
  const team = state.teams.find(t => t.id === sub.team_id);
  const evaluation = state.evaluations.find(e => e.submission_id === sub.id);
  const feedback = state.feedback.find(f => f.team_id === sub.team_id && f.round_number === sub.round_number);
  const values = evaluation ? [evaluation.pertinence, evaluation.precision, evaluation.context_score, evaluation.utility] : [3, 3, 3, 3];
  const criteria = (scenarioOf(state.trainerPack, sub.round_number)?.grading.criteria || []).map(c => [c.label, c.question]);
  const delay = Number(sub.delay_seconds || 0);
  const average = formatStarValue(averageStars(values.reduce((a, b) => a + Number(b), 0), 1));
  detail.innerHTML = `<div class="review-production">
    <div class="review-meta"><div><p class="panel-label">MANCHE ${sub.round_number} · ${escapeHtml(scenarioTitleOf(state.trainerPack, sub.round_number).toUpperCase())}</p><h3>${escapeHtml(team?.team_name || 'Équipe')}</h3></div><span class="review-self">${delay > 0 ? `+${formatTime(delay)}` : 'dans le temps'}</span></div>
    <div class="production-block"><p class="panel-label">PREMIER PROMPT</p><p>${escapeHtml(sub.first_prompt_text || '—')}</p></div>
    <div class="production-block"><p class="panel-label">PROMPT FINAL COMPLET</p><p>${escapeHtml(sub.prompt_text || '—')}</p></div>
    <div class="production-block"><p class="panel-label">AMÉLIORATIONS COCHÉES PAR L'ÉQUIPE</p><div class="change-chips">${changesChipsHtml(sub.changes_made)}</div></div>
    <div class="evaluation-grid">
      ${criteria.map((c, i) => `<div class="eval-card"><label>${escapeHtml(c[0])}</label><small>${escapeHtml(c[1])}</small>${starRatingHtml(i, values[i])}</div>`).join('')}
    </div>
    <div class="feedback-edit">
      <p class="panel-label">RETOUR POUR L'ÉQUIPE · VISIBLE À LA PUBLICATION</p>
      <div class="feedback-columns">
        <div><label>Points forts</label>${feedbackFieldsHtml('feedback-strength', feedback?.strengths, 2, 'Point fort')}</div>
        <div><label>Axes d'amélioration</label>${feedbackFieldsHtml('feedback-axis', feedback?.axes, 2, 'Axe')}</div>
      </div>
    </div>
    <div class="evaluation-footer"><div class="trainer-score-total"><span>Moyenne</span><strong id="trainerEvalTotal">${average}</strong><small>★ sur 5</small></div><div class="eval-actions"><button class="secondary" type="button" id="projectSubmissionButton">Afficher en grand</button><button class="primary" type="button" id="saveTrainerEvaluation">${evaluation ? 'Mettre à jour la note' : 'Enregistrer la note'}</button></div></div>
  </div>`;
  detail.querySelectorAll('.star-rating').forEach(group => {
    const input = group.querySelector('.trainer-eval-select');
    group.querySelectorAll('.star-button').forEach(star => star.addEventListener('click', () => {
      const value = Number(star.dataset.star);
      input.value = String(value);
      group.querySelectorAll('.star-button').forEach(other => {
        const n = Number(other.dataset.star);
        other.classList.toggle('on', n <= value);
        other.setAttribute('aria-checked', String(n === value));
      });
      updateTrainerEvalTotal();
    }));
  });
  document.getElementById('saveTrainerEvaluation').addEventListener('click', () => saveTrainerEvaluation(sub.id));
  document.getElementById('projectSubmissionButton').addEventListener('click', () => showProjection(sub.id));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function readFeedbackFields(selector) {
  return [...document.querySelectorAll(selector)].map(el => el.value.trim()).filter(Boolean);
}

// Le retour écrit est stocké à part des notes (table team_feedback) pour que la base le réserve à l'équipe concernée.
async function saveTeamFeedback(sub, strengths, axes) {
  const existing = state.feedback.find(f => f.team_id === sub.team_id && f.round_number === sub.round_number);
  if (!existing && !strengths.length && !axes.length) return;
  const payload = {
    session_id: state.trainerSession.id,
    team_id: sub.team_id,
    round_number: sub.round_number,
    strengths,
    axes,
    written_by: state.userId,
    updated_at: new Date().toISOString()
  };
  const result = existing
    ? await db.from('team_feedback').update(payload).eq('id', existing.id).select().single()
    : await db.from('team_feedback').insert(payload).select().single();
  if (result.error) {
    const failure = new Error(`La note est enregistrée, mais pas le retour écrit : ${result.error.message}`);
    failure.feedbackOnly = true;
    throw failure;
  }
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
    await saveTeamFeedback(sub, readFeedbackFields('.feedback-strength'), readFeedbackFields('.feedback-axis'));
    await refreshTrainerData();
    state.selectedSubmissionId = sub.id;
    renderReviewList();
    renderReviewDetail(sub.id);
  } catch (error) {
    console.error(error);
    if (error.feedbackOnly) {
      alert(error.message);
      await refreshTrainerData();
    } else {
      alert(`Impossible d\'enregistrer la note : ${error.message}`);
    }
    button.disabled = false;
    button.textContent = 'Enregistrer la note';
  }
}

// Classement par moyenne d'étoiles (et non par somme) : une équipe notée sur une seule manche n'est pas pénalisée.
// Deux équipes à la même moyenne partagent le même rang.
function rankTeams(teams, evaluations) {
  const items = teams.map(team => {
    const evals = evaluations.filter(e => e.team_id === team.id);
    return { team, rounds: evals.length, total: evals.reduce((sum, e) => sum + Number(e.total || 0), 0) };
  }).filter(item => item.rounds > 0)
    .sort((a, b) => (b.total * a.rounds) - (a.total * b.rounds) || b.rounds - a.rounds || a.team.team_slot - b.team.team_slot);
  items.forEach((item, index) => {
    const previous = items[index - 1];
    const tied = previous && previous.total * item.rounds === item.total * previous.rounds;
    item.rank = tied ? previous.rank : index + 1;
  });
  return items;
}

function cumulativeRanking() {
  return rankTeams(state.teams, state.evaluations);
}

function renderLeaderboard() {
  const board = document.getElementById('leaderboard');
  if (!board) return;
  const ranking = cumulativeRanking();
  if (!ranking.length) {
    board.innerHTML = '<p class="muted">Le classement apparaîtra dès qu\'un premier prompt sera noté.</p>';
    return;
  }
  board.innerHTML = ranking.map(item => `<div class="leader-row"><strong>${item.rank}</strong><span>${escapeHtml(item.team.team_name)}<span class="leader-detail">${item.rounds}/${ROUND_COUNT} manche${item.rounds > 1 ? 's' : ''} notée${item.rounds > 1 ? 's' : ''}</span></span><span class="leader-stars">${starsLabel(item.total, item.rounds)}</span></div>`).join('');
}

// Ce que les équipes disent avoir amélioré, manche par manche : matière du débrief général.
function renderDebriefSynthesis() {
  const target = document.getElementById('debriefSynthesis');
  if (!target) return;
  const cards = [];
  for (let round = 1; round <= ROUND_COUNT; round++) {
    const subs = state.submissions.filter(s => s.round_number === round && s.submitted_at);
    if (!subs.length) continue;
    const rows = Object.entries(CHANGE_OPTIONS).map(([key, label]) => {
      const count = subs.filter(s => Array.isArray(s.changes_made) && s.changes_made.includes(key)).length;
      const percent = Math.round((count / subs.length) * 100);
      return `<div class="synthesis-row"><span>${escapeHtml(label)}</span><div class="synthesis-bar"><i style="width:${percent}%"></i></div><strong>${count}/${subs.length}</strong></div>`;
    }).join('');
    const same = subs.filter(s => s.first_prompt_text && s.first_prompt_text.trim() === String(s.prompt_text || '').trim()).length;
    const none = subs.filter(s => !(Array.isArray(s.changes_made) && s.changes_made.length)).length;
    const notes = [];
    if (same) notes.push(`${same} équipe${same > 1 ? 's ont' : ' a'} rendu le même prompt au début et à la fin.`);
    if (none) notes.push(`${none} équipe${none > 1 ? 's n\'ont' : ' n\'a'} rien coché.`);
    cards.push(`<div class="synthesis-card"><p class="panel-label">MANCHE ${round} · ${escapeHtml(scenarioTitleOf(state.trainerPack, round).toUpperCase())}</p>${rows}${notes.length ? `<p class="note">${notes.join(' ')}</p>` : ''}</div>`);
  }
  target.innerHTML = cards.length ? cards.join('') : '<p class="muted">La synthèse apparaîtra dès que des équipes auront soumis leur manche.</p>';
}

function renderRankingPublicationState() {
  const button = document.getElementById('publishRanking');
  const note = document.getElementById('rankingPublicationNote');
  const badge = document.getElementById('rankingPublicationBadge');
  if (!button || !state.trainerSession) return;
  const published = Boolean(state.trainerSession.ranking_published);
  button.textContent = published ? 'Masquer le classement et les retours' : 'Publier le classement et les retours aux participants';
  button.classList.toggle('published', published);
  if (badge) {
    badge.textContent = published ? 'Publié' : 'Privé';
    badge.classList.toggle('published', published);
  }
  if (note) note.textContent = published
    ? 'Le classement et les retours sont maintenant visibles en temps réel par les participants.'
    : 'Le classement et les retours restent privés côté formateur. Publiez-les lorsque votre notation et vos commentaires sont prêts.';
}

async function toggleRankingPublication() {
  if (!state.trainerSession) return;
  const willPublish = !Boolean(state.trainerSession.ranking_published);
  if (willPublish) {
    const ranking = cumulativeRanking();
    if (!ranking.length) {
      alert('Aucun prompt n\'est encore noté. Notez au moins une équipe avant de publier le classement.');
      return;
    }
    const incomplete = ranking.filter(item => item.rounds < ROUND_COUNT).length;
    const message = state.trainerSession.status === 'finished'
      ? (incomplete ? `${incomplete} équipe(s) n\'ont pas encore ${ROUND_COUNT} manches notées. Publier quand même le classement ?` : 'Publier le classement final et les retours aux participants ? Relisez vos commentaires avant de valider.')
      : 'La battle n\'est pas encore terminée. Publier un classement provisoire et les retours déjà rédigés aux participants ?';
    if (!window.confirm(message)) return;
  }
  try {
    await updateTrainerSession({ ranking_published: willPublish });
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
  document.getElementById('projectionRoundLabel').textContent = `MANCHE ${sub.round_number} · ${scenarioTitleOf(state.trainerPack, sub.round_number)}`;
  document.getElementById('projectionTeamTitle').textContent = team?.team_name || 'Production';
  document.getElementById('projectionFirstPrompt').textContent = sub.first_prompt_text || '—';
  document.getElementById('projectionPrompt').textContent = sub.prompt_text || '—';
  const changes = (Array.isArray(sub.changes_made) ? sub.changes_made : []).map(key => CHANGE_OPTIONS[key] || key).join(' · ');
  const changesLabel = changes ? `Améliorations cochées : ${escapeHtml(changes)}` : 'Aucune amélioration cochée';
  const criteria = scenarioOf(state.trainerPack, sub.round_number)?.grading.criteria || [];
  const values = evaluation ? [evaluation.pertinence, evaluation.precision, evaluation.context_score, evaluation.utility] : [];
  const detail = evaluation ? criteria.map((c, i) => `${escapeHtml(c.label)} ${starString(values[i])}`).join(' · ') : '';
  document.getElementById('projectionScore').innerHTML = evaluation
    ? `<span>${changesLabel}<br>${detail}</span><strong>${starsLabel(evaluation.total, 1)}</strong>`
    : `<span>${changesLabel}<br>Prompt non encore noté.</span><strong>—</strong>`;
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
  document.getElementById('trainerRound').textContent = `${roundNumber}/${ROUND_COUNT}`;
  document.getElementById('trainerRoundName').textContent = scenarioTitleOf(state.trainerPack, roundNumber);
  document.getElementById('trainerControlTitle').textContent = `Manche ${roundNumber} — ${scenarioTitleOf(state.trainerPack, roundNumber)}`;

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

  // Le formateur doit toujours pouvoir écourter une manche en cours.
  // Le bouton reste donc actif pendant waiting / running / paused.
  nextButton.disabled = session.status === 'finished' || state.trainerTransitionBusy;
  if (roundNumber >= ROUND_COUNT) {
    nextButton.textContent = session.status === 'running' || session.status === 'paused'
      ? `⏹ Clôturer la manche ${roundNumber} et terminer la battle`
      : 'Terminer la battle';
  } else {
    nextButton.textContent = session.status === 'running' || session.status === 'paused'
      ? `⏭ Clôturer la manche ${roundNumber} et préparer la manche ${roundNumber + 1}`
      : `Préparer la manche ${roundNumber + 1} →`;
  }
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
        round_duration_seconds: roundSecondsOf(state.trainerPack, roundNumber)
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
  if (!state.trainerSession?.id) {
    alert('Aucune session formateur active.');
    return;
  }
  if (state.trainerTransitionBusy) return;

  const button = document.getElementById('nextTrainerRoundButton');
  state.trainerTransitionBusy = true;
  renderTrainerControls();

  try {
    // Toujours repartir de l'état réellement stocké dans Supabase.
    const freshSession = await refreshTrainerSessionState({ render: false });
    if (!freshSession) throw new Error('Session introuvable.');

    const current = displayRoundNumber(freshSession);
    const nextSeconds = roundSecondsOf(state.trainerPack, current + 1);
    const isActive = freshSession.status === 'running' || freshSession.status === 'paused';

    const message = current >= ROUND_COUNT
      ? (isActive
          ? `Clôturer la manche ${current} maintenant et terminer la Prompt Battle ? Le chrono sera arrêté immédiatement.`
          : 'Terminer la Prompt Battle ? Les participants verront que la battle est terminée.')
      : (isActive
          ? `Clôturer la manche ${current} maintenant et préparer la manche ${current + 1} ? Le chrono s\'arrêtera immédiatement et les participants basculeront sur le prochain défi.`
          : `Préparer la manche ${current + 1} ? Le chrono sera remis à ${formatTime(nextSeconds)} et les participants basculeront sur le prochain défi.`);

    // On libère temporairement l'état busy pendant la boîte de dialogue : certains navigateurs
    // recalculent mal l'état d'un bouton désactivé après un confirm() bloquant.
    state.trainerTransitionBusy = false;
    renderTrainerControls();
    if (!window.confirm(message)) return;

    state.trainerTransitionBusy = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = current >= ROUND_COUNT ? 'Clôture de la battle…' : `Préparation de la manche ${current + 1}…`;
    }

    const patch = current >= ROUND_COUNT
      ? { status: 'finished', round_started_at: null, round_duration_seconds: 0 }
      : { current_round: current + 1, status: 'waiting', round_started_at: null, round_duration_seconds: nextSeconds };

    const { data: updatedSession, error: updateError } = await db
      .from('sessions')
      .update(patch)
      .eq('id', freshSession.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    state.trainerSession = updatedSession;
    await refreshTrainerData();

    // Vérification explicite : si le navigateur a raté l'événement Realtime, on relit la session.
    const verified = await refreshTrainerSessionState({ render: false });
    if (current < ROUND_COUNT && Number(verified.current_round) !== current + 1) {
      throw new Error('Le changement de manche n\'a pas été confirmé par la base. Réessayez.');
    }
    if (current >= ROUND_COUNT && verified.status !== 'finished') {
      throw new Error('La fin de battle n\'a pas été confirmée par la base. Réessayez.');
    }
  } catch (error) {
    console.error('Erreur changement de manche', error);
    alert(`Impossible de changer de manche : ${error.message || error}`);
  } finally {
    state.trainerTransitionBusy = false;
    if (button) button.removeAttribute('aria-busy');
    try {
      await refreshTrainerSessionState({ render: false });
    } catch (error) {
      console.debug('Rafraîchissement final formateur impossible', error);
    }
    renderTrainerSession();
  }
}

// Retour écrit par le formateur pour l'équipe du participant : étoiles par critère, points forts, axes.
function renderOwnTeamFeedback(evaluations, feedbackRows) {
  const panel = document.getElementById('ownTeamFeedback');
  const body = document.getElementById('ownTeamFeedbackBody');
  if (!panel || !body) return;
  const mine = evaluations.filter(e => e.team_id === state.teamId).sort((a, b) => a.round_number - b.round_number);
  panel.classList.toggle('hidden', !mine.length);
  const list = (title, items, tone) => items.length
    ? `<div class="feedback-list ${tone}"><p class="panel-label">${title}</p><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
    : '';
  body.innerHTML = mine.map(evaluation => {
    const scenario = scenarioOf(state.participantPack, evaluation.round_number);
    const criteria = scenario?.grading?.criteria || [];
    const values = [evaluation.pertinence, evaluation.precision, evaluation.context_score, evaluation.utility];
    // Le filtre par équipe est une double sécurité : la base ne renvoie déjà que le retour de l'équipe du participant.
    const written = feedbackRows.find(f => f.team_id === state.teamId && f.round_number === evaluation.round_number);
    const strengths = Array.isArray(written?.strengths) ? written.strengths : [];
    const axes = Array.isArray(written?.axes) ? written.axes : [];
    const comments = list('POINTS FORTS', strengths, 'good') + list('À AMÉLIORER', axes, 'axis');
    return `<section class="feedback-round">
      <h3>Manche ${evaluation.round_number} · ${escapeHtml(scenario?.title || '')}</h3>
      <p class="feedback-stars">${starsLabel(evaluation.total, 1)}</p>
      <ul class="criteria-stars">${criteria.map((c, i) => `<li><span>${escapeHtml(c.label)}</span><span class="stars">${starString(values[i])}</span></li>`).join('')}</ul>
      ${comments || '<p class="muted">Pas de commentaire écrit pour cette manche.</p>'}
    </section>`;
  }).join('');
}

async function openPublicRanking(silent = false) {
  if (!state.participantSession?.ranking_published) {
    if (!silent) alert('Le classement n\'est pas encore publié par le formateur.');
    return;
  }
  if (state.rankingOpenInProgress) return;
  state.rankingOpenInProgress = true;
  try {
    const [teams, evaluations, feedback] = await Promise.all([
      fetchTeams(state.participantSession.id),
      fetchEvaluations(state.participantSession.id),
      fetchFeedback(state.participantSession.id)
    ]);
    const ranking = rankTeams(teams, evaluations);

    const board = document.getElementById('publicLeaderboard');
    const podium = document.getElementById('publicPodium');
    const ownNote = document.getElementById('ownTeamRankingNote');
    const scoreLabel = item => starsLabel(item.total, item.rounds);
    const medals = ['🥇', '🥈', '🥉'];

    podium.innerHTML = ranking.slice(0, 3).map((item, index) => `<article class="podium-card place-${Math.min(item.rank, 3)} ${item.team.id === state.teamId ? 'own-team' : ''}"><span class="podium-medal">${medals[Math.min(item.rank, 3) - 1]}</span><strong>${escapeHtml(item.team.team_name)}</strong><span>${scoreLabel(item)}</span><small>${item.rounds}/${ROUND_COUNT} manches notées</small></article>`).join('');
    board.innerHTML = ranking.length ? ranking.map(item => `<div class="leader-row ${item.team.id === state.teamId ? 'own-team' : ''}"><strong>${item.rank}</strong><span>${escapeHtml(item.team.team_name)}${item.team.id === state.teamId ? '<em>Votre équipe</em>' : ''}<span class="leader-detail">${item.rounds}/${ROUND_COUNT} manche${item.rounds > 1 ? 's' : ''} notée${item.rounds > 1 ? 's' : ''}</span></span><span>${scoreLabel(item)}</span></div>`).join('') : '<p class="muted">Le classement vient d\'être publié. Chargement des notes…</p>';

    const ownIndex = ranking.findIndex(item => item.team.id === state.teamId);
    if (ownNote) {
      ownNote.classList.toggle('hidden', ownIndex < 0);
      if (ownIndex >= 0) ownNote.textContent = `Votre équipe est classée ${ranking[ownIndex].rank}${ranking[ownIndex].rank === 1 ? 're' : 'e'} avec ${scoreLabel(ranking[ownIndex])}.`;
    }
    renderOwnTeamFeedback(evaluations, feedback);
    showScreen('ranking');
    document.getElementById('rankingToast')?.classList.add('hidden');
  } catch (error) {
    console.error(error);
    if (!silent) alert(`Impossible de charger le classement : ${error.message}`);
    else if (state.participantSession?.status === 'finished') showScreen('final');
  } finally {
    state.rankingOpenInProgress = false;
  }
}

function renderParticipantRankingAvailability() {
  const published = Boolean(state.participantSession?.ranking_published);
  const banner = document.getElementById('rankingBanner');
  const toast = document.getElementById('rankingToast');
  const finalButton = document.getElementById('finalRankingButton');
  const finalStatus = document.getElementById('finalRankingStatus');
  if (banner) banner.classList.toggle('hidden', !published);
  // Le bandeau « Classement disponible » n'a plus d'utilité (et masquerait le podium) une fois le classement ouvert.
  const onRanking = document.querySelector('.screen.active')?.id === 'ranking';
  if (toast) toast.classList.toggle('hidden', !published || !state.teamId || onRanking);
  if (finalButton) finalButton.classList.toggle('hidden', !published);
  if (finalStatus) finalStatus.textContent = published ? 'Classement publié ! Ouverture…' : 'Classement en attente';
}

function subscribeParticipant(sessionId) {
  if (state.participantChannel) db.removeChannel(state.participantChannel);
  state.participantChannel = db
    .channel(`participant-${sessionId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `session_id=eq.${sessionId}` }, loadParticipantTeams)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, async payload => {
      const previousRound = state.participantSession?.current_round;
      state.participantSession = payload.new;

      // Fin de battle prioritaire : quel que soit l'écran courant (battle, auto-évaluation, accueil),
      // le participant est envoyé vers la salle d'attente, puis vers le classement dès publication.
      if (payload.new.status === 'finished' || payload.new.ranking_published) {
        await routeParticipantBySessionState();
        return;
      }

      if (state.teamId && previousRound !== payload.new.current_round) {
        await loadParticipantRound(true);
        showScreen('battle');
      } else {
        renderParticipantRoundState();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trainer_evaluations', filter: `session_id=eq.${sessionId}` }, async () => {
      if (state.participantSession?.ranking_published) await openPublicRanking(true);
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

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (state.participantSession?.id && state.teamId) {
    try { await refreshParticipantSession(); } catch (error) { console.debug('Resynchronisation participant au retour sur l\'onglet', error); }
  }
  if (state.trainerSession?.id && !state.trainerTransitionBusy) {
    try { await refreshTrainerSessionState(); } catch (error) { console.debug('Resynchronisation formateur au retour sur l\'onglet', error); }
  }
});
window.addEventListener('focus', async () => {
  if (state.participantSession?.id && state.teamId) {
    try { await refreshParticipantSession(); } catch (error) { console.debug('Resynchronisation participant au focus', error); }
  }
  if (state.trainerSession?.id && !state.trainerTransitionBusy) {
    try { await refreshTrainerSessionState(); } catch (error) { console.debug('Resynchronisation formateur au focus', error); }
  }
});

window.addEventListener('online', async () => {
  if (state.participantSession?.id && state.teamId) {
    try { await refreshParticipantSession(); } catch (error) { console.debug('Resynchronisation au retour réseau', error); }
  }
});

document.getElementById('rctfToggle').addEventListener('click', () => {
  const help = document.getElementById('rctfHelp');
  help.classList.toggle('hidden');
  document.getElementById('rctfToggle').textContent = help.classList.contains('hidden') ? 'Afficher le rappel RCTF' : 'Masquer le rappel RCTF';
});

document.getElementById('copyPromptButton').addEventListener('click', async () => {
  const promptText = document.getElementById('promptInput').value;
  if (!promptText.trim()) {
    alert('Écrivez votre prompt final avant de le copier.');
    return;
  }
  const btn = document.getElementById('copyPromptButton');
  try {
    await navigator.clipboard.writeText(promptText);
    const original = btn.textContent;
    btn.textContent = '✓ Copié';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (error) {
    alert('Impossible de copier automatiquement. Sélectionnez le texte et copiez-le manuellement.');
  }
});

document.getElementById('firstPromptInput').addEventListener('input', updatePromptCounters);
document.getElementById('promptInput').addEventListener('input', updatePromptCounters);

document.getElementById('copyJoinLinkButton').addEventListener('click', async () => {
  const input = document.getElementById('joinLinkInput');
  const button = document.getElementById('copyJoinLinkButton');
  if (!input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (error) {
    // Repli : sélection du texte pour une copie manuelle.
    input.focus();
    input.select();
    alert('Copie automatique impossible : le lien est sélectionné, copiez-le avec Ctrl+C.');
    return;
  }
  const original = button.textContent;
  button.textContent = '✓ Lien copié';
  setTimeout(() => { button.textContent = original; }, 1800);
});
document.getElementById('joinLinkInput').addEventListener('focus', e => e.target.select());

document.getElementById('submitRound').addEventListener('click', submitCurrentRound);
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
document.getElementById('openRankingToast').addEventListener('click', () => openPublicRanking());
document.getElementById('finalRankingButton').addEventListener('click', () => openPublicRanking());
document.getElementById('refreshFinalState').addEventListener('click', async () => {
  try { await refreshParticipantSession(); } catch (error) { alert(`Impossible d\'actualiser : ${error.message}`); }
});

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
    await updateTrainerSession({ current_round: 0, status: 'waiting', round_started_at: null, round_duration_seconds: roundSecondsOf(state.trainerPack, 1), ranking_published: false });
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

async function handleSessionLink() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('session') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return;
  showScreen('join');
  const input = document.getElementById('sessionCodeInput');
  input.value = code;
  await joinSessionByCode();
}

async function restoreTrainerSession() {
  if (!state.userId) {
    resetTrainerSessionPanel();
    return;
  }
  try {
    const cutoff = new Date(Date.now() - RESTORE_WINDOW_HOURS * 3600 * 1000).toISOString();
    const { data, error } = await db
      .from('sessions')
      .select('*')
      .eq('created_by', state.userId)
      .neq('status', 'finished')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      resetTrainerSessionPanel();
      return;
    }
    try {
      state.trainerPack = await PromptBattlePacks.loadPack(packIdOfSession(data));
    } catch (packError) {
      // La session reste pilotable : seuls les titres de manche et les critères sont affectés. L'erreur est affichée.
      if (!(packError instanceof PromptBattlePacks.PackError)) throw packError;
      state.trainerPack = null;
      showPackError(packError);
    }
    state.trainerSession = data;
    state.reviewRound = displayRoundNumber(data);
    state.selectedSubmissionId = null;
    renderTrainerSession();
    await refreshTrainerData();
    subscribeTrainer(data.id);
    startTrainerSyncLoop();
  } catch (error) {
    console.debug('Reprise de session formateur impossible', error);
    resetTrainerSessionPanel();
  }
}

function resetTrainerSessionPanel() {
  document.getElementById('trainerSessionTitle').textContent = 'Aucune session active';
  document.getElementById('trainerSessionHelp').textContent = 'Créez une session pour générer un code à six caractères.';
  const createButton = document.getElementById('createSessionButton');
  if (createButton) createButton.classList.remove('hidden');
  document.getElementById('trainerSessionPack')?.classList.add('hidden');
  setPackPickerVisible(true);
  updateCreateButton();
}

async function init() {
  buildTrainerTeams();
  startTimerLoop();
  try {
    await ensureAnonymousAuth();
    await restoreTrainerSession();
    await handleSessionLink();
  } catch (error) {
    console.error(error);
    setConnectionStatus('Connexion impossible', 'error');
    resetTrainerSessionPanel();
  }
}

init();
