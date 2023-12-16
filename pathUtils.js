export function generateArc(d, NUM) {
  var sourceLngLat = d.source,
    targetLngLat = d.target;

  if (targetLngLat && sourceLngLat) {
    var sourceX = sourceLngLat.x,
      sourceY = sourceLngLat.y;

    var targetX = targetLngLat.x,
      targetY = targetLngLat.y;

    var dx = targetX - sourceX,
      dy = targetY - sourceY;

    var initialPoint = { x: sourceX, y: sourceY };
    var finalPoint = { x: targetX, y: targetY };
    d.r = Math.sqrt(sq(dx) + sq(dy)) * 0.75;
    var centers = findCenters(d.r, initialPoint, finalPoint);
    var path = drawCircleArcSVG(
      centers.c1,
      d.r,
      initialPoint,
      finalPoint,
      NUM,
      0,
      d.targetNodeRadius
    );
    return path;
  }
}

function sq(x) {
  return x * x;
}

function findCenters(r, p1, p2) {
  var pm = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
  var perpABdx = -(p2.y - p1.y);
  var perpABdy = p2.x - p1.x;
  var norm = Math.sqrt(sq(perpABdx) + sq(perpABdy));
  perpABdx /= norm;
  perpABdy /= norm;
  var dpmp1 = Math.sqrt(sq(pm.x - p1.x) + sq(pm.y - p1.y));
  var sin = dpmp1 / r;
  if (sin < -1 || sin > 1) return null;
  var cos = Math.sqrt(1 - sq(sin));
  var d = r * cos;
  var res1 = { x: pm.x + perpABdx * d, y: pm.y + perpABdy * d };
  var res2 = { x: pm.x - perpABdx * d, y: pm.y - perpABdy * d };
  return { c1: res1, c2: res2 };
}

function polarToCartesian(centerX, centerY, radius, angleInDegrees, offset) {
  var angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;

  return {
    x: centerX + radius * Math.cos(angleInRadians) - offset * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians) - offset * Math.sin(angleInRadians),
  };
}

function describeArc(x, y, radius, startAngle, endAngle, NUM, sourceNodeRadius, targetNodeRadius) {
  var large_arc_flag = endAngle - startAngle <= 180 ? '0' : '1';
  var start = polarToCartesian(x, y, radius, startAngle, sourceNodeRadius || 0);
  var end = polarToCartesian(x, y, radius, endAngle, targetNodeRadius || 0);
  if (NUM === 1) {
    var sweep_flag = 0;
  } else if (NUM === 2) {
    var sweep_flag = 1;
  }

  var d = [
    'M',
    start.x,
    start.y,
    'A',
    radius,
    radius,
    0,
    large_arc_flag,
    sweep_flag,
    end.x,
    end.y,
  ].join(' ');

  return d;
}

function drawCircleArcSVG(c, r, p1, p2, NUM, sourceNodeRadius, targetNodeRadius) {
  var ang1 = (Math.atan2(p1.y - c.y, p1.x - c.x) * 180) / Math.PI + 90;
  var ang2 = (Math.atan2(p2.y - c.y, p2.x - c.x) * 180) / Math.PI + 90;
  var path = describeArc(c.x, c.y, r, ang1, ang2, NUM, sourceNodeRadius, targetNodeRadius);
  return path;
}

export function generatePath (d, excludeRadius) {
  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const gamma = Math.atan2(dy, dx) // Math.atan2 returns the angle in the correct quadrant as opposed to Math.atan

  let sourceNewX, sourceNewY, targetNewX, targetNewY
  if (excludeRadius) {
    sourceNewX = d.source.x + Math.cos(gamma) * d.source.r
    sourceNewY = d.source.y + Math.sin(gamma) * d.source.r
    targetNewX = d.target.x - Math.cos(gamma) * d.target.r
    targetNewY = d.target.y - Math.sin(gamma) * d.target.r
  } else {
    sourceNewX = d.source.x
    sourceNewY = d.source.y
    targetNewX = d.target.x
    targetNewY = d.target.y
  }

  // Coordinates of mid point on line to add new vertex.
  const midX = (targetNewX - sourceNewX) / 2 + sourceNewX
  const midY = (targetNewY - sourceNewY) / 2 + sourceNewY
  return 'M' + sourceNewX + ',' + sourceNewY + 'L' + midX + ',' + midY + 'L' + targetNewX + ',' + targetNewY
}