// Application installable + rappels par notification (Web Push).
import { api } from './sync.js';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let regPromise = null;
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!regPromise) regPromise = navigator.serviceWorker.register('/sw.js').catch(() => null);
  return regPromise;
}

function base64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// État des rappels sur cet appareil : unsupported | denied | off | on
export async function pushState() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registerServiceWorker();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  if (!supported()) throw new Error("Ce navigateur ne gère pas les notifications. Ouvrez l'app dans Chrome.");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées. Autorisez-les dans les réglages de Chrome pour ce site.');
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Impossible d'activer les rappels sur cet appareil.");
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('GET', 'push');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  await api('POST', 'push', { subscription: sub.toJSON(), timezone });
  return { timezone };
}

export async function disablePush() {
  const reg = await registerServiceWorker();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await api('DELETE', 'push', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}

export const sendTestPush = () => api('POST', 'push', { test: true });

// Notification locale (app ouverte) : sur Android, elle doit passer par le service worker
export async function showLocal(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await registerServiceWorker();
  if (reg?.showNotification) {
    reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/badge-96.png', data: { url: '/#aujourdhui' } });
  } else {
    try { new Notification(title, { body, tag, icon: '/icon-192.png' }); } catch { /* non géré */ }
  }
}
