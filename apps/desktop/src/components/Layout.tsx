import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { pushAutoContinue } from '../state/autoContinue';

export default function Layout() {
  const navigate = useNavigate();

  // Secret Broker'a bekleyen bir anahtar girildiğinde entegrasyon testini
  // otomatik başlat: sohbete geç ve [OTOMATİK DEVAM] mesajını kuyruğa koy.
  // Event ham secret değeri içermez; sadece ad + capability + test girdisi taşır.
  useEffect(() => {
    const cleanup = window.cakalAPI.onSecretRequestFulfilled?.((data) => {
      const testInput = data.test_input ? JSON.stringify(data.test_input) : '{}';
      pushAutoContinue({
        text:
          `[OTOMATİK DEVAM] secret:${data.name} Secret Broker'a girildi. ` +
          `${data.capability_name} entegrasyon testine geç: run_sandbox_plugin(plugin_id='${data.capability_name}', input=${testInput}) çalıştır ve çıktıyı doğrula. ` +
          `Hata varsa manifesti düzeltip register_sandbox_plugin ile güncelle ve tekrar test et (en fazla 3 deneme). Sonucu net raporla; ek onay isteme.`,
        display: `🔑 secret:${data.name} girildi — ${data.capability_name} testi otomatik başlatılıyor...`,
      });
      navigate('/');
    });
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [navigate]);

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
