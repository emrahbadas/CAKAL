const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const baseUrl = (process.env.MKK_VYK_BASE_URL || 'https://apigwdev.mkk.com.tr/api/vyk').replace(/\/+$/, '');
  const apiKey = process.env.MKK_VYK_API_KEY;
  const apiSecret = process.env.MKK_VYK_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('MKK_VYK_API_KEY ve MKK_VYK_API_SECRET gerekli.');
  }

  const response = await fetch(`${baseUrl}/lastDisclosureIndex`, {
    method: 'GET',
    headers: {
      Accept: 'application/json, */*;q=0.8',
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      'User-Agent': 'CakalMkkVykSmoke/1.0',
    },
  });
  const text = await response.text();
  const body = parseJsonOrText(text);
  const result = {
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    endpoint: '/lastDisclosureIndex',
    productAccessHint: response.status === 401 || response.status === 403
      ? 'Portalda API Product aboneligi/erisimi eksik olabilir.'
      : undefined,
    body,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exit(1);
}

function parseJsonOrText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
