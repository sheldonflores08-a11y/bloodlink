/**
 * public/js/api.js
 * ----------------
 * Tiny fetch wrapper for talking to the BloodLink API.
 * Every response looks like { ok, message?, ...data }.
 * Throws Error(message) on failure so pages can catch it.
 */
const API = {
  async call(method, url, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error('Cannot reach the server. Is BloodLink running?');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok || !data || data.ok === false) {
      // Only redirect to login when the *session itself* is gone.
      if (res.status === 401 && url === '/api/auth/me') {
        if (!/^\/(login|register)$/.test(location.pathname)) location.href = '/login';
      }
      throw new Error(data && data.message ? data.message : 'Something went wrong.');
    }
    return data;
  },
  get: (url) => API.call('GET', url),
  post: (url, body) => API.call('POST', url, body),
  put: (url, body) => API.call('PUT', url, body),
  del: (url) => API.call('DELETE', url)
};
