const SUPABASE_URL = 'https://cmaikgqdyjqyrtkcwhkz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aGRxie9hlojGMP1Sttz9hg_dn4XbLc-';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

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
  team: 1,
  teamId: null,
  round: 0,
  realtimeChannel: null
};

const screens = [...document.querySelectorAll('.screen')];
function showScreen(id) {
  screens.forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-go]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.go));
});

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
        .insert({ session_code: code, created_by: state.userId })
        .select()
        .single();

      if (!error) created = data;
      else if (error.code !== '23505') throw error;
    }

    if (!created) throw new Error('Impossible de générer un code de session unique.');

    state.trainerSession = created;
    renderTrainerSession();
    await loadTrainerTeams();
    subscribeToTeams(created.id, 'trainer');
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
  document.getElementById('trainerSessionHelp').textContent = 'Affichez ce code aux participants. Les arrivées apparaissent ci-dessous en temps réel.';
  document.getElementById('trainerSessionCode').textContent = state.trainerSession.session_code;
  document.getElementById('sessionCodeCard').classList.remove('hidden');
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
    const { data, error } = await db
      .from('sessions')
      .select('*')
      .eq('session_code', code)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      feedback.textContent = 'Aucune session active ne correspond à ce code.';
      feedback.classList.add('error');
      document.getElementById('teamSelectionBlock').classList.add('hidden');
      return;
    }

    state.participantSession = data;
    document.getElementById('participantSessionCode').textContent = data.session_code;
    feedback.textContent = 'Session trouvée. Choisissez maintenant votre équipe.';
    feedback.classList.add('success');
    document.getElementById('teamSelectionBlock').classList.remove('hidden');
    await loadParticipantTeams();
    subscribeToTeams(data.id, 'participant');
  } catch (error) {
    console.error(error);
    feedback.textContent = `Connexion impossible : ${error.message}`;
    feedback.classList.add('error');
  }
}

async function fetchTeams(sessionId) {
  const { data, error } = await db
    .from('teams')
    .select('*')
    .eq('session_id', sessionId)
    .order('team_slot');
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

async function loadTrainerTeams() {
  if (!state.trainerSession) return;
  state.teams = await fetchTeams(state.trainerSession.id);
  buildTrainerTeams();
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
    openBattle();
    return;
  }

  const alreadyMine = state.teams.find(t => t.owner_user_id === state.userId);
  if (alreadyMine) {
    alert(`Vous avez déjà rejoint l’Équipe ${alreadyMine.team_slot}.`);
    return;
  }

  try {
    const { data, error } = await db
      .from('teams')
      .insert({
        session_id: state.participantSession.id,
        team_slot: slot,
        team_name: `Équipe ${slot}`,
        team_color: teamColors[slot - 1],
        owner_user_id: state.userId
      })
      .select()
      .single();

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
    openBattle();
  } catch (error) {
    console.error(error);
    alert(`Impossible de rejoindre l’équipe : ${error.message}`);
  }
}

function openBattle() {
  document.getElementById('currentTeamBadge').textContent = `Équipe ${state.team}`;
  loadRound();
  showScreen('battle');
}

function buildTrainerTeams() {
  const trainer = document.getElementById('trainerTeams');
  trainer.innerHTML = '';
  const teams = state.trainerSession ? state.teams : [];

  for (let i = 1; i <= 8; i++) {
    const existing = teams.find(t => t.team_slot === i);
    const row = document.createElement('div');
    row.className = 'trainer-team';
    row.innerHTML = `<span><i class="team-dot" style="background:${teamColors[i - 1]}"></i>Équipe ${i}</span><span class="${existing ? 'state-live' : 'state-wait'}">${existing ? 'Connectée ✓' : 'En attente'}</span>`;
    trainer.appendChild(row);
  }

  document.getElementById('connectedTeamsCount').textContent = teams.length;
  document.getElementById('connectedTeamsLabel').textContent = state.trainerSession ? 'connectées à cette session' : 'en attente d’une session';
}

