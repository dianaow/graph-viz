export function generateArc (d, NUM, excludeRadius) {
  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y

  const initialPoint = { x: d.source.x, y: d.source.y }
  const finalPoint = { x: d.target.x, y: d.target.y }
  d.r = Math.sqrt(sq(dx) + sq(dy)) * 0.75
  const centers = findCenters(d.r, initialPoint, finalPoint)
  const path = drawCircleArcSVG(centers.c1, d.r, initialPoint, finalPoint, NUM, d.source.radius, d.target.radius + d.strokeWidth + 5 * d.strokeWidth * 0.8)
  return path
}

function sq (x) {
  return x * x
}

function findCenters (r, p1, p2) {
  const pm = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) }
  let perpABdx = -(p2.y - p1.y)
  let perpABdy = p2.x - p1.x
  const norm = Math.sqrt(sq(perpABdx) + sq(perpABdy))
  perpABdx /= norm
  perpABdy /= norm
  const dpmp1 = Math.sqrt(sq(pm.x - p1.x) + sq(pm.y - p1.y))
  const sin = dpmp1 / r
  if (sin < -1 || sin > 1) return null
  const cos = Math.sqrt(1 - sq(sin))
  const d = r * cos
  const res1 = { x: pm.x + perpABdx * d, y: pm.y + perpABdy * d }
  const res2 = { x: pm.x - perpABdx * d, y: pm.y - perpABdy * d }
  return { c1: res1, c2: res2 }
}

function polarToCartesian (centerX, centerY, radius, angleInDegrees, offset) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0

  return {
    x: centerX + radius * Math.cos(angleInRadians) - offset * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians) - offset * Math.sin(angleInRadians)
  }
}

function describeArc (x, y, radius, startAngle, endAngle, NUM, sourceNodeRadius, targetNodeRadius) {
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1'
  const start = polarToCartesian(x, y, radius, startAngle, sourceNodeRadius || 0)
  const end = polarToCartesian(x, y, radius, endAngle, targetNodeRadius || 0)
  let sweepFlag = 0
  if (NUM === 1) {
    sweepFlag = 0
  } else if (NUM === 2) {
    sweepFlag = 1
  }

  const d = ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, sweepFlag, end.x, end.y].join(' ')

  return d
}

function drawCircleArcSVG (c, r, p1, p2, NUM, sourceNodeRadius, targetNodeRadius) {
  const ang1 = (Math.atan2(p1.y - c.y, p1.x - c.x) * 180) / Math.PI + 90
  const ang2 = (Math.atan2(p2.y - c.y, p2.x - c.x) * 180) / Math.PI + 90
  const path = describeArc(c.x, c.y, r, ang1, ang2, NUM, sourceNodeRadius, targetNodeRadius)
  return path
}

export function generatePath (d, excludeRadius) {
  const dx = d.target.x - d.source.x
  const dy = d.target.y - d.source.y
  const gamma = Math.atan2(dy, dx) // Math.atan2 returns the angle in the correct quadrant as opposed to Math.atan

  let sourceNewX, sourceNewY, targetNewX, targetNewY
  if (excludeRadius) {
    sourceNewX = d.source.x + Math.cos(gamma) * d.source.radius
    sourceNewY = d.source.y + Math.sin(gamma) * d.source.radius
    targetNewX = d.target.x - Math.cos(gamma) * d.target.radius
    targetNewY = d.target.y - Math.sin(gamma) * d.target.radius
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
