/*
 * Prompt Battle : chargement et validation des paquets de scénarios (V2.12).
 *
 * Un paquet = un fichier JSON dans scenarios/, déclaré dans scenarios/index.json.
 * Ce fichier ne touche ni à l'écran ni à Supabase : il charge, vérifie, et renvoie
 * soit un paquet valide, soit une erreur PackError avec un message en français.
 */
(function (root) {
  const PACK_INDEX_URL = 'scenarios/index.json';
  const PACK_SCHEMA_VERSION = 1;
  // Le moteur joue toujours 2 manches.
  const PACK_ROUND_COUNT = 2;
  // Ces 4 clés correspondent aux colonnes de la table trainer_evaluations : on ne peut pas les changer sans migration.
  const PACK_CRITERIA_KEYS = ['pertinence', 'precision', 'context_score', 'utility'];
  const PACK_CRITERION_MAX = 5;
  const PACK_SCALE_MAX = 20;
  const PACK_METHOD = ['Rôle', 'Contexte', 'Tâche', 'Format'];
  const PACK_DURATION_MIN = 60;
  const PACK_DURATION_MAX = 3600;
  const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
  const PACK_FILE_PATTERN = /^scenarios\/[a-z0-9][a-z0-9-]*\.json$/;
  const MAX_ERRORS_SHOWN = 8;

  class PackError extends Error {
    constructor(title, details = []) {
      const shown = details.slice(0, MAX_ERRORS_SHOWN);
      const more = details.length - shown.length;
      const lines = shown.map(d => `- ${d}`);
      if (more > 0) lines.push(`- … et ${more} autre${more > 1 ? 's' : ''} problème${more > 1 ? 's' : ''}.`);
      super(lines.length ? `${title}\n${lines.join('\n')}` : title);
      this.name = 'PackError';
      this.title = title;
      this.details = details;
    }
  }

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isText = value => typeof value === 'string' && value.trim().length > 0;
  const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((item, i) => item === b[i]);

  function validatePackIndex(data) {
    const errors = [];
    if (!isObject(data)) return ['le fichier doit contenir un objet JSON.'];
    if (data.schemaVersion !== PACK_SCHEMA_VERSION) errors.push(`« schemaVersion » doit valoir ${PACK_SCHEMA_VERSION}.`);
    if (!Array.isArray(data.packs) || data.packs.length === 0) {
      errors.push('« packs » doit être une liste contenant au moins un paquet.');
      return errors;
    }
    const seen = new Set();
    data.packs.forEach((entry, i) => {
      const where = `paquet n° ${i + 1}`;
      if (!isObject(entry)) {
        errors.push(`${where} : doit être un objet.`);
        return;
      }
      if (typeof entry.id !== 'string' || !PACK_ID_PATTERN.test(entry.id)) {
        errors.push(`${where} : « id » manquant ou invalide (lettres minuscules, chiffres et tirets uniquement).`);
      } else if (seen.has(entry.id)) {
        errors.push(`${where} : l'identifiant « ${entry.id} » est utilisé deux fois.`);
      } else {
        seen.add(entry.id);
      }
      if (!isText(entry.title)) errors.push(`${where} : « title » manquant ou vide.`);
      if (!isText(entry.description)) errors.push(`${where} : « description » manquante ou vide.`);
      if (typeof entry.file !== 'string' || !PACK_FILE_PATTERN.test(entry.file)) {
        errors.push(`${where} : « file » doit pointer vers un fichier du dossier scenarios/ (par exemple scenarios/mon-paquet.json).`);
      }
    });
    return errors;
  }

  function validateScenario(scenario, number) {
    const errors = [];
    const where = `scénario ${number}${isObject(scenario) && isText(scenario.id) ? ` (${scenario.id})` : ''}`;
    if (!isObject(scenario)) return [`${where} : doit être un objet.`];

    ['id', 'title', 'situation', 'mission'].forEach(field => {
      if (!isText(scenario[field])) errors.push(`${where} : champ « ${field} » manquant ou vide.`);
    });

    const duration = scenario.durationSeconds;
    if (!Number.isInteger(duration) || duration < PACK_DURATION_MIN || duration > PACK_DURATION_MAX) {
      errors.push(`${where} : « durationSeconds » doit être un nombre entier de secondes entre ${PACK_DURATION_MIN} et ${PACK_DURATION_MAX}.`);
    }

    if (!sameList(scenario.method, PACK_METHOD)) {
      errors.push(`${where} : « method » doit être exactement ${JSON.stringify(PACK_METHOD)} dans cet ordre.`);
    }

    const grading = scenario.grading;
    if (!isObject(grading)) {
      errors.push(`${where} : bloc « grading » manquant.`);
    } else {
      if (grading.scaleMax !== PACK_SCALE_MAX) errors.push(`${where} : « grading.scaleMax » doit valoir ${PACK_SCALE_MAX}.`);
      const criteria = grading.criteria;
      if (!Array.isArray(criteria) || criteria.length !== PACK_CRITERIA_KEYS.length) {
        errors.push(`${where} : « grading.criteria » doit contenir exactement ${PACK_CRITERIA_KEYS.length} critères.`);
      } else {
        criteria.forEach((criterion, i) => {
          const cWhere = `${where}, critère ${i + 1}`;
          if (!isObject(criterion)) {
            errors.push(`${cWhere} : doit être un objet.`);
            return;
          }
          if (criterion.key !== PACK_CRITERIA_KEYS[i]) errors.push(`${cWhere} : « key » doit valoir « ${PACK_CRITERIA_KEYS[i]} ».`);
          if (!isText(criterion.label)) errors.push(`${cWhere} : « label » manquant ou vide.`);
          if (!isText(criterion.question)) errors.push(`${cWhere} : « question » manquante ou vide.`);
          if (criterion.max !== PACK_CRITERION_MAX) errors.push(`${cWhere} : « max » doit valoir ${PACK_CRITERION_MAX}.`);
        });
      }
    }

    if (scenario.material !== undefined) {
      const material = scenario.material;
      if (!isObject(material) || !isText(material.title) || !isText(material.text)) {
        errors.push(`${where} : « material » doit contenir un « title » et un « text » non vides.`);
      }
    }
    // Champs facultatifs prévus pour une future manche de notation, non utilisés pour l'instant.
    if (scenario.fictitiousCopies !== undefined && !Array.isArray(scenario.fictitiousCopies)) {
      errors.push(`${where} : « fictitiousCopies » doit être une liste.`);
    }
    if (scenario.referenceGrade !== undefined
      && !(typeof scenario.referenceGrade === 'number' && scenario.referenceGrade >= 0 && scenario.referenceGrade <= PACK_SCALE_MAX)) {
      errors.push(`${where} : « referenceGrade » doit être un nombre entre 0 et ${PACK_SCALE_MAX}.`);
    }
    return errors;
  }

  function validatePack(data, entry) {
    const errors = [];
    if (!isObject(data)) return ['le fichier doit contenir un objet JSON.'];
    if (data.schemaVersion !== PACK_SCHEMA_VERSION) errors.push(`« schemaVersion » doit valoir ${PACK_SCHEMA_VERSION}.`);
    if (entry && data.id !== entry.id) errors.push(`« id » (${JSON.stringify(data.id)}) ne correspond pas à l'index (« ${entry.id} »).`);
    if (!isText(data.title)) errors.push('« title » manquant ou vide.');
    if (!isText(data.description)) errors.push('« description » manquante ou vide.');
    if (!Array.isArray(data.scenarios) || data.scenarios.length !== PACK_ROUND_COUNT) {
      errors.push(`« scenarios » doit contenir exactement ${PACK_ROUND_COUNT} scénarios (une par manche).`);
      return errors;
    }
    const ids = new Set();
    data.scenarios.forEach((scenario, i) => {
      errors.push(...validateScenario(scenario, i + 1));
      if (isObject(scenario) && isText(scenario.id)) {
        if (ids.has(scenario.id)) errors.push(`scénario ${i + 1} : l'identifiant « ${scenario.id} » est utilisé deux fois.`);
        ids.add(scenario.id);
      }
    });
    return errors;
  }

  async function fetchJson(url) {
    let response;
    try {
      response = await fetch(url, { cache: 'no-cache' });
    } catch (error) {
      throw new PackError(`Impossible de charger le fichier ${url}. Vérifiez la connexion, puis rechargez la page.`);
    }
    if (!response.ok) {
      throw new PackError(`Le fichier ${url} est introuvable ou inaccessible (code ${response.status}).`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new PackError(`Le fichier ${url} n'est pas un JSON valide : ${error.message}`);
    }
  }

  let indexPromise = null;
  const packPromises = new Map();

  function loadPackIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        const data = await fetchJson(PACK_INDEX_URL);
        const errors = validatePackIndex(data);
        if (errors.length) throw new PackError(`La liste des formations (${PACK_INDEX_URL}) contient des erreurs :`, errors);
        return data.packs;
      })();
      // Un échec ne doit pas rester en mémoire : un nouvel essai doit être possible.
      indexPromise.catch(() => { indexPromise = null; });
    }
    return indexPromise;
  }

  function loadPack(id) {
    if (!packPromises.has(id)) {
      const promise = (async () => {
        const packs = await loadPackIndex();
        const entry = packs.find(p => p.id === id);
        if (!entry) {
          const known = packs.map(p => `« ${p.id} »`).join(', ');
          throw new PackError(`La formation « ${id} » n'existe pas dans cette version de l'application (formations connues : ${known}).`);
        }
        const data = await fetchJson(entry.file);
        const errors = validatePack(data, entry);
        if (errors.length) throw new PackError(`Le fichier ${entry.file} (formation « ${id} ») contient des erreurs :`, errors);
        return data;
      })();
      packPromises.set(id, promise);
      promise.catch(() => packPromises.delete(id));
    }
    return packPromises.get(id);
  }

  const api = {
    PACK_ROUND_COUNT,
    PackError,
    validatePackIndex,
    validatePack,
    loadPackIndex,
    loadPack
  };
  root.PromptBattlePacks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