function subscribeToTeams(sessionId, mode) {
  if (state.realtimeChannel) db.removeChannel(state.realtimeChannel);

  state.realtimeChannel = db
    .channel(`teams-${sessionId}-${mode}-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'teams', filter: `session_id=eq.${sessionId}` },
      async () => {
        if (mode === 'trainer') await loadTrainerTeams();
        if (mode === 'participant') await loadParticipantTeams();
      }
    )
    .subscribe();
}

function loadRound() {
  const c = challenges[state.round];
  document.getElementById('roundLabel').textContent = `MANCHE ${state.round + 1} / 3`;
  document.getElementById('challengeTitle').textContent = c.title;
  document.getElementById('challengeSituation').textContent = c.situation;
  document.getElementById('challengeMission').textContent = c.mission;
  document.getElementById('trainerRound').textContent = `${state.round + 1}/3`;
  document.getElementById('promptInput').value = '';
  document.getElementById('resultInput').value = '';
  document.getElementById('saveState').textContent = 'Non soumis';
  document.getElementById('timer').textContent = '05:30';
  document.getElementById('timerMessage').textContent = 'Le formateur lancera le chrono.';
}

document.getElementById('rctfToggle').addEventListener('click', () => {
  const help = document.getElementById('rctfHelp');
  help.classList.toggle('hidden');
  document.getElementById('rctfToggle').textContent = help.classList.contains('hidden') ? 'Afficher le rappel RCTF' : 'Masquer le rappel RCTF';
});

document.getElementById('submitRound').addEventListener('click', () => {
  const prompt = document.getElementById('promptInput').value.trim();
  if (!prompt) {
    alert('Ajoutez au moins votre prompt avant de soumettre la manche.');
    return;
  }
  document.getElementById('saveState').textContent = '✓ Prêt pour la sauvegarde V2.3';
  showScreen('selfcheck');
});

const scoreItems = [
  ["Pertinence", "Le résultat répond-il réellement au problème posé ?"],
  ["Précision", "La demande limite-t-elle les réponses vagues ou génériques ?"],
  ["Contexte", "Les informations données permettent-elles une réponse adaptée ?"],
  ["Utilité managériale", "Pourriez-vous réellement vous appuyer sur ce résultat ?"]
];

function buildScores() {
  const grid = document.getElementById('scoreGrid');
  grid.innerHTML = scoreItems.map(item => `
    <article class="score-card">
      <h3>${item[0]}</h3><p>${item[1]}</p>
      <select class="score-select" aria-label="${item[0]}">
        ${[1,2,3,4,5].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n} / 5</option>`).join('')}
      </select>
    </article>`).join('');
  document.querySelectorAll('.score-select').forEach(s => s.addEventListener('change', updateTotal));
  updateTotal();
}

function updateTotal() {
  const total = [...document.querySelectorAll('.score-select')].reduce((sum, el) => sum + Number(el.value), 0);
  document.getElementById('selfTotal').textContent = total;
}

document.getElementById('nextRound').addEventListener('click', () => {
  if (state.round < challenges.length - 1) {
    state.round++;
    loadRound();
    buildScores();
    showScreen('battle');
  } else showScreen('final');
});

function buildLeaderboard() {
  const scores = [18.5, 17, 16.5, 15, 14.5, 13, 12.5, 11];
  document.getElementById('leaderboard').innerHTML = scores.map((score, i) => `<div class="leader-row"><strong>${i + 1}</strong><span>Équipe ${i + 1}</span><span>${score}/20</span></div>`).join('');
}

document.getElementById('publishRanking').addEventListener('click', e => {
  e.currentTarget.textContent = e.currentTarget.textContent === 'Publier' ? 'Publié ✓' : 'Publier';
});

function resetBattleLocal() {
  const confirmed = window.confirm('Remettre l’interface locale à zéro ?\n\nLa suppression réelle d’une session Supabase sera ajoutée dans une prochaine étape.');
  if (!confirmed) return;
  state.round = 0;
  document.getElementById('promptInput').value = '';
  document.getElementById('resultInput').value = '';
  document.getElementById('saveState').textContent = 'Non soumis';
  document.getElementById('publishRanking').textContent = 'Publier';
  document.querySelectorAll('.score-select').forEach(select => select.value = '3');
  updateTotal();
  loadRound();
  alert('Interface locale remise à zéro. La session Supabase reste intacte pour ce test.');
}

document.getElementById('resetBattle').addEventListener('click', resetBattleLocal);
document.getElementById('createSessionButton').addEventListener('click', createTrainerSession);
document.getElementById('joinSessionButton').addEventListener('click', joinSessionByCode);
document.getElementById('sessionCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinSessionByCode();
});
document.getElementById('sessionCodeInput').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

async function init() {
  buildTrainerTeams();
  buildScores();
  buildLeaderboard();
  loadRound();
  try {
    await ensureAnonymousAuth();
  } catch (error) {
    console.error(error);
    setConnectionStatus('Connexion impossible', 'error');
  }
}

init();
