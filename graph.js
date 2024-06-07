import * as d3 from 'd3'
import { bfsFromNode } from 'graphology-traversal'
import { dijkstra } from 'graphology-shortest-path'
import Graph from 'graphology'
import { generateArc, generatePath } from './pathUtils.js'
import { findParent, splitLongText, getTextSize, getNodeColor, setNodeColor, getRootNodes, mixColors, hslToRgb, forceCollide  } from './utils.js'

const defaultContainerStyles = {
  'background-color': '#15181F',
  color: '#ffffff',
  'font-family': 'sans-serif'
}

const defaultLabelStyles = {
  fontWeight: 'normal',
  visibility: 'hidden',
  color: '#ffffff',
  label: '',
  edge: {
    visibility: 'hidden',
    opacity: 0.4,
    'font-size': '6px',
    label: ''
  }
}

const defaultNodeStyles = {
  fill: '#ffffff', // node color (only applied if specified)
  // stroke : '#000000', // node stroke color (only applied if specified)
  strokeWidth: 1, // node stroke width, in pixels
  fillOpacity: 0.8, // node stroke opacity
  strokeOpacity: 1, // node stroke opacity
  type: 'standard' // gradient/standard/filled
}

const defaultLinkStyles = {
  // stroke : '#ffffff', // link stroke color (only applied if specified, if not it will follow the source node color)
  strokeOpacity: 0.7, // link stroke opacity
  strokeWidth: 2, // given d in links, returns a stroke width in pixels
  type: 'line' // arc/line
}

