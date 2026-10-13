// Route through visible corners rather than forcing upward edges into a loop.
export function segmentBlocked(a, b, box) {
  let low = 0, high = 1;
  for (const [axis, min, max] of [['x', box.left, box.right], ['y', box.top, box.bottom]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] <= min + 1e-7 || a[axis] >= max - 1e-7) return false;
    } else {
      const t1 = (min + 1e-7 - a[axis]) / delta;
      const t2 = (max - 1e-7 - a[axis]) / delta;
      low = Math.max(low, Math.min(t1, t2));
      high = Math.min(high, Math.max(t1, t2));
    }
  }
  return low < high && high > 0 && low < 1;
}

function crosses(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

export function routeConnection(start, end, nodes, from, to, previous = []) {
  const boxes = nodes.map(n => {
    const padding = n.id === from || n.id === to ? 0 : 16;
    return { left: n.x - n.w / 2 - padding, right: n.x + n.w / 2 + padding, top: n.y - n.h / 2 - padding, bottom: n.y + n.h / 2 + padding };
  });
  const clear = (a, b) => !boxes.some(box => segmentBlocked(a, b, box));
  if (clear(start, end) && !previous.some(route => route.slice(1).some((point, i) => crosses(start, end, route[i], point)))) return [start, end];
  const points = [start, end];
  for (const box of boxes) {
    for (const x of [box.left, box.right]) for (const y of [box.top, box.bottom]) {
      const point = { x, y };
      if (!boxes.some(other => x > other.left && x < other.right && y > other.top && y < other.bottom)) points.push(point);
    }
  }
  const costs = points.map(() => Infinity), parents = points.map(() => -1), visited = new Set();
  costs[0] = 0;
  while (visited.size < points.length) {
    let current = -1;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
    if (current < 0 || !Number.isFinite(costs[current])) break;
    if (current === 1) {
      const result = [];
      for (let i = 1; i !== -1; i = parents[i]) result.unshift(points[i]);
      return result;
    }
    visited.add(current);
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i) || !clear(points[current], points[i])) continue;
      let penalty = 0;
      for (const route of previous) for (let j = 1; j < route.length; j++) {
        if (crosses(points[current], points[i], route[j - 1], route[j])) penalty += 80;
      }
      const cost = costs[current] + Math.hypot(points[i].x - points[current].x, points[i].y - points[current].y) + penalty + 8;
      if (cost < costs[i]) { costs[i] = cost; parents[i] = current; }
    }
  }
  // Overlapping nodes may leave no free route.
  return [start, end];
}

export function routeGeometry(points) {
  let longest = 0, label = points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longest) { longest = length; label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  }
  return { d: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), lx: label.x, ly: label.y - 8 };
}
