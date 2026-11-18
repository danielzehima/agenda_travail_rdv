// Contenu des rappels envoyés par notification (fonctions pures, testées).

// Date et heure locales d'un fuseau horaire (ex. « Africa/Abidjan »)
export function localNow(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return true; } catch { return false; }
}

// Quel rappel envoyer maintenant ? (une seule fois par jour grâce au journal des envois)
export function dueSlot({ hour }, { morningHour = 7, eveningHour = 17 }, alreadySent) {
  if (hour >= eveningHour && hour < eveningHour + 3 && !alreadySent.has('evening')) return 'evening';
  if (hour >= morningHour && hour < Math.min(morningHour + 3, eveningHour) && !alreadySent.has('morning')) return 'morning';
  return null;
}

const label = (i) => (i.time ? `${i.time} ${i.title}` : i.title);
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99');
const list = (arr, max = 4) => arr.slice(0, max).map(label).join(' · ') + (arr.length > max ? ` · +${arr.length - max}` : '');

export function morningMessage(items, day) {
  const todays = items.filter((i) => i.date === day && i.type !== 'journal').sort(byTime);
  const late = items.filter((i) => i.type !== 'journal' && !i.validated && i.date < day);
  if (!todays.length) {
    return {
      title: "Programme du jour : rien de prévu",
      body: late.length ? `${late.length} élément(s) en retard à valider. Dictez votre programme à l'assistant.` : "Dictez votre programme de la journée à l'assistant.",
    };
  }
  const rdv = todays.filter((i) => i.type === 'rdv').length;
  const work = todays.length - rdv;
  const head = [work && `${work} ${work > 1 ? 'travaux' : 'travail'}`, rdv && `${rdv} rendez-vous`].filter(Boolean).join(' et ');
  return {
    title: `Programme du jour : ${head}`,
    body: list(todays) + (late.length ? `\n+ ${late.length} en retard` : ''),
  };
}

export function eveningMessage(items, day) {
  const todays = items.filter((i) => i.date === day);
  const tasks = todays.filter((i) => i.type !== 'journal').sort(byTime);
  const pending = tasks.filter((i) => !i.validated);
  const noJournal = !todays.some((i) => i.type === 'journal');
  if (!tasks.length) {
    return { title: 'Fin de journée', body: noJournal ? "Qu'avez-vous fait aujourd'hui ? Dictez-le à l'assistant." : 'Bonne soirée !' };
  }
  if (!pending.length) {
    return { title: `Bravo : ${tasks.length}/${tasks.length} validés`, body: noJournal ? "Tout est validé. Notez ce que vous avez fait aujourd'hui." : 'Tout le programme est validé. Bonne soirée !' };
  }
  return {
    title: `Fin de journée : ${tasks.length - pending.length}/${tasks.length} validés`,
    body: `Le programme a-t-il été exécuté ? À valider : ${list(pending)}`,
  };
}
