import type { Notification, NotificationType } from '@cakal/shared-types';

/**
 * Telegram Notification Service
 *
 * Bildirim kuralları:
 * - Anlık: puanı yüksek, süresi az fırsat → anında
 * - Haftalık özet: Pazartesi sabahı otomatik
 * - Watchlist alarmı: takip edilen ürün fiyatı düşerse
 * - Profil güncellemesi: haftalık karakter raporu
 */

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramNotifier {
  private config: TelegramConfig | null = null;

  configure(config: TelegramConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config !== null && !!this.config.botToken && !!this.config.chatId;
  }

  async send(notification: Notification): Promise<boolean> {
    if (!this.config) {
      console.warn('[Telegram] Not configured, skipping notification');
      return false;
    }

    const text = this.formatMessage(notification);
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        console.error('[Telegram] Send failed:', response.statusText);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Telegram] Send error:', error);
      return false;
    }
  }

  private formatMessage(notification: Notification): string {
    const icon = this.getIcon(notification.type);
    return `${icon} <b>${notification.title}</b>\n\n${notification.body}`;
  }

  private getIcon(type: NotificationType): string {
    switch (type) {
      case 'opportunity': return '🎯';
      case 'weekly-summary': return '📊';
      case 'watchlist-alert': return '🔔';
      case 'profile-update': return '👤';
      default: return '📌';
    }
  }
}

export const telegramNotifier = new TelegramNotifier();
