/* Slow/disconnected clients must not retain timers or grow writable buffers forever. */
export function attachStream(req, res, clients, hello, { intervalMs = 20000 } = {}) {
  let timer;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clients.delete(res);
    req.off?.('close', close);
    res.off?.('close', close);
    res.off?.('error', close);
  };
  const send = (data) => {
    if (closed || res.destroyed || res.writableEnded) { close(); return false; }
    try {
      if (!res.write(data)) { close(); res.destroy?.(); return false; }
      return true;
    } catch { close(); res.destroy?.(); return false; }
  };
  req.on('close', close);
  res.on('close', close);
  res.on('error', close);
  clients.add(res);
  if (send(hello)) {
    timer = setInterval(() => send(`: ping ${Date.now()}\n\n`), intervalMs);
    timer.unref?.();
  }
  return close;
}
