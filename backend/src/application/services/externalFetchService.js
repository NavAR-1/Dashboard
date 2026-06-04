const AppError = require('../../domain/AppError');

function createExternalFetchService({ baseUrl, source }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(method, path, body) {
    if (!root) throw new AppError(`${source} API base URL is not configured`, 503);
    const opts = {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const response = await fetch(root + path, opts);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {
      throw new AppError(`${source} API returned invalid JSON`, 502);
    }
    if (!response.ok) throw new AppError(data?.error || `${source} API request failed (${response.status})`, response.status);
    return data;
  }

  return {
    fetchJson:  (path)        => request('GET',  path),
    postJson:   (path, body)  => request('POST', path, body),
  };
}

module.exports = createExternalFetchService;
