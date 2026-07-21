// Otonom entegrasyon köprüsü: secret girildiğinde main process'ten gelen
// "devam et" sinyalini ChatScreen'e taşır. ChatScreen o an mount değilse
// (kullanıcı Ayarlar ekranında) mesaj bekletilir ve mount olunca teslim edilir.

export interface AutoContinuePayload {
  text: string;
  display: string;
}

let pending: AutoContinuePayload | null = null;
let listener: ((payload: AutoContinuePayload) => void) | null = null;

export function pushAutoContinue(payload: AutoContinuePayload) {
  if (listener) {
    listener(payload);
  } else {
    pending = payload;
  }
}

export function subscribeAutoContinue(fn: (payload: AutoContinuePayload) => void): () => void {
  listener = fn;
  if (pending) {
    const payload = pending;
    pending = null;
    fn(payload);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
