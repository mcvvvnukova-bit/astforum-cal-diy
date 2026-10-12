export function allowCalRequest(method, urlValue, body) {
  const url = new URL(urlValue);
  if (url.origin !== 'https://cal.astforum.ru') return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (method !== 'POST') return false;
  const root = '/api/trpc/slots/';
  if (!url.pathname.startsWith(root)) return false;
  try {
    const procedures = decodeURIComponent(url.pathname.slice(root.length)).split(',');
    if (!procedures.length || procedures.some(name => name !== 'reserveSlot')) return false;
    const value = JSON.parse(body);
    const dry = input => input && typeof input === 'object' && !Array.isArray(input)
      && !Object.hasOwn(input, 'meta')
      && input.json && typeof input.json === 'object' && !Array.isArray(input.json)
      && input.json._isDryRun === true;
    if (url.searchParams.get('batch') === '1') {
      return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === procedures.length
        && procedures.every((_, index) => Object.hasOwn(value, String(index)) && dry(value[String(index)]));
    }
    return procedures.length === 1 && dry(value);
  } catch { return false; }
}