export default function ForceGraph (
  {
    nodes, // an iterable of node objects (typically [{id}, …])
    links // an iterable of link objects (typically [{source, target}, …])
  },
  {
    containerSelector,
    nodeId = 'id', // given d in nodes, returns a unique identifier (string)
    sourceId = 'source',
    targetId = 'target',
    nodeGroup, // key in data representing a node group
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    nodeStyles = defaultNodeStyles,
    linkStyles = defaultLinkStyles,
    labelStyles = defaultLabelStyles,
    containerStyles = defaultContainerStyles,
    tooltip = {
      styles: {
        display: 'block',
        position: 'absolute',
        width: 'auto',
        height: 'auto',
        padding: '8px',
        'background-color': '#ffffff',
        color: '#000000',
        border: '1px solid #ddd',
        'z-index': 10
      },
      custom: function (tooltipEl, d) {
        const tooltip = tooltipEl.node()
      }
    },
    preventLabelCollision = false
  } = {}
) {
  // Merge default and user given styles
  containerStyles = { ...defaultContainerStyles, ...containerStyles }
  labelStyles = { ...defaultLabelStyles, ...labelStyles }
  linkStyles = { ...defaultLinkStyles, ...linkStyles }
  nodeStyles = { ...defaultNodeStyles, ...nodeStyles }
  labelStyles.edge = { ...defaultLabelStyles.edge, ...labelStyles.edge }

  if (containerStyles.theme === 'dark') {
    containerStyles['background-color'] = '#15181F'
    containerStyles.color = '#ffffff'
    labelStyles.color = containerStyles.color
  } else if (containerStyles.theme === 'light') {
    containerStyles['background-color'] = '#ffffff'
    containerStyles.color = '#000000'
    labelStyles.color = containerStyles.color
  }
  if (!containerStyles['font-family']) containerStyles['font-family'] = 'Courier'

  // Initial states
  const maxLineLength = 22
  const showEle = {}

  const ele = uniqueElements(nodes, links)

  // Set up accessors to enable a cleaner way of accessing data attributes
  const N = d3.map(ele.nodes, (d) => d[nodeId]).map(intern)
  const LS = d3.map(ele.links, (d) => d[sourceId]).map(intern)
  const LT = d3.map(ele.links, (d) => d[targetId]).map(intern)

  // Replace the input nodes and links with mutable objects for the simulation
  showEle.nodes = d3.map(ele.nodes, (d, i) => ({
    id: N[i],
    ...d
  }))
  showEle.links = d3.map(ele.links, (d, i) => ({
    source: LS[i],
    target: LT[i],
    ...d
  }))

  /// ///////////////// Set up initial  DOM elements on screen ///////////////////
  const container = d3.select(containerSelector)

  for (const prop in containerStyles) {
    container.style(prop, containerStyles[prop])
  }

  // Create a container for tooltip that is only visible on mouseover of a node
  const tooltipDiv = container.append('div').attr('class', 'tooltip').style('visibility', 'hidden')

  for (const prop in tooltip.styles) {
    tooltipDiv.style(prop, tooltip.styles[prop])
  }

  // Create a container for the graph
  const svg = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [-width / 2, -height / 2, width, height])
    .attr('style', 'max-width: 100%; height: auto; pointer-events: auto;')

  const g = svg.append('g').attr('class', 'main-group')

  const linkG = g.append('g').attr('class', 'links')
  const linkTextG = g.append('g').attr('class', 'linkTexts')
  const nodeG = g.append('g').attr('class', 'nodes')
  const textG = g.append('g').attr('class', 'labels')
  /// ////////////////////////////////////////////////////////////////////////////

  /// ///////////////////////// add zoom capabilities ////////////////////////////
  const zoomHandler = d3.zoom().on('zoom', function (event) {
    g.attr('transform', event.transform)
    if (event.transform.k >= 3) {
      svg.selectAll('textPath').attr("visibility", 'visible');
    } else {
      svg.selectAll('textPath').attr('visibility', labelStyles.edge.visibility);
    }
  })

  svg.call(zoomHandler)
  ////////////////////////////////////////////////////////////////////////////////

  ///////////////////////// SIMULATION-RELATED FUNCTIONS /////////////////////////
  const simulation = d3.forceSimulation()
  .force(
    'link',
    d3
      .forceLink()
      .id((d) => d.id)
  )
  .force(
    'x',
    d3.forceX((d) => d.x)
  )
  .force(
    'y',
    d3.forceY((d) => d.y)
  )
  // .force("charge", d3.forceManyBody().strength(Math.max(-200, -10000 / showEle.nodes.length)))
  .force('charge', d3.forceManyBody().strength(-1000))
  //.force('cluster', forceCluster().strength(0.15))

  if(preventLabelCollision) {
    simulation.force('collide', forceCollide())
  } else {
    simulation
      .force(
        'collide',
        d3
          .forceCollide()
          .radius((d) => d.radius)
          .iterations(3)
      )
  }

  updateAttributes(showEle.nodes, showEle.links)
  updateLayout()

  function updateAttributes(nodes, links) {
    const graph = initGraphologyGraph(nodes, links);

    nodes.forEach(d => {
      d.parent = findParent(links, d.entity)
      d.linkCnt = d.type === 'sub' ? 0 : calculateConnections(graph, d.id);
    })

    // Generate rainbow colors and print RGB codes
    nodes.sort((a, b) => d3.descending(a.linkCnt, b.linkCnt))
    const categories = nodes.filter(d => d.linkCnt >= 3).slice(0, 5).map(d => d.id)
    const hubs = Array.from(new Set(nodes.map(d => d.parent).flat())).filter(d => categories.indexOf(d) !== -1)

    const rainbowColors = [];
    const numberOfColors = hubs.length;

    for (let i = 0; i < numberOfColors; i++) {
        const hue = i / numberOfColors;
        const [r, g, b] = hslToRgb(hue, 1, 0.5);
        rainbowColors.push([r, g, b]);
    }

    const colorScale = d3.scaleOrdinal()
      .domain(hubs)
      .range(rainbowColors)
    
    const nodeRadiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(nodes, d => d.linkCnt)])
      .range([4, 28])
      .clamp(true)

    const linkWidthScale = d3
      .scaleSqrt()
      .domain(d3.extent(links, (d) => d[linkStyles.strokeWidth] || 1))
      .range([1, 3])
      .clamp(true)

    nodes.forEach((n, i) => {
      const radius = nodeRadiusScale(n.linkCnt)
      const substrings = splitLongText(n.id, maxLineLength)
  
      const texts = []
      substrings.forEach((string) => {
        const text = getTextSize(string, Math.max(8, radius) + 'px', containerStyles['font-family'])
        texts.push({ text: string, width: text.width, height: text.height })
      })

      n.width = d3.max(texts, (d) => d.width) + radius * 2
      n.height = d3.max(texts, (d) => d.height) * substrings.length + radius
      n.radius = radius

      const hasHub = hubs.some(elem => n.parent.includes(elem));
      n.color = hubs.indexOf(n.id) !== -1 ? colorScale(n.id) : mixColors(hasHub ? colorScale(n.parent[n.parent.length-1]) : [255, 255, 255], [255, 255, 255])
    })
  
    links.forEach((l, i) => {
      if (typeof linkStyles.strokeWidth === 'string' && !linkStyles.strokeWidth.includes('px')) {
        const W = d3.map(showEle.links, (d) => d[linkStyles.strokeWidth])
        l.strokeWidth = linkWidthScale(W[i]) || 1
      } else {
        l.strokeWidth = linkStyles.strokeWidth
      }
    })
  }

  function updateLayout () {
    //const graph = initGraphologyGraph(showEle.nodes, showEle.links)
    //colorNodes(graph, showEle.nodes);

    simulation.nodes(showEle.nodes).force('link').links(showEle.links)

    simulation.alphaTarget(0.1).restart() // increase alphaDecay value to cool down a graph more quickly

    //simulation.tick(Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())))
    simulation.on('tick', ticked)

    const t = svg.transition().duration(550);

    const enterFunc = enter => {
      enter.transition(t).attr("opacity", 1)
    }
    
    const updateNodeFunc = update => {
      // if (update.size() > 0) {
      //   simulation.force('charge', d3.forceManyBody().strength(-1000));
      // }   
      update
        .select('circle')
        .transition(t)
        .attr('r', d => d.radius)
        .attr('fill', (d) => (nodeStyles.type === 'gradient' ? `url('#radial-gradient-${d.color}')` : (`rgb(${d.color[0]}, ${d.color[1]}, ${d.color[2]})`)))
        .attr('stroke', (d) => nodeStyles.stroke || (`rgb(${d.color[0]}, ${d.color[1]}, ${d.color[2]})`));
      }
    
    const updateLinkFunc = update => {
      update
        .transition(t)
        .attr('stroke', (d) => {
          const node = showEle.nodes.find(el => el.id === d.target.id) 
          return linkStyles.stroke || `rgb(${node.color[0]}, ${node.color[1]}, ${node.color[2]})`
        })
      }

    function updateTextFunc(selection) {
      selection
        .select('text')
        .attr('transform', (d) => `translate(${(-d.width + (d.radius * 2))/ 2}, ${d.radius + 5})`)  // position label below node without overlap
        .attr('font-size', (d) => Math.max(8, d.radius)) // label size is proportionate to node size

      selection.each(function(d) {
        const text = d3.select(this).select('text');
        // Bind new data to tspans
        const tspans = text.selectAll('tspan')
          .data(splitLongText(d[labelStyles.label], maxLineLength));
    
        // Enter new tspans if needed
        tspans.enter()
          .append('tspan')
          .attr('x', 0)
          .attr('y', (_, i) => Math.max(8, d.radius) * i)
          .merge(tspans)  // Merge the enter and update selections
          .text((d) => d);
    
        // Remove old tspans if needed
        tspans.exit().remove();
      });
    }
      
    const exitFunc = exit => {
      return exit
          //.transition() // apply transition
          //.duration(500)
          // .on("start", () => {
          //   // After the second transition, adjust the force strength again
          //   simulation.force('charge').strength(-1500);
          // })
          //.attr("opacity", 0) // fade out
          .remove() // remove from DOM
          // .end().then(() => {
          //     // Remove the force after the transition ends
          //     simulation.force('charge', d3.forceManyBody().strength(-300));
          // });
    }

    // Update existing links
    const link = linkG
      .selectAll('path.link')
      .data(showEle.links, (d) => d.source.id + '_' + d.target.id)
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'link')
            .attr('id', (d) => d.source.id + '_' + d.target.id)
            .attr('stroke', (d) => {
              const node = showEle.nodes.find(el => el.id === d.target.id) 
              return linkStyles.stroke || `rgb(${node.color[0]}, ${node.color[1]}, ${node.color[2]})`
            })
            .attr('stroke-width', (d) => d.strokeWidth)
            .attr('d', (d) => (linkStyles.type === 'arc' ? generateArc(d, 1, true) : generatePath(d, true)))      
            .attr('opacity', 0)
            .call(enter => enter.transition(t).attr("opacity", linkStyles.strokeOpacity)),

        update => update.call(updateLinkFunc),
        exit => exit.call(exitFunc)
      )
      .attr('pointer-events', 'auto')
      .attr('cursor', 'pointer')
      .attr('fill', 'none')

    // Update existing link labels
    const linkTexts = linkTextG
      .selectAll('text.link')
      .data(showEle.links, (d) => d.source.id + '_' + d.target.id)
      .join(
        (enter) =>
          enter
            .append('text')
            .attr('class', 'link')
            // .attr('x', (d) => (d.target.x - d.source.x) / 2 + d.source.x + 10)
            // .attr('y', (d) => (d.target.y - d.source.y) / 2 + d.source.y)
            .attr('dy', -3)
            .attr('opacity', 0)
            .call(enterFunc)
            .append('textPath')
            .attr('visibility', labelStyles.edge.visibility)
            .attr('xlink:href', (d, i) => '#' + d.source.id + '_' + d.target.id)
            .attr('startOffset', '50%')
            .attr('text-anchor', 'middle')
            .text((d) => d[labelStyles.edge.label]),

        update => update,
        exit => exit.call(exitFunc)
      )
      .attr('opacity', labelStyles.edge.opacity)
      .attr('fill', labelStyles.edge.color || labelStyles.color)
      .attr('font-size', labelStyles.edge['font-size'])

    // Update existing nodes
    const updatedNode = nodeG.selectAll('.node').data(showEle.nodes, (d) => d.id)

    updatedNode.join(
      (enter) => {
        const newNode = enter
          .append('g')
          .attr('class', 'node')
          .attr('pointer-events', 'auto')
          .attr('cursor', 'pointer')
          .attr('transform', (d) => `translate(${d.x}, ${d.y})`)
          .call(drag(simulation))
          .attr('opacity', 0)
          .on('dblclick.zoom', null)
          .call(enterFunc)

        newNode
          .append('circle')
          .attr('r', (d) => d.radius)
          .attr('fill', (d) => (nodeStyles.type === 'gradient' ? `url('#radial-gradient-${d.color}')` : (`rgb(${d.color[0]}, ${d.color[1]}, ${d.color[2]})`)))
          .attr('stroke', (d) => nodeStyles.stroke || (`rgb(${d.color[0]}, ${d.color[1]}, ${d.color[2]})`))
          .attr('fill-opacity', nodeStyles.fillOpacity)
          .attr('stroke-opacity', nodeStyles.type === 'filled' ? nodeStyles.fillOpacity : nodeStyles.strokeOpacity)
          .attr('stroke-width', nodeStyles.type === 'gradient' ? '0.5px' : nodeStyles.strokeWidth) // it's nicer to have a thin circle stroke for nodes with radial gradient stroke

        return newNode
      },
      (update) => update.call(updateNodeFunc),
      exit => exit.call(exitFunc)
    )
      
    // Update existing node labels
    const updatedText = textG.selectAll('.label').data(showEle.nodes, (d) => d.id)

    updatedText.join(
      (enter) => {
        const newText = enter
          .append('g')
          .attr('class', (d) => 'label label-' + d.id.replaceAll(' ', '-'))
          .attr('transform', (d) => `translate(${d.x}, ${d.y})`)
          //.attr('visibility', (d) => d.type === 'main' ? labelStyles.visibility : 'hidden')
          .attr('opacity', 0)
          .call(enterFunc)

        const text = newText
          .append('text')
          .attr('transform', (d) => `translate(${(-d.width + (d.radius * 2))/ 2}, ${d.radius + 5})`)  // position label below node without overlap
          .attr('fill', labelStyles.color || containerStyles.color)
          .attr('stroke', containerStyles['background-color'])
          .attr('stroke-width', '0.3px')
          .attr('font-size', (d) => Math.max(8, d.radius)) // label size is proportionate to node size
          .attr('font-weight', labelStyles.fontWeight)
          .attr('dominant-baseline', 'middle')
          .attr('text-anchor', 'start')

        text
          .selectAll('tspan')
          .data((d) => {
            return splitLongText(d[labelStyles.label], maxLineLength).map(t => [t, Math.max(8, d.radius)])
          }) // max line length is 30
          .enter()
          .append('tspan')
          .attr('x', 0)
          .attr('y', (d, i) => d[1] * i)
          .text((d) => d[0])

        return newText
      },
      (update) => update.call(updateTextFunc),
      exit => exit.call(exitFunc)
    )

    //ticked()

    function ticked () {
      linkG.selectAll('path.link').attr('d', (d) => (linkStyles.type === 'arc' ? generateArc(d, 1, true) : generatePath(d, true)))
      nodeG.selectAll('.node').attr('transform', (d) => `translate(${d.x}, ${d.y})`)
      textG.selectAll('.label').attr('transform', (d) => `translate(${d.x}, ${d.y})`)
      linkTextG.selectAll('.link').attr('x', (d) => (d.target.x - d.source.x) / 2 + d.source.x + 6).attr('y', (d) => (d.target.y - d.source.y) / 2 + d.source.y)
    }

    nodeG.selectAll('.node')
      .on('mouseover', function (event, dd) {
        updateTooltip(event, dd) // show tooltip on mouseover any node
        d3.select(this).select('circle').transition().delay(500).duration(500).attr('r', (d) => d.radius * 1.2)
        d3.select('.label-' + dd.id.replaceAll(' ', '-')).transition().duration(500).attr('visibility', 'visible')
      })
      .on('mouseleave', function () {
        tooltipDiv.style('visibility', 'hidden')
        d3.select(this).select('circle').transition().duration(500).attr('r', (d) => d.radius)
        d3.selectAll('.label').transition().duration(500).attr('visibility', (d) => d.type === 'main' ? labelStyles.visibility : 'hidden')
      })

    linkG.selectAll('path.link')
      .on('mouseover', function (event, dd) {
        updateLinkTooltip(event, dd) // show tooltip on mouseover any link
      })
      .on('mouseleave', function () {
        tooltipDiv.style('visibility', 'hidden')
      })

    function drag (simulation) {
      function dragstarted (event, d) {
        if (!event.active) simulation.alpha(0.1).alphaTarget(0.1).restart()
        d.fx = d.x
        d.fy = d.y
      }

      function dragged (event, d) {
        d.fx = event.x
        d.fy = event.y
        simulation.on('tick', ticked)
      }

      function dragended (event, d) {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      }

      return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended)
    }
  }
  ////////////////////////////////////////////////////////////////////////////////

  // Function to calculate incoming and outgoing connections
  function calculateConnections(graph, node) {
    const incoming = graph.inDegree(node);
    const outgoing = graph.outDegree(node);
    return incoming + outgoing;
  }

  // // Function to color nodes based on neighbors
  // function colorNodes(graph, nodes) {
  //   const visited = new Set();

  //   function traverse(node) {
  //     if (!visited.has(node)) {
  //       visited.add(node);
  //       const neighbors = findNeighbours(graph, [node], 1).slice(1);
  //       let nodeColor = getNodeColor(nodes, node);
  //       neighbors.forEach(neighbor => {
  //         const neighborColor = getNodeColor(nodes, neighbor);
  //         nodeColor = mixColors(nodeColor, neighborColor);
  //       });
  //       setNodeColor(nodes, node, nodeColor);
  //       neighbors.forEach(traverse);
  //     }
  //   }
  //   getRootNodes(graph).forEach(rootNode => traverse(rootNode));
  // }
    
  function updateTooltip (event, d) {
    tooltip.custom(tooltipDiv, d)

    if (!tooltipDiv.innerHTML) {
      const content = []
      content.push(`<div style='padding-bottom: 4px; font-size: 18px; font-weight: bold; color: ${d.color}'>${d.id}</div>`) // tooltip title
      const keys = ['type', 'parent', 'linkCnt']
      keys.forEach((key) => {
        // iterate over each attribute object and render
        content.push(`<div><b>${key}: </b><span>${d[key]}</span></div>`)
      })
      let contentStr = ''
      content.map((d) => (contentStr += d))

      tooltipDiv.html(`${contentStr}`)
    }

    // const bbox = d3.select(".tooltip").node().getBoundingClientRect()
    const [x, y] = d3.pointer(event, d3.select('svg'));

    tooltipDiv
      .style('visibility', 'visible')
      .style('left', x + d.radius + 'px')
      .style('top', y + d.radius + 10 + 'px')
  }

  function updateLinkTooltip (event, d) {
    tooltip.custom(tooltipDiv, d)

    if (!tooltipDiv.innerHTML) {
      const content = []
      content.push(`<div style='padding-bottom: 4px; font-size: 18px; font-weight: bold;'><span style='color: ${d.source.color}'>${d.source.id}</span> -> <span style='color: ${d.target.color}'>${d.target.id}</span></div>`) // tooltip title
      const keys = ['Description', 'Relation', 'Object', 'Subject']
      keys.forEach((key) => {
        // iterate over each attribute object and render
        content.push(`<div><b>${key}: </b><span>${d[key]}</span></div>`)
      })
      let contentStr = ''
      content.map((d) => (contentStr += d))

      tooltipDiv.html(`${contentStr}`)
    }

    tooltipDiv
      .style('visibility', 'visible')
      .style('left', event.x + 10 + 'px')
      .style('top', event.y + 'px')
  }

  function uniqueElements(nodes, links) {
    // May not be needed in future: Check for duplicate nodes and links, particularly so since we are constructing the graph only based on relations data
    const uniqueNodes = nodes.reduce((acc, node) => {
      // Check if a node with the same 'entity' already exists in the accumulator
      const existingNode = acc.find((n) => n[nodeId] === node[nodeId]);
      // If not found, add the current node to the accumulator
      if (!existingNode) {
        acc.push(node);
      } 
      return acc;
    }, []);

    const uniqueLinks = links.reduce((acc, link) => {
      // Check if a link with the same 'Subject' and 'Object' already exists in the accumulator
      const existingLink = acc.find(
        (l) => l[sourceId] === link[sourceId] && l[targetId] === link[targetId]
      );
      // If not found, add the current link to the accumulator
      if (!existingLink) {
        acc.push(link);
      }
      return acc;
    }, []);

    return {nodes: uniqueNodes, links:uniqueLinks}
  }
  /// //////////////////// HELPER FUNCTIONS ////////////////////////
  function intern (value) {
    return value !== null && typeof value === 'object' ? value.valueOf() : value
  }

  function initGraphologyGraph (nodes, links) {
    // Initialize a new Graphology graph and add all nodes and edges to it
    // This will be used for shortest path and finding neighbours later
    const graph = new Graph()
  
    nodes.forEach((n) => {
      if (!graph.hasNode(n.id)) graph.addNode(n.id)
    })
    links.forEach((e) => {
      if (e.source.id && e.target.id) {
        if (graph.hasNode(e.source.id) && graph.hasNode(e.target.id)) {
          if (!graph.hasEdge(e.source.id, e.target.id)) {
            graph.addEdge(e.source.id, e.target.id)
          }
        }
      } else {
        if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
          if (!graph.hasEdge(e.source, e.target)) {
            graph.addEdge(e.source, e.target)
          }
        }
      }
    })
  
    return graph
  }

  const eventSubscriptions = {
    nodeClick: null
  };

  // Function to reapply event listeners to nodes
  const reapplyEventListeners = () => {
    if (eventSubscriptions.nodeClick) {
      d3.selectAll('.node').on('click', function (event, d) {
        eventSubscriptions.nodeClick({
          clickedNodeData: d,
        });
      });
    }
  };

  return {
    /* public data update  method */
    update: ({nodes:newNodes, links:newLinks, redraw=true}) => {
      let { nodes, links} = uniqueElements(newNodes, newLinks)

      const N = d3.map(nodes, (d) => d[nodeId]).map(intern)
      const LS = d3.map(links, (d) => d[sourceId]).map(intern)
      const LT = d3.map(links, (d) => d[targetId]).map(intern)
      nodes = d3.map(nodes, (d, i) => ({
        id: N[i],
        ...d
      }))  
      links = d3.map(links, (d, i) => ({
        source: LS[i],
        target: LT[i],
        ...d
      }))

      updateAttributes(nodes, links)
      
      if(redraw){
        showEle.nodes = nodes
        showEle.links = links
      } else {
        showEle.nodes = showEle.nodes.concat(nodes)
        showEle.links = showEle.links.concat(links)
      }

      updateLayout()

      // Reapply event listeners after layout update
      reapplyEventListeners();
    },
    /* event subscription method, provides interface for graph specific events e.g. click on node */
    on: (eventName, callback) => {
      if (eventName === 'nodeClick') {
        eventSubscriptions.nodeClick = callback;
        // Apply the event listener to the current nodes
        reapplyEventListeners();
      }
    }
  }
}
