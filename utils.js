// Function to split long text into lines
export function splitLongText (text, maxLineLength) {
  const words = text ? text.split(' ') : []
  const lines = []
  let currentLine = ''

  words.forEach(function (word) {
    if (currentLine.length + word.length <= maxLineLength) {
      currentLine += word + ' '
    } else {
      lines.push(currentLine.trim())
      currentLine = word + ' '
    }
  })

  if (currentLine.trim() !== '') {
    lines.push(currentLine.trim())
  }

  return lines
}

export function getTextSize (text, fontSize, fontFamily) {
  // Create a temporary span element
  const span = document.createElement('span')
  span.textContent = text

  // Set the font for the text measurement
  span.style.fontSize = fontSize
  span.style.fontFamily = fontFamily

  // Append the span to the document body
  document.body.appendChild(span)

  // Measure the width and height of the text
  const width = span.offsetWidth
  const height = span.offsetHeight

  // Clean up the temporary span
  document.body.removeChild(span)

  return { width, height }
}

// Function to generate RGB color code from HSL values
export function hslToRgb(h, s, l) {
    let r, g, b;

    if (s == 0) {
        r = g = b = l; // Achromatic
    } else {
        const hueToRgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToRgb(p, q, h + 1 / 3);
        g = hueToRgb(p, q, h);
        b = hueToRgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Function to combine colors
export function mixColors(color1, color2) {
  // Perform color mixing logic here
  // For example, you can average the RGB values or use a different mixing algorithm
  if(!color2) color2 = color1
  const mixedColor = [
      (color1[0] + color2[0]) / 2.5,
      (color1[1] + color2[1]) / 2.5,
      (color1[2] + color2[2]) / 2.5
  ];
  return mixedColor;
}

// Function to get root nodes (nodes with no incoming edges)
export function getRootNodes(graph) {
  const rootNodes = [];
  graph.forEachNode(node => {
      // Check if the node has no incoming edges
      if (graph.inDegree(node) === 0) {
          rootNodes.push(node);
      }
  });
  return rootNodes;
}

// Function to get color of a node
export function getNodeColor(nodes, nodeId) {
  const node = nodes.find(node => node.id === nodeId);
  if (node) {
      return node.root ? [255,255,255] : node.color;
  } else {
      return null;
  }
}

// Function to set color of a node
export function setNodeColor(nodes, nodeId, color) {
  const node = nodes.find(node => node.id === nodeId);
  if (node) {
      node.color = node.root ? [255,255,255] : color;
  }
}

export function forceCollide () {
  let nodes

  function force (alpha) {
    const quad = d3.quadtree(
      nodes,
      (d) => d.x,
      (d) => d.y
    )
    for (const d of nodes) {
      quad.visit((q, x1, y1, x2, y2) => {
        let updated = false
        if (q.data && q.data !== d) {
          let x = d.x - d.radius - (q.data.x - q.data.radius)
          let y = d.y - d.radius - (q.data.y - q.data.radius)
          const xSpacing = 20 + (q.data.width + d.width) / 2
          const ySpacing = 14 + (q.data.height + d.height) / 2
          const absX = Math.abs(x)
          const absY = Math.abs(y)
          let l
          let lx
          let ly

          if (absX < xSpacing && absY < ySpacing) {
            l = Math.sqrt(x * x + y * y)

            lx = (absX - xSpacing) / l
            ly = (absY - ySpacing) / l

            // the one that's barely within the bounds probably triggered the collision
            if (Math.abs(lx) > Math.abs(ly)) {
              lx = 0
            } else {
              ly = 0
            }
            d.x -= x *= lx
            d.y -= y *= ly
            q.data.x += x
            q.data.y += y

            updated = true
          }
        }
        return updated
      })
    }
  }

  force.initialize = (_) => (nodes = _)

  return force
}

function centroid (nodes) {
  let x = 0
  let y = 0
  let z = 0
  for (const d of nodes) {
    const k = d.radius ** 2
    x += d.x * k
    y += d.y * k
    z += k
  }
  return { x: x / z, y: y / z }
}

function forceCluster () {
  let strength = 0.8
  let nodes
  function force (alpha) {
    const centroids = d3.rollup(nodes, centroid, (d) => d[nodeGroup])
    const l = alpha * strength
    for (const d of nodes) {
      const { x: cx, y: cy } = centroids.get(d[nodeGroup])
      d.vx -= (d.x - cx) * l
      d.vy -= (d.y - cy) * l
    }
  }
  force.initialize = (_) => (nodes = _)
  force.strength = function (_) {
    return arguments.length ? ((strength = +_), force) : strength
  }
  return force
}

// export function findParent(links, entity) {
//   const parents = [];
  
//   // Iterate through each relation
//   Object.keys(links).forEach(key => {
//       const relations = links[key];
      
//       // Check if the entity has a relation with the provided entity
//       relations.forEach(relation => {
//           if (relation.Object === entity) {
//               parents.push(key);
//           }
//       });
//   });
  
//   return parents;
// }

export function findParent(links, entity) {
  const parents = [];

  // Iterate through each relation
  links.forEach(key => {
    if (key.Object === entity) {
      parents.push(key.Subject);
    }
  });

  if(parents.length === 0) {
    const link = links.find(d => d.Subject === entity)
    if (link) parents.push(link.Object)
  }
  
  return parents;
}

export function uniqueElements() {
  // May not be needed in future: Check for duplicate nodes and links, particularly so since we are constructing the graph only based on relations data
  const uniqueNodes = nodes.reduce((acc, node) => {
    // Check if a node with the same 'entity' already exists in the accumulator
    const existingNode = acc.find((n) => n.entity === node.entity);
    // If not found, add the current node to the accumulator
    if (!existingNode) {
      acc.push(node);
    } 
    return acc;
  }, []);

  const uniqueLinks = edges.reduce((acc, link) => {
    // Check if a link with the same 'Subject' and 'Object' already exists in the accumulator
    const existingLink = acc.find(
      (l) => l.Subject === link.Subject && l.Object === link.Object
    );
    // If not found, add the current link to the accumulator
    if (!existingLink) {
      acc.push(link);
    }
    return acc;
  }, []);

  return {nodes: uniqueNodes, links:uniqueLinks}
}