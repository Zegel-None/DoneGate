// DSH HTTP 同源路由共享 JSON 响应原语（供 host-routes / host-auth-guard / ui-board-routes 等复用）
export function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}
