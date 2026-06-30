// Minimal browser WebDAV client built on fetch + Basic auth.
//
// NOTE: because this is a pure front-end app, the WebDAV server MUST allow
// cross-origin requests (CORS) for the methods used below (PROPFIND, MKCOL,
// PUT, GET) including the `Authorization` and `Depth` headers, otherwise the
// browser will block the requests. Self-hosted servers (Nextcloud, dufs,
// rclone serve webdav, ...) can be configured accordingly.

function trimSlashes(s) {
  return String(s || '').replace(/^\/+|\/+$/g, '')
}

// Build an absolute URL from the server base + path segments.
export function buildUrl(cfg, ...segments) {
  const base = String(cfg.url || '').replace(/\/+$/, '')
  const parts = [trimSlashes(cfg.baseDir), ...segments.map(trimSlashes)].filter(
    Boolean
  )
  return parts.length ? `${base}/${parts.join('/')}` : base
}

function authHeaders(cfg) {
  const headers = {}
  if (cfg.username || cfg.password) {
    headers.Authorization =
      'Basic ' + btoa(`${cfg.username || ''}:${cfg.password || ''}`)
  }
  return headers
}

async function dav(cfg, method, url, { headers = {}, body } = {}) {
  return fetch(url, {
    method,
    headers: { ...authHeaders(cfg), ...headers },
    body,
    // Basic auth is sent explicitly; avoid the browser native auth popup.
    credentials: 'omit',
    redirect: 'follow',
  })
}

// Verify credentials + reachability. Returns { ok, status, message }.
export async function testConnection(cfg) {
  if (!cfg.url) return { ok: false, status: 0, message: '请填写服务器地址' }
  try {
    const res = await dav(cfg, 'PROPFIND', buildUrl(cfg), {
      headers: { Depth: '0' },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: '认证失败，请检查用户名/密码' }
    }
    // 207 = multi-status (dir exists); 404 = auth ok but base dir missing yet.
    if (res.status === 207 || res.status === 404 || res.ok) {
      return { ok: true, status: res.status, message: '连接成功' }
    }
    return { ok: false, status: res.status, message: `服务器返回 ${res.status}` }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message: '无法连接（可能是地址错误或 CORS 未开启）',
    }
  }
}

// Create a collection (directory). Idempotent: existing dirs (405) are fine.
async function mkcol(cfg, url) {
  const res = await dav(cfg, 'MKCOL', url)
  if (res.ok || res.status === 405 || res.status === 301) return true
  throw new Error(`MKCOL ${url} -> ${res.status}`)
}

// Ensure the base dir and the standard sub-collections exist.
export async function ensureDirs(cfg) {
  await mkcol(cfg, buildUrl(cfg))
  await mkcol(cfg, buildUrl(cfg, 'books'))
  await mkcol(cfg, buildUrl(cfg, 'meta'))
}

export async function putFile(cfg, path, blob, contentType) {
  const res = await dav(cfg, 'PUT', buildUrl(cfg, ...path.split('/')), {
    headers: contentType ? { 'Content-Type': contentType } : {},
    body: blob,
  })
  if (!res.ok && res.status !== 204) {
    throw new Error(`PUT ${path} -> ${res.status}`)
  }
}

export async function getFile(cfg, path) {
  const res = await dav(cfg, 'GET', buildUrl(cfg, ...path.split('/')))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.blob()
}

export async function putJSON(cfg, path, obj) {
  const body = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json',
  })
  await putFile(cfg, path, body, 'application/json')
}

export async function getJSON(cfg, path) {
  const blob = await getFile(cfg, path)
  if (!blob) return null
  try {
    return JSON.parse(await blob.text())
  } catch {
    return null
  }
}

// List immediate children of a collection. Returns array of decoded basenames.
export async function listDir(cfg, path = '') {
  const url = path ? buildUrl(cfg, ...path.split('/')) : buildUrl(cfg)
  const res = await dav(cfg, 'PROPFIND', url, { headers: { Depth: '1' } })
  if (res.status === 404) return []
  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPFIND ${path} -> ${res.status}`)
  }
  const text = await res.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const hrefs = [...doc.getElementsByTagNameNS('DAV:', 'href')].map(
    (n) => n.textContent || ''
  )
  const self = new URL(url).pathname.replace(/\/+$/, '')
  const names = []
  for (const href of hrefs) {
    let p
    try {
      p = decodeURIComponent(new URL(href, url).pathname)
    } catch {
      p = decodeURIComponent(href)
    }
    p = p.replace(/\/+$/, '')
    if (p === self) continue // skip the collection itself
    names.push(p.split('/').pop())
  }
  return names
}
