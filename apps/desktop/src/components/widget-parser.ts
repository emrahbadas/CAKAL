// Widget parser — extracted from WidgetRenderer to avoid HMR invalidation
const WIDGET_REGEX = /```\s*widget\s*[\r\n]+([\s\S]*?)```/gi;

export function parseWidgetsFromContent(content: string): { text: string; widgets: { html: string; title?: string }[] } {
  const widgets: { html: string; title?: string }[] = [];
  const text = content.replace(WIDGET_REGEX, (match, htmlStr) => {
    const trimmed = htmlStr.trim();
    if (trimmed.length > 50) { // minimum viable HTML
      // Extract title from first <h2> or <div> if present
      const titleMatch = trimmed.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/i);
      widgets.push({
        html: trimmed,
        title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : undefined,
      });
      return '';
    }
    return match;
  }).trim();

  return { text, widgets };
}
