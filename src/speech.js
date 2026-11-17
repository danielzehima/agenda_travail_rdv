// Dictée avec la reconnaissance vocale du navigateur (Chrome Android, Edge…),
// présentée avec la même interface que la dictée de claude.ai.

export function browserDictation() {
  const SR = globalThis.window && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) return null;

  const handlers = { partial: new Set(), final: new Set(), state: new Set() };
  const emit = (k, v) => handlers[k].forEach((f) => f(v));
  const on = (k) => (f) => { handlers[k].add(f); return () => handlers[k].delete(f); };
  let rec = null;

  return {
    onPartial: on('partial'),
    onFinal: on('final'),
    onState: on('state'),
    start() {
      return new Promise((resolve, reject) => {
        rec = new SR();
        rec.lang = 'fr-FR';
        rec.interimResults = true;
        rec.continuous = true;
        let reason = 'stopped';
        rec.onstart = () => { emit('state', { state: 'listening' }); resolve(); };
        rec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) emit('final', { text: r[0].transcript.trim() });
            else interim += r[0].transcript;
          }
          emit('partial', { text: interim.trim() });
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            reason = 'not_granted';
            reject(Object.assign(new Error('Micro refusé'), { code: 'not_granted' }));
          } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
            reason = 'upstream_error';
          }
        };
        rec.onend = () => { emit('state', { state: 'idle', reason }); rec = null; };
        emit('state', { state: 'starting' });
        try { rec.start(); } catch (err) { reject(Object.assign(err, { code: 'unavailable' })); }
      });
    },
    stop() {
      rec?.stop();
      return Promise.resolve();
    },
  };
}
