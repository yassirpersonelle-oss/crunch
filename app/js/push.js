// Crunch - Web Push subscription (iOS 16.4+ home-screen app, desktop browsers).
(function () {
  const Store = window.Store;
  const b64ToBytes = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const Push = {
    label() {
      if (Store.DEMO) return 'Demo';
      if (!supported()) return isIOS && !standalone() ? 'Add to Home Screen first' : 'Not supported';
      return Notification.permission === 'granted' ? 'On' : Notification.permission === 'denied' ? 'Blocked' : 'Off';
    },
    async enable() {
      const app = window.app;
      if (Store.DEMO) return app.dialog.alert('Notifications are off in demo mode.', 'Demo');
      if (!supported()) {
        return app.dialog.alert(isIOS ? 'On iPhone: tap Share, then "Add to Home Screen", open Crunch from the home screen, then turn this on.' : 'This browser cannot receive notifications.', 'Notifications');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return app.dialog.alert('Allow notifications for Crunch in Settings.', 'Notifications');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(window.CRUNCH_CONFIG.vapidPublicKey) });
      const json = sub.toJSON();
      const { error } = await Store.client().from('push_subs').upsert({
        user_id: Store.state.user.id, endpoint: json.endpoint, keys: json.keys, device: isIOS ? 'iphone' : 'pc',
      }, { onConflict: 'endpoint' });
      if (error) return app.dialog.alert(error.message, 'Could not save');
      app.toast.create({ text: 'Notifications on', closeTimeout: 1600, position: 'center' }).open();
    },
  };
  window.Push = Push;
})();
